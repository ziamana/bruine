/**
 * T36 — what one bruine run cost, read from dsh's own session log.
 *
 * The log is the only honest source: it carries the provider's usage numbers
 * and every `tool/call`, in the order they happened. dsh writes it zstd
 * compressed by default, so this reads plaintext logs and, when the runtime
 * can (Node ≥ 22.15), zstd ones. A log it cannot read yields `null` metrics —
 * never a zero that would look like a fast, token-cheap run.
 */
import { spawnSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export interface RunMetrics {
  /** Output tokens the provider reported, summed over assistant messages. */
  outputTokens: number | null;
  inputTokens: number | null;
  /** Every `tool/call` in the log (todo_write included: it is a real call). */
  toolCalls: number | null;
  /** Calls to the `edit` tool, and how many of them the tool refused (old_string not found, file changed since read). */
  editCalls: number | null;
  editErrors: number | null;
  /** Turn errors, by kind; empty when the run was clean. */
  errors: string[];
  /** Number of log rows read. */
  events: number;
  /** Why the metrics are missing, when they are. */
  unreadable?: string;
}

const EMPTY: RunMetrics = {
  outputTokens: null,
  inputTokens: null,
  toolCalls: null,
  editCalls: null,
  editErrors: null,
  errors: [],
  events: 0,
};

/**
 * Read one log. dsh's own default is a zstd file made of concatenated frames,
 * and only the `zstd` tool reads all of them; Node decodes the first frame and
 * would silently under-count a run. So: plaintext as-is, zstd through the
 * tool, and anything else is reported rather than guessed.
 */
async function readLog(path: string): Promise<{ text?: string; unreadable?: string }> {
  if (path.endsWith(".zstd")) {
    const zstd = spawnSync("zstd", ["-d", "-c", path], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (zstd.error === undefined && typeof zstd.stdout === "string" && zstd.stdout !== "") {
      return { text: zstd.stdout };
    }
    return { unreadable: "zstd session log, and this machine has no working zstd tool" };
  }
  return { text: await readFile(path, "utf8") };
}

/** Every session log under a bench home's `sessions/` root. */
export async function findSessionLogs(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.jsonl(\.zstd)?$/.test(entry.name)) found.push(full);
    }
  };
  await walk(root);
  found.sort();
  return found;
}

interface Row {
  type?: string;
  data?: any;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Fold log rows into {@link RunMetrics}; exported for the unit tests. */
export function metricsFromRows(rows: Row[]): RunMetrics {
  const out: RunMetrics = { ...EMPTY, errors: [] };
  let output = 0;
  let input = 0;
  let sawUsage = false;
  let toolCalls = 0;
  let editCalls = 0;
  let editErrors = 0;
  const editIds = new Set<string>();
  for (const row of rows) {
    out.events += 1;
    const type = row?.type;
    const data = row?.data;
    if (type === "assistant/message") {
      const usage = data?.usage;
      const o = number(usage?.outputTokens);
      const i = number(usage?.inputTokens);
      if (o !== null) {
        output += o;
        sawUsage = true;
      }
      if (i !== null) {
        input += i;
        sawUsage = true;
      }
    }
    if (type === "tool/call") {
      toolCalls += 1;
      if (data?.name === "edit") {
        editCalls += 1;
        if (typeof data?.callId === "string") editIds.add(data.callId);
      }
    }
    if (type === "tool/result") {
      const parts: unknown = data?.message?.content;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (part?.isError === true && editIds.has(part?.toolCallId)) editErrors += 1;
        }
      }
    }
    if (type === "turn/end") {
      const reason = data?.reason;
      if (reason?.kind !== undefined && reason.kind !== "completed") {
        const code = reason?.error?.code;
        out.errors.push(code === undefined ? String(reason.kind) : `${String(reason.kind)}:${String(code)}`);
      }
    }
  }
  out.outputTokens = sawUsage ? output : null;
  out.inputTokens = sawUsage ? input : null;
  out.toolCalls = out.events === 0 ? null : toolCalls;
  out.editCalls = out.events === 0 ? null : editCalls;
  out.editErrors = out.events === 0 ? null : editErrors;
  return out;
}

/** Parse one log file (plaintext or zstd) into rows, skipping bad lines. */
export async function readSessionRows(path: string): Promise<{ rows: Row[]; unreadable?: string }> {
  const { text, unreadable } = await readLog(path);
  if (text === undefined) return { rows: [], ...(unreadable !== undefined ? { unreadable } : {}) };
  const rows: Row[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed[0] !== "{") continue;
    try {
      rows.push(JSON.parse(trimmed) as Row);
    } catch {
      // a truncated tail after a kill is expected; keep the rest
    }
  }
  return { rows };
}

/** Metrics for a whole bench home (one run = one home, so one log set). */
export async function readRunMetrics(sessionsRoot: string): Promise<RunMetrics> {
  const logs = await findSessionLogs(sessionsRoot);
  if (logs.length === 0) {
    return { ...EMPTY, unreadable: "no session log (bruine never booted, or the log is elsewhere)" };
  }
  const rows: Row[] = [];
  const unreadable: string[] = [];
  for (const log of logs) {
    const read = await readSessionRows(log);
    rows.push(...read.rows);
    if (read.unreadable !== undefined) unreadable.push(read.unreadable);
  }
  const metrics = metricsFromRows(rows);
  if (unreadable.length > 0) {
    return { ...metrics, outputTokens: null, inputTokens: null, unreadable: unreadable[0] };
  }
  return metrics;
}

/** True when the sessions root exists at all (bruine booted far enough). */
export async function hasSessions(sessionsRoot: string): Promise<boolean> {
  try {
    return (await stat(sessionsRoot)).isDirectory();
  } catch {
    return false;
  }
}
