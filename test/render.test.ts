import { describe, expect, test } from "vitest";
import { attach, createUi } from "../src/plugins/render.js";
import { UNICODE_ICONS } from "../src/render/chars.js";
import { fakeCtx, FakeScreen, strip } from "./fakes.js";

function setup() {
  const screen = new FakeScreen();
  const ui = createUi(screen, UNICODE_ICONS);
  const fake = fakeCtx();
  const session = { id: "s1" };
  const agent = { session };
  attach(fake.ctx as any, agent as any, ui);
  const frame = (chunk: unknown) => fake.emit("agent/assistant-stream", { agent, frame: { type: "chunk", index: 0, chunk } });
  const event = (type: string, data: unknown, sess: unknown = session) =>
    fake.emit("session/event", sess, { type, data });
  return { screen, ui, fake, agent, session, frame, event };
}

describe("render plugin (T24.5 piped, no spinner, no CR)", () => {
  test("reasoning deltas produce no output until block-end", () => {
    const { screen, frame } = setup();
    frame({ type: "reasoning-delta", text: "Let me" });
    frame({ type: "reasoning-delta", text: " think" });
    expect(screen.writes).toHaveLength(0);
    frame({ type: "block-end", block: { type: "reasoning", text: "hmm" } });
    expect(strip(screen.last)).toMatch(/^Thought for \d+\.\ds\n$/);
  });

  test("text deltas stream directly and block-end closes with one newline", () => {
    const { screen, frame } = setup();
    frame({ type: "text-delta", text: "Hel" });
    frame({ type: "text-delta", text: "lo" });
    expect(screen.all).toBe("Hello");
    frame({ type: "block-end", block: { type: "text", text: "Hello" } });
    expect(screen.all).toBe("Hello\n");
  });

  test("tool-call deltas produce no streaming header", () => {
    const { screen, frame } = setup();
    frame({ type: "tool-call-delta", id: "t1", name: "bash", argumentsDelta: '{"comm' });
    frame({ type: "tool-call-delta", id: "t1", argumentsDelta: 'and":"ls"}' });
    expect(screen.writes).toHaveLength(0);
  });

  test("durable tool/call alone produces no output", () => {
    const { screen, event } = setup();
    event("tool/call", { turn: 1, step: 0, callId: "t9", name: "read", arguments: '{"path":"a.ts"}' });
    expect(screen.writes).toHaveLength(0);
  });

  test("durable tool/call does not duplicate streamed call", () => {
    const { screen, frame, event } = setup();
    frame({ type: "tool-call-delta", id: "t1", name: "bash", argumentsDelta: '{"command":"ls"}' });
    const before = screen.writes.length;
    event("tool/call", { turn: 1, step: 0, callId: "t1", name: "bash", arguments: '{"command":"ls"}' });
    expect(screen.writes.length).toBe(before);
  });

  test("tool/result draws the result line and output preview once", () => {
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
    expect(strip(out[1])).toBe("  a\n");
    expect(strip(out[2])).toBe("  b\n");
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
    expect(strip(screen.all)).toContain("- cancelled");
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

  test("no CR, no spinner frames, no cursor codes in piped output", () => {
    const { screen, frame, event } = setup();
    frame({ type: "reasoning-delta", text: "thinking hard" });
    frame({ type: "text-delta", text: "hello" });
    frame({ type: "tool-call-delta", id: "t1", name: "read", argumentsDelta: '{"file_path":"note.txt"}' });
    event("tool/result", {
      turn: 1,
      step: 0,
      message: {
        content: [{ type: "tool-result", toolCallId: "t1", content: [{ type: "text", text: "line1\nline2" }], isError: false }],
      },
    });
    frame({ type: "block-end", block: { type: "reasoning", text: "x" } });
    frame({ type: "block-end", block: { type: "text", text: "hello" } });
    event("turn/end", { turn: 1, reason: { kind: "completed" } });
    const all = screen.writes.join("");
    expect(all).not.toContain("\r");
    expect(all).not.toMatch(/[·✢✺✶✻✽]/);
    expect(all).not.toContain("\x1b[?7");
    expect(all).not.toContain("\x1b[2K");
  });
});
