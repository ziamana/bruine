import stringWidth from "string-width";
import { describe, expect, test } from "vitest";
import { ReasoningLine } from "../src/render/reasoning.js";
import { UNICODE_ICONS } from "../src/render/chars.js";
import { FakeScreen, strip } from "./fakes.js";

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
    const r = new ReasoningLine(s, Date.now, UNICODE_ICONS);
    r.push("Let me");
    r.push(" check");
    expect(s.last).toContain("💭 Let me check");
    expect(r.active).toBe(true);
  });

  test("2. a newline finishes the line; only the new one shows", () => {
    const s = new FakeScreen();
    const r = new ReasoningLine(s, Date.now, UNICODE_ICONS);
    r.push("line one\nline t");
    expect(s.last).toContain("💭 line t");
    expect(s.last).not.toContain("line one");
  });

  test("3. after a trailing newline the finished line stays visible", () => {
    const s = new FakeScreen();
    const r = new ReasoningLine(s, Date.now, UNICODE_ICONS);
    r.push("done\n");
    expect(s.last).toContain("💭 done");
  });

  test("4. long lines are truncated to columns, keeping the tail", () => {
    const s = new FakeScreen();
    s.columns = 20;
    const r = new ReasoningLine(s, Date.now, UNICODE_ICONS);
    r.push("x".repeat(50));
    const text = strip(s.last).replace("💭 ", "");
    expect(text.length).toBeLessThanOrEqual(16);
    expect(text.startsWith("…")).toBe(true);
  });

  test("5. end() shows the elapsed time with one decimal", () => {
    const s = new FakeScreen();
    const clock = fakeClock(1000);
    const r = new ReasoningLine(s, clock.now, UNICODE_ICONS);
    r.push("thinking");
    clock.set(5200);
    r.end();
    expect(s.last).toContain("💭 thought for 4.2s");
    expect(s.last.endsWith("\n")).toBe(true);
    expect(r.active).toBe(false);
  });

  test("6. end() without any push writes nothing", () => {
    const s = new FakeScreen();
    const r = new ReasoningLine(s, Date.now, UNICODE_ICONS);
    r.end();
    expect(s.writes).toHaveLength(0);
  });

  test("empty push writes nothing", () => {
    const s = new FakeScreen();
    const r = new ReasoningLine(s, Date.now, UNICODE_ICONS);
    r.push("");
    expect(s.writes).toHaveLength(0);
    expect(r.active).toBe(false);
  });

  test("every redraw clears the line, is dim and guards autowrap", () => {
    const s = new FakeScreen();
    const r = new ReasoningLine(s, Date.now, UNICODE_ICONS);
    r.push("hi");
    expect(s.last.startsWith("\r\x1b[2K")).toBe(true);
    expect(s.last).toContain("\x1b[2m");
    expect(s.last).toContain("\x1b[22m");
    expect(s.last).toContain("\x1b[?7l");
    expect(s.last).toContain("\x1b[?7h");
  });

  // T12 — stacking hotfix acceptance

  test("T12.1 paragraph break: no write ever contains a raw newline", () => {
    const s = new FakeScreen();
    const r = new ReasoningLine(s, Date.now, UNICODE_ICONS);
    r.push("a\n\nb");
    expect(s.writes.every((w) => !w.includes("\n"))).toBe(true);
    expect(strip(s.last)).toBe("💭 b");
  });

  test("T12.2 trailing blank segments keep the last finished line", () => {
    const s = new FakeScreen();
    const r = new ReasoningLine(s, Date.now, UNICODE_ICONS);
    r.push("first\n\n");
    expect(s.writes.every((w) => !w.includes("\n"))).toBe(true);
    expect(strip(s.last)).toBe("💭 first");
  });

  test("T12.3 control characters are sanitized to spaces", () => {
    const s = new FakeScreen();
    const r = new ReasoningLine(s, Date.now, UNICODE_ICONS);
    r.push("x\ty\rz");
    expect(strip(s.last)).toBe("💭 x y z");
  });

  test("T12.4 emoji/CJK width is measured in display cells", () => {
    const s = new FakeScreen();
    s.columns = 20;
    const r = new ReasoningLine(s, Date.now, UNICODE_ICONS);
    r.push("😀".repeat(10) + "あ".repeat(10) + "abc");
    expect(stringWidth(strip(s.last))).toBeLessThanOrEqual(19);
    expect(strip(s.last).startsWith("💭 ")).toBe(true);
  });

  test("T12.5 scripted 30-delta stream: the only newline comes from end()", () => {
    const s = new FakeScreen();
    const r = new ReasoningLine(s, Date.now, UNICODE_ICONS);
    const deltas = [
      "Let me ",
      "think\n",
      "about\n\n",
      "this",
      " paragraph\nbreaks\n",
      "\n",
      "a new",
      " start\n",
      "line one\nline two\nline three",
      " more\n\n\n",
      ...Array.from({ length: 20 }, (_, i) => `seg${i % 3} `),
      "end\n",
    ];
    expect(deltas.length).toBeGreaterThanOrEqual(30);
    for (const d of deltas) r.push(d);
    expect(s.writes.every((w) => !w.includes("\n"))).toBe(true);
    r.end();
    expect(s.writes.filter((w) => w.includes("\n"))).toHaveLength(1);
    expect(strip(s.writes[s.writes.length - 1]).endsWith("thought for 0.0s\n")).toBe(true);
  });
});
