import { describe, expect, test } from "vitest";
import { attach, createUi } from "../src/plugins/render.js";
import { fakeCtx, FakeScreen, strip } from "./fakes.js";

function setup() {
  const screen = new FakeScreen();
  const ui = createUi(screen);
  const fake = fakeCtx();
  const session = { id: "s1" };
  const agent = { session };
  attach(fake.ctx as any, agent as any, ui);
  const frame = (chunk: unknown) => fake.emit("agent/assistant-stream", { agent, frame: { type: "chunk", index: 0, chunk } });
  const event = (type: string, data: unknown, sess: unknown = session) =>
    fake.emit("session/event", sess, { type, data });
  return { screen, ui, fake, agent, session, frame, event };
}

describe("render plugin", () => {
  test("reasoning deltas draw the dim line", () => {
    const { screen, frame } = setup();
    frame({ type: "reasoning-delta", text: "Let me" });
    frame({ type: "reasoning-delta", text: " think" });
    expect(strip(screen.last)).toBe("💭 Let me think");
  });

  test("block-end of reasoning writes the thought line", () => {
    const { screen, frame } = setup();
    frame({ type: "reasoning-delta", text: "hmm" });
    frame({ type: "block-end", block: { type: "reasoning", text: "hmm" } });
    expect(strip(screen.last)).toMatch(/^💭 thought for \d+\.\ds\n$/);
  });

  test("text deltas stream and block-end closes with one newline", () => {
    const { screen, frame } = setup();
    frame({ type: "text-delta", text: "Hel" });
    frame({ type: "text-delta", text: "lo" });
    frame({ type: "block-end", block: { type: "text", text: "Hello" } });
    expect(screen.all).toBe("\r\x1b[2KHello\n");
  });

  test("a non-reasoning block-start closes a dangling reasoning line", () => {
    const { screen, frame } = setup();
    frame({ type: "reasoning-delta", text: "hmm" });
    frame({ type: "block-start", blockType: "text", index: 1 });
    expect(strip(screen.last)).toMatch(/^💭 thought for/);
  });

  test("tool-call deltas stream the header", () => {
    const { screen, frame } = setup();
    frame({ type: "tool-call-delta", id: "t1", name: "bash", argumentsDelta: '{"comm' });
    expect(strip(screen.last)).toBe("● bash  …");
    frame({ type: "tool-call-delta", id: "t1", argumentsDelta: 'and":"ls"}' });
    expect(strip(screen.last)).toBe("● bash  ls");
  });

  test("durable tool/call starts a call the stream never showed", () => {
    const { screen, event } = setup();
    event("tool/call", { turn: 1, step: 0, callId: "t9", name: "read", arguments: '{"path":"a.ts"}' });
    expect(strip(screen.last)).toBe("● read  a.ts");
  });

  test("durable tool/call does not restart an already streamed call", () => {
    const { screen, frame, event } = setup();
    frame({ type: "tool-call-delta", id: "t1", name: "bash", argumentsDelta: '{"command":"ls"}' });
    const before = screen.writes.length;
    event("tool/call", { turn: 1, step: 0, callId: "t1", name: "bash", arguments: '{"command":"ls"}' });
    expect(screen.writes.length).toBe(before);
  });

  test("tool/result draws the result line and output preview", () => {
    const { screen, frame, event } = setup();
    frame({ type: "tool-call-delta", id: "t1", name: "bash", argumentsDelta: '{"command":"ls"}' });
    event("tool/result", {
      turn: 1,
      step: 0,
      message: {
        role: "toolResult",
        content: [
          { type: "tool-result", toolCallId: "t1", content: [{ type: "text", text: "a\nb" }], isError: false },
        ],
      },
    });
    const out = screen.writes.slice(-3);
    expect(strip(out[0])).toMatch(/^✓ bash {2}ls {2}\d+\.\ds\n$/);
    expect(strip(out[1]).trim()).toBe("a");
    expect(strip(out[2]).trim()).toBe("b");
  });

  test("errored tool result draws ✗", () => {
    const { screen, event } = setup();
    event("tool/call", { turn: 1, step: 0, callId: "t1", name: "bash", arguments: "{}" });
    event("tool/result", {
      turn: 1,
      step: 0,
      message: {
        content: [{ type: "tool-result", toolCallId: "t1", content: [{ type: "text", text: "boom" }], isError: true }],
      },
    });
    expect(strip(screen.writes[screen.writes.length - 2]).startsWith("✗")).toBe(true);
  });

  test("turn/end error prints the failure", () => {
    const { screen, event } = setup();
    event("turn/end", { turn: 1, reason: { kind: "error", error: { code: "LLM_TIMEOUT", message: "timed out" } } });
    expect(screen.all).toContain("✗ LLM_TIMEOUT: timed out");
  });

  test("turn/end aborted prints cancelled", () => {
    const { screen, event } = setup();
    event("turn/end", { turn: 1, reason: { kind: "aborted", reason: { kind: "user" } } });
    expect(strip(screen.all)).toContain("— cancelled");
  });

  test("events from another agent or session are ignored", () => {
    const { screen, fake, event } = setup();
    const other = { session: { id: "other" } };
    fake.emit("agent/assistant-stream", {
      agent: other,
      frame: { type: "chunk", chunk: { type: "reasoning-delta", text: "nope" } },
    });
    event("tool/call", { turn: 1, step: 0, callId: "x", name: "bash", arguments: "{}" }, { id: "other" });
    expect(screen.writes).toHaveLength(0);
  });
});
