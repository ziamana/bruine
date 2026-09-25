import { describe, expect, test } from "vitest";
import { ReasoningLine, type Screen } from "../src/render/reasoning.js";

class FakeScreen implements Screen {
  writes: string[] = [];
  columns = 80;
  write(s: string): void {
    this.writes.push(s);
  }
  get last(): string {
    return this.writes[this.writes.length - 1] ?? "";
  }
}

function fakeClock(start: number) {
  let t = start;
  return {
    now: () => t,
    set: (v: number) => {
      t = v;
    },
  };
}

describe("ReasoningLine", () => {
  test("1. deltas accumulate on one line", () => {
    const s = new FakeScreen();
    const r = new ReasoningLine(s);
    r.push("Let me");
    r.push(" check");
    expect(s.last).toContain("💭 Let me check");
    expect(r.active).toBe(true);
  });

  test("2. a newline finishes the line; only the new one shows", () => {
    const s = new FakeScreen();
    const r = new ReasoningLine(s);
    r.push("line one\nline t");
    expect(s.last).toContain("💭 line t");
    expect(s.last).not.toContain("line one");
  });

  test("3. after a trailing newline the finished line stays visible", () => {
    const s = new FakeScreen();
    const r = new ReasoningLine(s);
    r.push("done\n");
    expect(s.last).toContain("💭 done");
  });

  test("4. long lines are truncated to columns, keeping the tail", () => {
    const s = new FakeScreen();
    s.columns = 20;
    const r = new ReasoningLine(s);
    const long = "x".repeat(50);
    r.push(long);
    // strip escape codes and the prefix
    const text = s.last
      .replace(/\r/g, "")
      .replace(/\x1b\[[0-9]*[A-Za-z]/g, "")
      .replace("💭 ", "");
    expect(text.length).toBeLessThanOrEqual(16);
    expect(text.startsWith("…")).toBe(true);
  });

  test("5. end() shows the elapsed time with one decimal", () => {
    const s = new FakeScreen();
    const clock = fakeClock(1000);
    const r = new ReasoningLine(s, clock.now);
    r.push("thinking");
    clock.set(5200);
    r.end();
    expect(s.last).toContain("💭 thought for 4.2s");
    expect(s.last.endsWith("\n")).toBe(true);
    expect(r.active).toBe(false);
  });

  test("6. end() without any push writes nothing", () => {
    const s = new FakeScreen();
    const r = new ReasoningLine(s);
    r.end();
    expect(s.writes).toHaveLength(0);
  });

  test("empty push writes nothing", () => {
    const s = new FakeScreen();
    const r = new ReasoningLine(s);
    r.push("");
    expect(s.writes).toHaveLength(0);
    expect(r.active).toBe(false);
  });

  test("every redraw clears the line first and is dim", () => {
    const s = new FakeScreen();
    const r = new ReasoningLine(s);
    r.push("hi");
    expect(s.last.startsWith("\r\x1b[2K")).toBe(true);
    expect(s.last).toContain("\x1b[2m");
    expect(s.last).toContain("\x1b[22m");
  });
});
