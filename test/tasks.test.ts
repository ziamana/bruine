import { describe, expect, test, vi } from "vitest";
import { findTask, formatTasks, listTasks, stopTask, type ChildEntryLike, type JobSnapshotLike, type JobsLike, type SubagentsLike } from "../src/plugins/tasks.js";

const NOW = 1_000_000;
const job = (over: Partial<JobSnapshotLike> = {}): JobSnapshotLike => ({
  id: "bash-1", kind: "bash", label: "pnpm test", status: "running", startedAt: NOW - 45_000, ...over,
});
const child = (over: Partial<Extract<ChildEntryLike, { kind: "child" }>> = {}): ChildEntryLike => ({
  kind: "child", id: "3f9a21c4-0000-4000-8000-000000000001", activity: "running", mode: "continuable", label: "search the usages of ctx.jobs", ...over,
});

function services(jobs: JobSnapshotLike[] = [], children: ChildEntryLike[] = []) {
  const kill = vi.fn((): "requested" | "already-finished" => "requested");
  const interrupt = vi.fn();
  const jobsApi: JobsLike = { list: () => jobs, kill };
  const subagentsApi: SubagentsLike = { listChildren: async () => children, interruptByParent: interrupt };
  return { jobs: jobsApi, subagents: subagentsApi, kill, interrupt };
}

describe("listTasks", () => {
  test("merges the agent's jobs and the sub-agents it started", async () => {
    const s = services([job(), job({ id: "bash-2", status: "completed", label: "git status", finishedAt: NOW - 1000 })], [child()]);
    const rows = await listTasks(s, {}, "sess-1");
    expect(rows.map((r) => [r.id, r.status, r.source])).toEqual([
      ["bash-1", "running", "job"], ["bash-2", "done", "job"], ["3f9a21c4", "running", "subagent"],
    ]);
  });

  test("a continuable sub-agent between activations is idle, a one-shot one is done", async () => {
    const rows = await listTasks(services([], [
      child({ activity: "inactive", id: "aaaaaaaa-1" }),
      child({ activity: "inactive", mode: "one-shot", id: "bbbbbbbb-2" }),
    ]), {}, "s");
    expect(rows.map((r) => r.status)).toEqual(["idle", "done"]);
  });

  test("a diagnostic entry is not a task", async () => {
    const rows = await listTasks(services([], [{ kind: "diagnostic", id: "x" }]), {}, "s");
    expect(rows).toEqual([]);
  });

  test("a service that throws is an empty listing, not a failure", async () => {
    const broken: { jobs: JobsLike; subagents: SubagentsLike } = {
      jobs: { list: () => { throw new Error("no"); }, kill: () => "requested" },
      subagents: { listChildren: async () => { throw new Error("no"); }, interruptByParent: () => undefined },
    };
    expect(await listTasks(broken, {}, "s")).toEqual([]);
    expect(await listTasks({}, {}, "s")).toEqual([]);
  });
});

describe("formatTasks", () => {
  test("nothing running says so", () => {
    expect(formatTasks([], NOW)).toBe("No background tasks.");
  });

  test("running tasks come first, with their age and what they are", async () => {
    const rows = await listTasks(services([job({ id: "bash-2", status: "completed", finishedAt: NOW - 500, label: "git status" }), job()], [child()]), {}, "s");
    const text = formatTasks(rows, NOW);
    const lines = text.split("\n");
    expect(lines[0]).toBe("Background tasks (2 running)");
    expect(lines[1]).toMatch(/bash-1 +running +45s +pnpm test$/);
    expect(lines[2]).toMatch(/3f9a21c4 +running .*search the usages/);
    expect(lines[3]).toMatch(/bash-2 +done/);
    expect(text).toContain("/tasks kill <id> stops one.");
  });

  test("an old task shows minutes, as the activity label does", () => {
    const text = formatTasks([{ id: "bash-1", source: "job", kind: "bash", label: "x", status: "running", startedAt: NOW - 150_000 }], NOW);
    expect(text).toContain("2min 30s");
  });

  test("long labels are cut to the width, and old finished tasks are counted", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      id: `bash-${String(i)}`, source: "job" as const, kind: "bash", label: "x".repeat(300), status: "done" as const, startedAt: NOW - 5000, finishedAt: NOW,
    }));
    const lines = formatTasks(rows, NOW, 60).split("\n");
    expect(lines.some((l) => l.includes("4 older finished"))).toBe(true);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(80);
  });
});

describe("findTask and stopTask", () => {
  test("a task is named by its id or the start of it", async () => {
    const rows = await listTasks(services([job()], [child()]), {}, "s");
    expect(findTask(rows, "bash-1")).toMatchObject({ id: "bash-1" });
    expect(findTask(rows, "3f9a")).toMatchObject({ source: "subagent" });
    expect(findTask(rows, "zzz")).toBeUndefined();
    const two = await listTasks(services([job(), job({ id: "bash-10" })]), {}, "s");
    expect(findTask(two, "bash-1")).toMatchObject({ id: "bash-1" }); // exact wins over a longer id
    expect(findTask(two, "bash")).toBe("ambiguous");
  });

  test("stopping a job asks the registry, as the agent that owns it", async () => {
    const s = services([job()]);
    const agent = { me: true };
    expect(await stopTask(s, agent, "s", "bash-1")).toBe("Stopping bash-1.");
    expect(s.kill).toHaveBeenCalledWith("bash-1", agent, "stopped by the user");
  });

  test("stopping a sub-agent interrupts it under its parent session", async () => {
    const s = services([], [child()]);
    expect(await stopTask(s, {}, "parent-1", "3f9a")).toBe("Interrupted 3f9a21c4.");
    expect(s.interrupt).toHaveBeenCalledWith("3f9a21c4-0000-4000-8000-000000000001", "parent-1", "continuable");
  });

  test("it says what is wrong instead of failing: no name, unknown, finished, already over", async () => {
    const s = services([job({ id: "bash-9", status: "completed", finishedAt: NOW })]);
    expect(await stopTask(s, {}, "s", "")).toMatch(/^Usage: \/tasks kill/);
    expect(await stopTask(s, {}, "s", "nope")).toMatch(/No background task named nope/);
    expect(await stopTask(s, {}, "s", "bash-9")).toBe("bash-9 already finished.");
    expect(s.kill).not.toHaveBeenCalled();
    const raced = services([job()]);
    raced.kill.mockReturnValueOnce("already-finished");
    expect(await stopTask(raced, {}, "s", "bash-1")).toBe("bash-1 had already finished.");
  });

  test("a registry that throws on kill is reported, not thrown", async () => {
    const s = services([job()]);
    s.kill.mockImplementationOnce(() => { throw new Error("boom"); });
    expect(await stopTask(s, {}, "s", "bash-1")).toBe("Could not stop bash-1: boom");
  });
});
