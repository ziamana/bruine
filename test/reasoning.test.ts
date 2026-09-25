import stringWidth from "string-width";
import { describe, expect, test } from "vitest";
import { clipCells, ReasoningLine, splitReasoningSegments, SPINNER_FRAMES, ASCII_SPINNER_FRAMES } from "../src/render/reasoning.js";
import { ASCII_ICONS, UNICODE_ICONS } from "../src/render/chars.js";
import { FakeScreen, strip } from "./fakes.js";

function sentences(...chunks: string[]) {
  let state = { current: "", lastFinished: "", finishedAny: false };
  return chunks.map(chunk => state = splitReasoningSegments(state.current, state.lastFinished, chunk));
}
describe("complete reasoning sentences", () => {
  test("buffers incomplete tokens and publishes an entire sentence at once", () => {
    const states = sentences("Let me", " check", ".", " Next partial");
    expect(states.slice(0, 3).map(s => s.lastFinished)).toEqual(["", "", ""]);
    expect(states[3]).toEqual({ current: "Next partial", lastFinished: "Let me check.", finishedAny: true });
  });
  test.each([".", "!", "?", "…"])("%s followed by space completes a sentence", mark => {
    expect(sentences(`One${mark} Two`).at(-1)?.lastFinished).toBe(`One${mark}`);
  });
  test("newlines complete the accumulated sentence, empty lines don't erase it", () => {
    expect(sentences("first half", " second half\n\nunfinished").at(-1)).toEqual({ current: "unfinished", lastFinished: "first half second half", finishedAny: true });
  });
  test("keeps only the LAST complete sentence and hides its partial successor", () => {
    expect(sentences("First. Second! Third? incomplete").at(-1)?.lastFinished).toBe("Third?");
  });
  test("does not split decimals, e.g., or i.e., even at chunk boundaries", () => {
    const states = sentences("Use 3.", "5, e.g.", " this, i.e.", " that. ");
    expect(states.slice(0, 3).map(s => s.lastFinished)).toEqual(["", "", ""]);
    expect(states.at(-1)?.lastFinished).toBe("Use 3.5, e.g. this, i.e. that.");
  });
  test("removes emoji and terminal control characters from display text", () => {
    expect(sentences("🙂漢字\tcheck\n")[0]?.lastFinished).toBe("漢字 check");
  });
  test("clips the END by display cells, preserves grapheme clusters", () => {
    const text = "開始e\u0301".repeat(20);
    const clipped = clipCells(text, 20);
    expect(clipped.startsWith("開始e\u0301")).toBe(true);
    expect(clipped.endsWith("…")).toBe(true);
    expect(stringWidth(clipped)).toBeLessThanOrEqual(20);
    expect(clipCells(text, 0)).toBe("");
    expect(clipCells(text, 1)).toBe("…");
  });
  test("every required spinner frame passes the strict Unicode property check", () => {
    expect(SPINNER_FRAMES.join(" ")).toBe("· ✢ ✺ ✶ ✻ ✽ ✻ ✶ ✺ ✢");
    expect(SPINNER_FRAMES.join("")).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(ASCII_SPINNER_FRAMES).toEqual(["-", "\\", "|", "/"]);
  });
});

describe("ReasoningLine (T24.5 piped)", () => {
  test("pushes produce no output until end", () => {
    const s = new FakeScreen();
    const r = new ReasoningLine(s, () => 0, UNICODE_ICONS);
    r.push("unfinished");
    expect(s.writes).toHaveLength(0);
    expect(r.active).toBe(true);
  });
  test("end writes Thought for once, then inactive", () => {
    const s = new FakeScreen();
    let time = 0;
    const r = new ReasoningLine(s, () => time, UNICODE_ICONS);
    for (const chunk of ["One", ". ", "Next\n\n", "partial"]) r.push(chunk);
    expect(s.writes).toHaveLength(0);
    time = 4200;
    r.end();
    expect(strip(s.last)).toBe("Thought for 4.2s\n");
    expect(s.last).not.toContain("\r");
    expect(s.last).not.toMatch(/[·✢✺✶✻✽]/);
    expect(r.active).toBe(false);
    const count = s.writes.length;
    r.end();
    expect(s.writes).toHaveLength(count);
  });
  test("empty inputs/end do not draw", () => {
    const s = new FakeScreen();
    const r = new ReasoningLine(s, () => 0, UNICODE_ICONS);
    r.push(""); r.end();
    expect(s.writes).toHaveLength(0);
    r.push("x");
    expect(s.writes).toHaveLength(0);
    r.end();
    expect(s.writes).toHaveLength(1);
  });
  test("ASCII fallback also plain", () => {
    const s = new FakeScreen(); s.columns = 25;
    const r = new ReasoningLine(s, () => 0, ASCII_ICONS);
    r.push("x".repeat(100) + "\n");
    expect(s.writes).toHaveLength(0);
    r.end();
    expect(strip(s.last)).toMatch(/^Thought for \d+\.\ds\n$/);
    expect(strip(s.last)).not.toMatch(/[^\x00-\x7f\n]/);
  });
});
