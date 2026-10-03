/**
 * A long session must not slow the screen down.
 *
 * The defect: every frame laid out every block of the transcript again (measured, clipped,
 * painted), settled ones included, so the cost of a frame grew with the length of the
 * conversation: a fifth of a second per frame at two hundred turns, which is a keystroke
 * answered late and a stream that stutters. A block that did not change is laid out once.
 */
import { describe, expect, test } from "vitest";
import { Text, type Component } from "@earendil-works/pi-tui";
import { ChatTranscript } from "../src/ui/chat-layout.js";
import { AssistantTextComponent } from "../src/ui/assistant-text.js";
import { ToolCallComponent } from "../src/ui/tool-call-component.js";
import { UNICODE_ICONS } from "../src/render/chars.js";

const plain = (s: string): string => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

class Probe implements Component {
  calls = 0;
  constructor(public lines: string[], readonly rail?: "blue" | "red" | "active") {}
  render(): string[] {
    this.calls += 1;
    return this.lines;
  }
  invalidate(): void {}
}

describe("ChatTranscript lays a block out once while it does not change", () => {
  test("the same lines at the same width come back as the same laid-out lines", () => {
    const t = new ChatTranscript(UNICODE_ICONS);
    t.addChild(new Probe(["one", "two"], "blue"));
    const first = t.render(80);
    const second = t.render(80);
    expect(second).toEqual(first);
    expect(plain(first.join("\n"))).toContain("one");
  });

  test("a block that changes is drawn again, and only that one", () => {
    const t = new ChatTranscript(UNICODE_ICONS);
    const still = new Probe(["settled"], "blue");
    const moving = new Probe(["before"], "blue");
    t.addChild(still);
    t.addChild(moving);
    const before = t.render(80).map(plain).join("\n");
    moving.lines = ["after"];
    const after = t.render(80).map(plain).join("\n");
    expect(before).toContain("before");
    expect(after).toContain("after");
    expect(after).not.toContain("before");
    expect(after).toContain("settled");
  });

  test("a new width lays the blocks out again", () => {
    const t = new ChatTranscript(UNICODE_ICONS);
    t.addChild(new Probe(["x".repeat(60)], "blue"));
    const wide = t.render(100).map(plain);
    const narrow = t.render(40).map(plain);
    expect(wide.every((l) => l.length <= 100)).toBe(true);
    expect(narrow.every((l) => l.length <= 40)).toBe(true);
    expect(narrow.join("")).not.toEqual(wide.join(""));
  });

  test("a rail that changes state repaints the block (a tool finishing)", () => {
    const t = new ChatTranscript(UNICODE_ICONS);
    const call = new Probe(["bash"], "active");
    t.addChild(call);
    const live = t.render(80).join("\n");
    (call as { rail?: string }).rail = "red";
    const failed = t.render(80).join("\n");
    expect(failed).not.toEqual(live);
  });

  test("a block with nothing to show stays out", () => {
    const t = new ChatTranscript(UNICODE_ICONS);
    t.addChild(new Probe([], "blue"));
    t.addChild(new Text("", 0, 0));
    expect(t.render(80)).toEqual([]);
  });
});

describe("a settled tool call is drawn once per width", () => {
  const done = (): ToolCallComponent => {
    const call = new ToolCallComponent("bash", () => 0, UNICODE_ICONS);
    call.args(JSON.stringify({ command: "ls", description: "list" }));
    call.result(true, "a\nb");
    return call;
  };

  test("repeated renders hand back the same lines", () => {
    const call = done();
    expect(call.render(80)).toBe(call.render(80));
  });

  test("another width is another drawing", () => {
    const call = done();
    expect(call.render(80)).not.toBe(call.render(50));
  });

  test("a call still running is drawn every time, since its spinner moves", () => {
    let now = 0;
    const call = new ToolCallComponent("bash", () => now, UNICODE_ICONS);
    call.args(JSON.stringify({ command: "sleep 9", description: "wait" }));
    const a = call.render(80).join("\n");
    now = 400;
    const b = call.render(80).join("\n");
    expect(a).not.toEqual(b);
  });

  test("finishing it replaces what was drawn while it ran", () => {
    const call = new ToolCallComponent("bash", () => 0, UNICODE_ICONS);
    call.args(JSON.stringify({ command: "ls", description: "list" }));
    const running = call.render(80).join("\n");
    call.result(true, "out");
    expect(call.render(80).join("\n")).not.toEqual(running);
  });
});

describe("a finished answer is shaped once", () => {
  test("repeated renders hand back the same lines until the text changes", () => {
    const a = new AssistantTextComponent({ animate: false });
    a.push("Hello **world**\n\nsecond paragraph");
    a.finish();
    const first = a.render(80);
    expect(a.render(80)).toBe(first);
    a.push("\n\nthird");
    expect(plain(a.render(80).join("\n"))).toContain("third");
  });

  test("a new width reshapes it", () => {
    const a = new AssistantTextComponent({ animate: false });
    a.push("word ".repeat(40));
    a.finish();
    expect(a.render(30).length).toBeGreaterThan(a.render(120).length);
  });
});
