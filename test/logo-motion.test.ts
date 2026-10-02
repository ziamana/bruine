import { describe, expect, test } from "vitest";
import { ignitionFrame, litCells, LOGO, wordmarkFrame } from "../src/ui/logo-motion.js";

const GLYPHS = new Set([" ", "█", "▀", "▄", "░", "▓"]);

/** Cells the mark is actually made of, so a space in the mark stays a space. */
const solid = (frame: string[]): Array<[number, number]> => {
  const cells: Array<[number, number]> = [];
  frame.forEach((line, row) => {
    [...line].forEach((glyph, column) => {
      if (glyph !== " ") cells.push([row, column]);
    });
  });
  return cells;
};

const bits = (glyph: string): number => {
  if (glyph === "▀") return 1;
  if (glyph === "▄") return 2;
  if (glyph === "█") return 3;
  return 0;
};

describe("wordmark scene", () => {
  test("settles into the exact permanent mark", () => {
    expect(wordmarkFrame(0)).not.toEqual(LOGO);
    expect(wordmarkFrame(1)).toEqual(LOGO);
  });

  test("fills sublines monotonically until the fold, then contracts to two rows", () => {
    let previous = Array.from({ length: 4 }, () => Array(17).fill(0) as number[]);
    for (let step = 0; step <= 75; step += 1) {
      const frame = wordmarkFrame(step / 100);
      expect(frame).toHaveLength(4);
      const current = frame.map((line) => [...line].map(bits));
      for (let row = 0; row < 4; row += 1) {
        for (let col = 0; col < 17; col += 1) {
          expect(current[row]![col]! & previous[row]![col]!).toBe(previous[row]![col]);
        }
      }
      previous = current;
    }
    expect(wordmarkFrame(0.9)).toHaveLength(4);
    expect(wordmarkFrame(1)).toHaveLength(2);
  });

  test("every frame occupies seventeen columns and has no emoji", () => {
    for (let step = 0; step <= 100; step += 1) {
      const frame = wordmarkFrame(step / 100);
      expect(frame.every((line) => [...line].length === 17)).toBe(true);
      expect(frame.join("")).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});

describe("ignition scene", () => {
  test("every cell of the mark is present from the first frame, in one material", () => {
    for (let step = 0; step <= 100; step += 1) {
      const frame = ignitionFrame(step / 100);
      expect(frame).toHaveLength(2);
      expect(frame.every((line) => [...line].length === LOGO[0]!.length)).toBe(true);
      expect([...frame.join("")].every((glyph) => GLYPHS.has(glyph))).toBe(true);
      // Ghosted cells keep their place in the wordmark, so the letters are
      // readable while the light is still moving through them.
      expect(solid(frame)).toEqual(solid([...LOGO]));
      expect(frame.join("")).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  test("light only ever moves right, and never un-lights a cell", () => {
    const lit = (frame: string[], row: number): boolean[] =>
      [...frame[row]!].map((glyph) => glyph !== "░");
    let previous = lit(ignitionFrame(0), 0);
    for (let step = 1; step <= 100; step += 1) {
      const current = lit(ignitionFrame(step / 100), 0);
      for (let column = 0; column < current.length; column += 1) {
        if (previous[column] === true) expect(current[column]).toBe(true);
      }
      previous = current;
    }
  });

  test("the head starts inside the mark and stops short of the end", () => {
    expect(litCells(0)).toBeGreaterThan(0);
    expect(litCells(0)).toBeLessThan(LOGO[0]!.length);
    // A loading mark that reaches the end on a clock would be claiming a
    // session nobody has reported yet.
    expect(litCells(1)).toBeLessThan(LOGO[0]!.length);
    expect(ignitionFrame(1).join("")).toContain("░");
  });
});
