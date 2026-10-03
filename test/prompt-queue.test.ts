import { describe, expect, test } from "vitest";
import { Repl, type LineSource } from "../src/plugins/repl.js";
import { deferred, tick } from "./fakes.js";

/** A loop over a fake agent whose every turn ends only when the test says so. */
function harness(initial?: string) {
  const lineCbs: Array<(line: string) => void> = [];
  const sigintCbs: Array<() => void> = [];
  const lines: LineSource = {
    onLine: (cb) => lineCbs.push(cb),
    onClose: () => {},
    onSigint: (cb) => sigintCbs.push(cb),
    pause: () => {},
    resume: () => {},
  };
  const sent: string[] = [];
  const turns: Array<ReturnType<typeof deferred<void>>> = [];
  const queues: string[][] = [];
  const recalled: string[][] = [];
  let current = deferred<void>();
  const repl = new Repl({
    agent: {
      session: {},
      whenIdle: () => current.promise,
      cancel: () => current.resolve(),
    },
    followup: (text) => {
      sent.push(text);
      current = deferred<void>();
      turns.push(current);
    },
    flush: async () => {},
    appExit: () => {},
    lines,
    onQueue: (queued) => queues.push([...queued]),
    onRecall: (prompts) => recalled.push(prompts),
  });
  void repl.run(initial);
  const type = async (line: string): Promise<void> => {
    for (const cb of lineCbs) cb(line);
    await tick();
  };
  const finishTurn = async (): Promise<void> => {
    current.resolve();
    for (let i = 0; i < 5; i += 1) await tick();
  };
  const escape = async (): Promise<void> => {
    for (const cb of sigintCbs) cb();
    for (let i = 0; i < 5; i += 1) await tick();
  };
  return { repl, sent, queues, recalled, type, finishTurn, escape };
}

describe("prompts queued while the agent works", () => {
  test("a prompt typed during a turn is kept and goes out when the turn ends", async () => {
    const h = harness();
    await tick();
    await h.type("first");
    await h.type("second");
    expect(h.sent).toEqual(["first"]);
    expect(h.repl.queued).toEqual(["second"]);
    expect(h.queues.at(-1)).toEqual(["second"]);
    await h.finishTurn();
    expect(h.sent).toEqual(["first", "second"]);
    expect(h.repl.queued).toEqual([]);
    expect(h.queues.at(-1)).toEqual([]);
  });

  test("several go out one turn each, in the order they were typed", async () => {
    const h = harness();
    await tick();
    await h.type("a");
    await h.type("b");
    await h.type("c");
    expect(h.repl.queued).toEqual(["b", "c"]);
    await h.finishTurn();
    expect(h.sent).toEqual(["a", "b"]);
    await h.finishTurn();
    expect(h.sent).toEqual(["a", "b", "c"]);
    await h.finishTurn();
    expect(h.sent).toEqual(["a", "b", "c"]);
  });

  test("the queue also waits behind the prompt the session was started with", async () => {
    const h = harness("from argv");
    await tick();
    await h.type("next");
    expect(h.sent).toEqual(["from argv"]);
    await h.finishTurn();
    expect(h.sent).toEqual(["from argv", "next"]);
  });

  test("an empty line is never queued", async () => {
    const h = harness();
    await tick();
    await h.type("work");
    await h.type("   ");
    expect(h.repl.queued).toEqual([]);
  });

  test("stopping the turn sends nothing more: the queue is handed back", async () => {
    const h = harness();
    await tick();
    await h.type("long task");
    await h.type("then this");
    await h.type("and this");
    await h.escape();
    expect(h.sent).toEqual(["long task"]);
    expect(h.recalled).toEqual([["then this", "and this"]]);
    expect(h.repl.queued).toEqual([]);
  });

  test("the last queued prompt can be taken back to edit it", async () => {
    const h = harness();
    await tick();
    await h.type("x");
    await h.type("y");
    await h.type("z");
    expect(h.repl.takeLastQueued()).toBe("z");
    expect(h.repl.queued).toEqual(["y"]);
    expect(h.queues.at(-1)).toEqual(["y"]);
    await h.finishTurn();
    expect(h.sent).toEqual(["x", "y"]);
    expect(h.repl.takeLastQueued()).toBeUndefined();
  });

  test("a retired loop drops its queue", async () => {
    const h = harness();
    await tick();
    await h.type("x");
    await h.type("y");
    h.repl.stop();
    expect(h.repl.queued).toEqual([]);
    await h.finishTurn();
    expect(h.sent).toEqual(["x"]);
  });
});
