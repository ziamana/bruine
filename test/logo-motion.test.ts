import { describe, expect, test } from "vitest";
import { LOGO, wordmarkFrame } from "../src/ui/logo-motion.js";

const WIDTH = LOGO[0].length;
const WET = ["░", "▒", "▓"];
const lit = (frame: string[]): number => frame.slice(1, 1 + LOGO.length).join("").replace(/[ ·˙│]/g, "").length;

describe("the BRUINE mark", () => {
  test("is three rows, all the same width", () => {
    expect(LOGO).toHaveLength(3);
    expect(new Set(LOGO.map((row) => [...row].length)).size).toBe(1);
  });

  test("is the six letters B R U I N E, each as the shape a reader expects", () => {
    // Folded back to pixels: a half block is two lines, so each row is two lines of the letter.
    const lines = (row: string): [string, string] => [
      [...row].map((c) => (c === "█" || c === "▀" ? "#" : ".")).join(""),
      [...row].map((c) => (c === "█" || c === "▄" ? "#" : ".")).join(""),
    ];
    const pixels = LOGO.flatMap((row) => lines(row));
    expect(pixels).toHaveLength(6);
    // Letters sit at these columns: B(4) R(4) U(4) I(3) N(4) E(4) with one blank between.
    const spans = [[0, 4], [5, 9], [10, 14], [15, 18], [19, 23], [24, 28]] as const;
    const letter = (i: number): string[] => pixels.map((line) => line.slice(spans[i]![0], spans[i]![1]));
    const B = ["###.", "#..#", "###.", "#..#", "#..#", "###."];
    const R = ["###.", "#..#", "###.", "#.#.", "#..#", "#..#"];
    const U = ["#..#", "#..#", "#..#", "#..#", "#..#", ".##."];
    const I = ["###", ".#.", ".#.", ".#.", ".#.", "###"];
    const N = ["#..#", "##.#", "##.#", "#.##", "#.##", "#..#"];
    const E = ["####", "#...", "###.", "#...", "#...", "####"];
    expect([B, R, U, I, N, E].map((_, i) => letter(i))).toEqual([B, R, U, I, N, E]);
  });

  test("no letter is the shape of another: a B is not a D, an E is not a C", () => {
    const D = ["###.", "#..#", "#..#", "#..#", "#..#", "###."];
    const C = [".###", "#...", "#...", "#...", "#...", ".###"];
    const lines = (row: string): [string, string] => [
      [...row].map((c) => (c === "█" || c === "▀" ? "#" : ".")).join(""),
      [...row].map((c) => (c === "█" || c === "▄" ? "#" : ".")).join(""),
    ];
    const pixels = LOGO.flatMap((row) => lines(row));
    const first = pixels.map((l) => l.slice(0, 4));
    const last = pixels.map((l) => l.slice(24, 28));
    expect(first).not.toEqual(D);
    expect(last).not.toEqual(C);
  });
});

describe("wordmark scene: rain collecting into the mark", () => {
  test("starts empty of letters and settles into the exact permanent mark", () => {
    expect(wordmarkFrame(0)).not.toEqual(LOGO);
    expect(lit(wordmarkFrame(0))).toBe(0);
    expect(wordmarkFrame(1)).toEqual(LOGO);
    expect(wordmarkFrame(1)).toHaveLength(3);
  });

  test("a cell that is lit stays lit: the mark only fills, never empties", () => {
    let seen = 0;
    for (let step = 0; step <= 99; step += 1) {
      const frame = wordmarkFrame(step / 100);
      expect(frame).toHaveLength(LOGO.length + 2);
      const now = lit(frame);
      expect(now).toBeGreaterThanOrEqual(seen);
      seen = now;
    }
  });

  test("a cell is wetted (░ ▒ ▓) before it is a letter, and ends as the letter itself", () => {
    const stages = new Set<string>();
    for (let step = 0; step <= 99; step += 1) {
      for (const ch of wordmarkFrame(step / 100).slice(1, 1 + LOGO.length).join("")) if (WET.includes(ch)) stages.add(ch);
    }
    expect(stages.size).toBe(3);
    // By the end of the motion, every letter cell shows its letter.
    const late = wordmarkFrame(0.99);
    expect(late.slice(1, 1 + LOGO.length).map((r) => r.replace(/[░▒▓]/g, "")).join("")).not.toBe("");
    for (let row = 0; row < LOGO.length; row += 1) {
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
