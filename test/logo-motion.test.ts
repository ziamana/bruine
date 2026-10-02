import { describe, expect, test } from "vitest";
import { LOGO, wordmarkFrame } from "../src/ui/logo-motion.js";

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
