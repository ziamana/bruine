import { describe, expect, test } from "vitest";
import {
  MIN_BUDGET_MS,
  PHASE_BUDGET_MS,
  advance,
  silenceBudget,
  watchSilence,
  type SilenceState,
  type StreamChunk,
} from "../src/llm/silence.js";
import { retryLine } from "../src/ui/retry.js";

const CEILING = 15 * 60_000;
const at = (over: Partial<SilenceState> = {}): SilenceState => ({ phase: "waiting", toolChars: 0, retry: 0, survived: 0, ...over });

describe("the silence budget", () => {
  test("a pause in the middle of an answer is given less time than a model that has not started", () => {
    expect(silenceBudget(at({ phase: "answering" }), CEILING)).toBeLessThan(silenceBudget(at({ phase: "waiting" }), CEILING));
    expect(silenceBudget(at({ phase: "preparing" }), CEILING)).toBeGreaterThan(silenceBudget(at({ phase: "thinking" }), CEILING));
  });

  test("a large file being written gets more time the more of it has arrived", () => {
    const small = silenceBudget(at({ phase: "calling", tool: "write", toolChars: 500 }), CEILING);
    const large = silenceBudget(at({ phase: "calling", tool: "write", toolChars: 40_000 }), CEILING);
    expect(large).toBeGreaterThan(small + 3 * 60_000);
  });

  test("a higher effort waits longer, and every retry doubles the wait", () => {
    const low = silenceBudget(at({ effort: "low" }), CEILING);
    expect(silenceBudget(at({ effort: "max" }), CEILING)).toBe(low * 2.5);
    expect(silenceBudget(at({ retry: 1 }), CEILING)).toBe(low * 2);
    expect(silenceBudget(at({ retry: 2 }), CEILING)).toBe(low * 4);
  });

  test("a silence the session has seen end well is never cut short again", () => {
    expect(silenceBudget(at({ phase: "answering", survived: 4 * 60_000 }), CEILING)).toBe(6 * 60_000);
  });

  test("the route's own timeout stays the ceiling, and nothing goes under the floor", () => {
    expect(silenceBudget(at({ effort: "max", retry: 5 }), CEILING)).toBe(CEILING);
    expect(silenceBudget(at({ effort: "max", retry: 5 }), 300_000)).toBe(300_000);
    expect(silenceBudget(at({ phase: "answering" }), CEILING, 0.001)).toBe(PHASE_BUDGET_MS.answering * 0.001);
    expect(PHASE_BUDGET_MS.answering).toBeGreaterThanOrEqual(MIN_BUDGET_MS);
  });

  test("the phase follows the stream", () => {
    let s = at();
    s = advance(s, { type: "reasoning-delta" });
    expect(s.phase).toBe("thinking");
    s = advance(s, { type: "block-end", block: { type: "reasoning" } });
    expect(s.phase).toBe("preparing");
    s = advance(s, { type: "tool-call-delta", name: "write", argumentsDelta: "{\"content\":\"" });
    s = advance(s, { type: "tool-call-delta", argumentsDelta: "x".repeat(2000) });
    expect(s).toMatchObject({ phase: "calling", tool: "write", toolChars: 2012 });
    s = advance(s, { type: "tool-call-delta", name: "bash", argumentsDelta: "{}" });
    expect(s).toMatchObject({ tool: "bash", toolChars: 2 });
    s = advance(s, { type: "text-delta" });
    expect(s.phase).toBe("answering");
  });
});

/** A stream that yields its chunks, then goes quiet for `quietMs` (forever when undefined) before one more. */
function stalling(chunks: StreamChunk[], hang = true, quietMs?: number): AsyncIterable<StreamChunk> & { closed: boolean } {
  const out = {
    closed: false,
    async *[Symbol.asyncIterator]() {
      try {
        for (const chunk of chunks) yield chunk;
        if (!hang) return;
        await new Promise((resolve) => (quietMs === undefined ? undefined : setTimeout(resolve, quietMs)));
        yield { type: "text-delta" };
      } finally {
        out.closed = true;
      }
    },
  };
  return out;
}

describe("watchSilence", () => {
  test("a stream that keeps talking passes through untouched", async () => {
    const chunks: StreamChunk[] = [{ type: "text-delta" }, { type: "finish" }];
    const seen: StreamChunk[] = [];
    for await (const c of watchSilence(stalling(chunks, false), { start: at(), budget: () => 1000 })) seen.push(c);
    expect(seen).toEqual(chunks);
  });

  test("a stream silent past its budget ends with a retryable TIMEOUT, and is closed when it wakes", async () => {
    // dsh freezes the request, signal included, so the stream cannot be cut from outside: an async
    // generator closes at its next step. A late chunk is never seen by the agent.
    const source = stalling([{ type: "reasoning-delta" }], true, 60);
    const states: string[] = [];
    let gaveUp: number | undefined;
    const seen: StreamChunk[] = [];
    for await (const c of watchSilence(source, {
      start: at(),
      budget: (s) => (s.phase === "thinking" ? 30 : 1000),
      onState: (s) => states.push(s.phase),
      onGiveUp: (quiet) => (gaveUp = quiet),
    })) seen.push(c);
    expect(seen[0]).toEqual({ type: "reasoning-delta" });
    expect(seen[1]).toMatchObject({ type: "finish", reason: { kind: "error", failure: { code: "TIMEOUT" } } });
    expect(states).toEqual(["waiting", "thinking"]);
    expect(gaveUp).toBeGreaterThanOrEqual(25);
    expect(seen).toHaveLength(2);
    await new Promise((r) => setTimeout(r, 80));
    expect(source.closed).toBe(true);
  });

  test("a consumer that stops early closes the request", async () => {
    const source = stalling([{ type: "text-delta" }, { type: "text-delta" }]);
    for await (const _ of watchSilence(source, { start: at(), budget: () => 1000 })) break;
    expect(source.closed).toBe(true);
  });
});

describe("the retry line", () => {
  test("says why, which attempt, and when", () => {
    expect(retryLine({ retry: 2, maxRetries: 5, delayMs: 1200, failure: { code: "TIMEOUT", message: "no answer", silenceMs: 180_000 } })).toBe(
      "The model has not answered for 3m. Retry 2/5 in 1.2s.",
    );
    expect(retryLine({ retry: 1, maxRetries: 5, delayMs: 500, failure: { code: "TIMEOUT", message: "pi-ai stream idle timeout after 300000ms" } })).toBe(
      "The model has not answered for 5m. Retry 1/5 in 0.5s.",
    );
    expect(retryLine({ retry: 3, delayMs: 12_000, failure: { code: "RATE_LIMIT" } })).toBe("The provider is limiting requests. Retry 3 in 12s.");
    expect(retryLine({ retry: 1, maxRetries: 5, delayMs: 0, failure: { code: "TRANSPORT" } })).toBe("The connection to the model dropped. Retry 1/5 now.");
  });
});
