import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { Repl, type AgentLike, type LineSource, type ReplDeps } from "../src/plugins/repl.js";
import { deferred, tick } from "./fakes.js";

class FakeLines implements LineSource {
  lineCbs: Array<(line: string) => void> = [];
  closeCbs: Array<() => void> = [];
  sigintCbs: Array<() => void> = [];
  paused = false;
  resumeCount = 0;

  onLine(cb: (line: string) => void): void {
    this.lineCbs.push(cb);
  }
  onClose(cb: () => void): void {
    this.closeCbs.push(cb);
  }
  onSigint(cb: () => void): void {
    this.sigintCbs.push(cb);
  }
  pause(): void {
    this.paused = true;
  }
  resume(): void {
    this.paused = false;
    this.resumeCount++;
  }
  emitLine(line: string): void {
    for (const cb of this.lineCbs) cb(line);
  }
  emitClose(): void {
    for (const cb of this.closeCbs) cb();
  }
  emitSigint(): void {
    for (const cb of this.sigintCbs) cb();
  }
}

interface Harness {
  repl: Repl;
  lines: FakeLines;
  agent: AgentLike & { cancelCalls: unknown[] };
  followups: string[];
  flushes: number;
  exits: number[];
  idle: ReturnType<typeof deferred<void>>;
}

function harness(): Harness {
  const lines = new FakeLines();
  const followups: string[] = [];
  const cancelCalls: unknown[] = [];
  let exits: number[] = [];
  let flushes = 0;
  let idle = deferred();
  const agent: AgentLike & { cancelCalls: unknown[] } = {
    session: { id: "s" },
    whenIdle: () => idle.promise,
    cancel: (cause) => {
      cancelCalls.push(cause);
      idle.resolve(); // a canceled turn becomes idle
    },
    cancelCalls,
  };
  const deps: ReplDeps = {
    agent,
    followup: (text) => {
      followups.push(text);
    },
    flush: async () => {
      flushes++;
    },
    appExit: (code) => {
      exits.push(code);
    },
    lines,
  };
  const h: Harness = {
    repl: new Repl(deps),
    lines,
    agent,
    followups,
    flushes: 0,
    exits: [],
    idle,
  };
  // expose the mutable counters through getters
  Object.defineProperty(h, "flushes", { get: () => flushes });
  Object.defineProperty(h, "exits", { get: () => exits });
  return h;
}

describe("Repl", () => {
  test("initial prompt runs one turn then prompts", async () => {
    const h = harness();
    const running = h.repl.run("fix the tests");
    await tick();
    expect(h.followups).toEqual(["fix the tests"]);
    expect(h.lines.paused).toBe(true);
    h.idle.resolve();
    await running;
    expect(h.flushes).toBe(1);
    expect(h.lines.resumeCount).toBe(1);
  });

  test("no initial prompt → prompt immediately, no turn", async () => {
    const h = harness();
    await h.repl.run();
    expect(h.followups).toEqual([]);
    expect(h.lines.resumeCount).toBe(1);
  });

  test("typed line runs a turn and flushes", async () => {
    const h = harness();
    await h.repl.run();
    h.lines.emitLine("hello");
    await tick();
    expect(h.followups).toEqual(["hello"]);
    h.idle.resolve();
    await tick();
    await tick();
    expect(h.flushes).toBe(1);
    expect(h.lines.resumeCount).toBe(2);
  });

  test("empty line re-prompts without a turn", async () => {
    const h = harness();
    await h.repl.run();
    h.lines.emitLine("   ");
    await tick();
    expect(h.followups).toEqual([]);
    expect(h.lines.resumeCount).toBe(2);
  });

  test("/exit flushes and exits 0", async () => {
    const h = harness();
    await h.repl.run();
    h.lines.emitLine("/exit");
    await tick();
    await tick();
    expect(h.followups).toEqual([]);
    expect(h.flushes).toBe(0); // turns already flushed; quit does not re-flush
    expect(h.exits).toEqual([0]);
  });

  test("Ctrl+D (close) exits 0", async () => {
    const h = harness();
    await h.repl.run();
    h.lines.emitClose();
    await tick();
    await tick();
    expect(h.exits).toEqual([0]);
  });

  test("Ctrl+C during a turn cancels the turn, not the app", async () => {
    const h = harness();
    await h.repl.run();
    h.lines.emitLine("long task");
    await tick();
    h.lines.emitSigint();
    expect(h.agent.cancelCalls).toEqual([{ kind: "user" }]);
    expect(h.exits).toEqual([]);
    await tick();
    await tick();
    // turn ended via cancel → loop is back at the prompt
    expect(h.lines.paused).toBe(false);
    expect(h.lines.resumeCount).toBe(2);
  });

  test("Ctrl+C outside a turn does nothing", async () => {
    const h = harness();
    await h.repl.run();
    h.lines.emitSigint();
    expect(h.agent.cancelCalls).toEqual([]);
    expect(h.exits).toEqual([]);
  });

  test("a line typed during a turn waits for it, then goes out (prompt-queue.test.ts has the rest)", async () => {
    const h = harness();
    await h.repl.run();
    h.lines.emitLine("one");
    await tick();
    h.lines.emitLine("two");
    expect(h.followups).toEqual(["one"]);
    expect(h.repl.queued).toEqual(["two"]);
    h.idle.resolve();
    await tick();
    await tick();
    expect(h.followups).toEqual(["one", "two"]);
  });

  test("EOF during a turn waits for the turn before exiting", async () => {
    const h = harness();
    await h.repl.run();
    h.lines.emitLine("long task");
    await tick();
    h.lines.emitClose();
    await tick();
    expect(h.exits).toEqual([]); // still running the turn
    h.idle.resolve();
    await tick();
    await tick();
    expect(h.followups).toEqual(["long task"]);
    expect(h.flushes).toBe(1); // the turn flushed; quit does not re-flush
    expect(h.exits).toEqual([0]);
  });
});

describe("slash palette source of truth (T31.1)", () => {
  test("bruine commands: 17 items incl. new/compact/config/tasks/reload/mouse/effect/help/exit", async () => {
    const { BRUINE_COMMANDS, mergeCommands } = await import("../src/plugins/repl.js");
    // T56 added /mouse: taking the mouse costs the wheel, so the choice has to
    // be reachable without restarting.
    expect(BRUINE_COMMANDS).toHaveLength(17);
    const names = BRUINE_COMMANDS.map((c) => c.name);
    for (const n of ["/new", "/compact", "/plan", "/permissions", "/auto", "/ask", "/full", "/skills", "/config", "/tasks", "/reload", "/mouse", "/effect", "/help", "/exit"]) {
      expect(names).toContain(n);
    }
    const merged = mergeCommands([
      { name: "plan", description: "dsh plan (shadowed)" },
      { name: "commit", description: "dsh commit helper" },
    ]);
    expect(merged.filter((c) => c.name === "/plan")).toHaveLength(1);
    expect(merged.find((c) => c.name === "/plan")?.description).toContain("Shift+Tab");
    expect(merged.map((c) => c.name)).toContain("/commit");
  });
});

describe("a plugin that already said it is not echoed again", () => {
  test("the notice is the answer; the transcript line was the duplicate", async () => {
    const { saidAlready } = await import("../src/plugins/repl.js");
    // `/effort high` shows "Effort: high (next message)" above the editor and the
    // plugin hands the same sentence back. Echoing it wrote a second copy into the
    // transcript, and that copy is still there after the notice has gone.
    expect(saidAlready("Effort: high (next message)", "Effort: high (next message)")).toBe(true);
    // An answer rather than a notice: an error, an unknown level, the list of levels.
    expect(saidAlready('Unknown effort "xhigh". Levels: low, medium, high.', "Effort: high (next message)")).toBe(false);
    // Nothing said, nothing to suppress.
    expect(saidAlready(undefined, "Effort: high (next message)")).toBe(false);
    expect(saidAlready("Effort: high (next message)", undefined)).toBe(false);
  });

  test("the effort plugin really does both, which is why the router checks", async () => {
    // The plugin cannot know whether its caller has a notice box, so it reports
    // twice on purpose; suppressing the echo is the router's job.
    const { Effort } = await import("../src/plugins/effort.js");
    const notices: string[] = [];
    const holder = { current: { provider: "local", model: "m1", reasoningEffort: "low" as string | undefined } };
    const effort = new Effort();
    const home = await mkdtemp(join(tmpdir(), "bruine-effort-doubled-"));
    const saved = process.env.DSH_HOME;
    process.env.DSH_HOME = home;
    try {
      await effort.attach({
        agent: {},
        selection: holder,
        ui: { showNotice: (text: string) => notices.push(text), footer: { set: () => {} }, requestRender: () => {} } as never,
      } as never, { resolveModelInfo: async () => ({ reasoning: { efforts: ["low", "medium", "high"].map((id) => ({ id, name: id })) } }) } as never);
      const said = await effort.runCommand("/effort high");
      expect(notices.at(-1)).toBe("Effort: high (next message)");
      expect(said).toBe(notices.at(-1));
    } finally {
      if (saved === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = saved;
      await rm(home, { recursive: true, force: true });
    }
  });
});
