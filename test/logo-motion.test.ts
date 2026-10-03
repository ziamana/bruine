import { describe, expect, test } from "vitest";
import { LOGO, wordmarkFrame } from "../src/ui/logo-motion.js";

const WIDTH = LOGO[0].length;
const WET = ["░", "▒", "▓"];
const lit = (frame: string[]): number => frame.slice(1, 3).join("").replace(/[ ·˙│]/g, "").length;

describe("the BRUINE mark", () => {
  test("is two rows, the same width, and reads as the six letters", () => {
    expect(LOGO).toHaveLength(2);
    expect([...LOGO[0]]).toHaveLength([...LOGO[1]].length);
    expect(LOGO[0]).toBe("█▀▄ █▀▄ █ █ █ █▄ █ █▀▀");
    expect(LOGO[1]).toBe("█▄▀ █▀▄ █▄█ █ █ ▀█ █▄▄");
  });
});

describe("wordmark scene: rain collecting into the mark", () => {
  test("starts empty of letters and settles into the exact permanent mark", () => {
    expect(wordmarkFrame(0)).not.toEqual(LOGO);
    expect(lit(wordmarkFrame(0))).toBe(0);
    expect(wordmarkFrame(1)).toEqual(LOGO);
    expect(wordmarkFrame(1)).toHaveLength(2);
  });

  test("a cell that is lit stays lit: the mark only fills, never empties", () => {
    let seen = 0;
    for (let step = 0; step <= 99; step += 1) {
      const frame = wordmarkFrame(step / 100);
      expect(frame).toHaveLength(4);
      const now = lit(frame);
      expect(now).toBeGreaterThanOrEqual(seen);
      seen = now;
    }
  });

  test("a cell is wetted (░ ▒ ▓) before it is a letter, and ends as the letter itself", () => {
    const stages = new Set<string>();
    for (let step = 0; step <= 99; step += 1) {
      for (const ch of wordmarkFrame(step / 100).slice(1, 3).join("")) if (WET.includes(ch)) stages.add(ch);
    }
    expect(stages.size).toBe(3);
    // By the end of the motion, every letter cell shows its letter.
    const late = wordmarkFrame(0.99);
    expect(late.slice(1, 3).map((r) => r.replace(/[░▒▓]/g, "")).join("")).not.toBe("");
    for (let row = 0; row < 2; row += 1) {
      for (let col = 0; col < WIDTH; col += 1) {
        const target = LOGO[row]![col]!;
        if (target === " ") expect(late[row + 1]![col]).toBe(" ");
      }
    }
  });

  test("rain falls through the rows above the letters while they fill", () => {
    let streaks = 0;
    for (let step = 0; step < 100; step += 1) streaks += [...wordmarkFrame(step / 100)[0]!].filter((c) => c === "│").length;
    expect(streaks).toBeGreaterThan(5);
  });

  test("every frame occupies exactly the mark's width and has no emoji", () => {
    for (let step = 0; step <= 100; step += 1) {
      const frame = wordmarkFrame(step / 100);
      expect(frame.every((line) => [...line].length === WIDTH)).toBe(true);
      expect(frame.join("")).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  test("a phase outside 0..1 or not a number is clamped, never a crash", () => {
    expect(wordmarkFrame(-3)).toEqual(wordmarkFrame(0));
    expect(wordmarkFrame(7)).toEqual([...LOGO]);
    expect(wordmarkFrame(Number.NaN)).toEqual(wordmarkFrame(0));
  });
});
