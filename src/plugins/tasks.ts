import { formatElapsed } from "../render/elapsed.js";

/**
 * What `/tasks` needs from the engine, written out so this module does not depend on
 * the engine's types: the job registry (background commands and one-shot sub-agents)
 * and the sub-agent runtime (sub-agents that stay for follow-ups).
 */
export interface JobSnapshotLike {
  id: string;
  kind: string;
  label: string;
  status: string;
  detail?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface JobsLike {
  list(caller?: unknown): JobSnapshotLike[];
  kill(id: string, caller?: unknown, reason?: string): "requested" | "already-finished";
}

export type ChildEntryLike =
  | { kind: "child"; id: string; activity: "running" | "inactive"; mode: "one-shot" | "continuable"; label?: string }
  | { kind: "diagnostic"; id: string };

export interface SubagentsLike {
  listChildren(parentSessionId: string, signal?: AbortSignal): Promise<ChildEntryLike[]>;
  interruptByParent(childSessionId: string, parentSessionId: string, mode: "continuable"): unknown;
}

export interface TaskRow {
  /** What the user types to name it: `bash-1`, or the first characters of a sub-agent's session. */
  id: string;
  /** Where the row came from, because stopping a job and interrupting a sub-agent are different calls. */
  source: "job" | "subagent";
  kind: string;
  label: string;
  status: "running" | "stopping" | "idle" | "done" | "killed" | "failed";
  /** Epoch ms; sub-agents do not carry one. */
  startedAt?: number;
  finishedAt?: number;
  /** The full session id of a sub-agent. */
  sessionId?: string;
}

/** Characters of a sub-agent's session id shown, and accepted, as its name. */
const CHILD_ID_CHARS = 8;
/** Finished rows kept on screen; the running ones are always all there. */
const FINISHED_SHOWN = 8;

const JOB_STATUS: Record<string, TaskRow["status"]> = {
  running: "running",
  stopping: "stopping",
  completed: "done",
  killed: "killed",
  failed: "failed",
};

/**
 * Every background task of one agent session: its jobs, then the sub-agents it started.
 *
 * Either service may be missing in a given composition, and a listing that fails is a
 * listing that is empty: `/tasks` must never be the thing that breaks a session.
 */
export async function listTasks(
  services: { jobs?: JobsLike | undefined; subagents?: SubagentsLike | undefined },
  agent: unknown,
  sessionId: string | undefined,
): Promise<TaskRow[]> {
  const rows: TaskRow[] = [];
  try {
    for (const job of services.jobs?.list(agent) ?? []) {
      rows.push({
        id: job.id,
        source: "job",
        kind: job.kind,
        label: job.label,
        status: JOB_STATUS[job.status] ?? "running",
        startedAt: job.startedAt,
        ...(job.finishedAt !== undefined ? { finishedAt: job.finishedAt } : {}),
      });
    }
  } catch {
    // The registry refused the listing: show what the other source has.
  }
  try {
    if (services.subagents !== undefined && sessionId !== undefined) {
      for (const child of await services.subagents.listChildren(sessionId)) {
        if (child.kind !== "child") continue;
        rows.push({
          id: child.id.slice(0, CHILD_ID_CHARS),
          source: "subagent",
          kind: "subagent",
          label: child.label ?? "(no label)",
          status: child.activity === "running" ? "running" : child.mode === "continuable" ? "idle" : "done",
          sessionId: child.id,
        });
      }
    }
  } catch {
    // Same: a listing that fails is an empty one.
  }
  return rows;
}

/** The rows as lines of text: what is running first, then the latest that finished. */
export function formatTasks(rows: readonly TaskRow[], now: number, width = 100): string {
  if (rows.length === 0) return "No background tasks.";
  const live = rows.filter((r) => r.status === "running" || r.status === "stopping");
  const rest = rows.filter((r) => !live.includes(r));
  const finished = rest.slice(-FINISHED_SHOWN);
  const shown = [...live, ...finished];
  const idCells = Math.max(...shown.map((r) => r.id.length));
  const statusCells = Math.max(...shown.map((r) => r.status.length));
  const lines = shown.map((r) => {
    const end = r.finishedAt ?? now;
    const age = r.startedAt === undefined ? "" : formatElapsed(Math.max(0, end - r.startedAt));
    const room = Math.max(10, width - idCells - statusCells - 16);
    const label = r.label.replace(/\s+/g, " ").trim();
    return `  ${r.id.padEnd(idCells)}  ${r.status.padEnd(statusCells)}  ${age.padEnd(8)}  ${label.length > room ? `${label.slice(0, room - 1)}…` : label}`;
  });
  const hidden = rest.length - finished.length;
  return [
    `Background tasks (${String(live.length)} running)`,
    ...lines,
    ...(hidden > 0 ? [`  ${String(hidden)} older finished`] : []),
    "/tasks kill <id> stops one.",
  ].join("\n");
}

/** The row a typed name points at: an exact id, or a unique start of one. */
export function findTask(rows: readonly TaskRow[], name: string): TaskRow | "ambiguous" | undefined {
  const exact = rows.find((r) => r.id === name);
  if (exact !== undefined) return exact;
  const starts = rows.filter((r) => r.id.startsWith(name) || r.sessionId?.startsWith(name) === true);
  if (starts.length > 1) return "ambiguous";
  return starts[0];
}

/** Stop one task and say what happened, in a line. */
export async function stopTask(
  services: { jobs?: JobsLike | undefined; subagents?: SubagentsLike | undefined },
  agent: unknown,
  sessionId: string | undefined,
  name: string,
): Promise<string> {
  if (name === "") return "Usage: /tasks kill <id>  (/tasks lists the ids)";
  const rows = await listTasks(services, agent, sessionId);
  const row = findTask(rows, name);
  if (row === "ambiguous") return `More than one task starts with ${name}: type more of its id.`;
  if (row === undefined) return `No background task named ${name}. /tasks lists them.`;
  if (row.status !== "running" && row.status !== "stopping" && row.status !== "idle") {
    return `${row.id} already ${row.status === "done" ? "finished" : row.status}.`;
  }
  try {
    if (row.source === "job") {
      const outcome = services.jobs?.kill(row.id, agent, "stopped by the user");
      return outcome === "already-finished" ? `${row.id} had already finished.` : `Stopping ${row.id}.`;
    }
    if (services.subagents === undefined || sessionId === undefined || row.sessionId === undefined) {
      return `${row.id} cannot be stopped from here.`;
    }
    services.subagents.interruptByParent(row.sessionId, sessionId, "continuable");
    return `Interrupted ${row.id}.`;
  } catch (err) {
    return `Could not stop ${row.id}: ${(err as Error).message}`;
  }
}
