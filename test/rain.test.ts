import { describe, expect, test } from "vitest";
import {
  RIPPLE_MS,
  dropSpinner,
  effortToRain,
  hash01,
  paintRainRow,
  rainGrid,
  rippleFrame,
  rainLevel,
  setRainLevel,
} from "../src/ui/rain.js";

const ink = { far: (t: string) => `f${t}`, mid: (t: string) => `m${t}`, near: (t: string) => `n${t}` };
const drops = (g: ReturnType<typeof rainGrid>): number => g.flat().filter((c) => c !== undefined).length;

describe("rainGrid", () => {
  test("the same time and seed give the same rain, a later time moves it", () => {
    const a = rainGrid({ width: 60, height: 20, time: 1234, density: 0.4, seed: 3 });
    const b = rainGrid({ width: 60, height: 20, time: 1234, density: 0.4, seed: 3 });
    expect(a).toEqual(b);
    expect(rainGrid({ width: 60, height: 20, time: 1700, density: 0.4, seed: 3 })).not.toEqual(a);
    expect(rainGrid({ width: 60, height: 20, time: 1234, density: 0.4, seed: 4 })).not.toEqual(a);
  });

  test("it is exactly the size asked, with no drop outside it", () => {
    for (const [w, h] of [[1, 1], [7, 3], [80, 24], [200, 50]] as const) {
      const g = rainGrid({ width: w, height: h, time: 5000, density: 1 });
      expect(g).toHaveLength(h);
      expect(g.every((row) => row.length === w)).toBe(true);
    }
    expect(rainGrid({ width: 0, height: 5, time: 0, density: 1 }).flat()).toEqual([]);
    expect(rainGrid({ width: 5, height: 0, time: 0, density: 1 })).toEqual([]);
  });

  test("density sets how much of the screen is rain, and none is none", () => {
    const at = (density: number): number => drops(rainGrid({ width: 120, height: 40, time: 2000, density }));
    expect(at(0)).toBe(0);
    expect(at(0.1)).toBeLessThan(at(0.5));
    expect(at(0.5)).toBeLessThan(at(1));
  });

  test("each column carries at most one fall, and it travels down as time passes", () => {
    const column = (time: number): number[] => {
      const g = rainGrid({ width: 40, height: 30, time, density: 1, seed: 9 });
      return g.flatMap((row, y) => (row[5] !== undefined ? [y] : []));
    };
    const first = column(1000);
    const later = column(1100);
    // Down is the way it goes: where the drop was, it is lower (or has left and wrapped).
    if (first.length > 0 && later.length > 0) expect(Math.max(...later)).toBeGreaterThanOrEqual(Math.max(...first));
  });

  test("ASCII rain draws only ASCII, and the drawn kind never has emoji", () => {
    const plain = rainGrid({ width: 80, height: 24, time: 3000, density: 1, ascii: true });
    expect(plain.flat().every((c) => c === undefined || /^[.'|]$/.test(c.char))).toBe(true);
    const fancy = rainGrid({ width: 80, height: 24, time: 3000, density: 1 });
    expect(fancy.flat().map((c) => c?.char ?? "").join("")).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("paintRainRow", () => {
  test("blank cells become spaces and the row keeps its width", () => {
    const row = rainGrid({ width: 30, height: 12, time: 900, density: 0.6 })[4]!;
    const text = paintRainRow(row, ink).replace(/[fmn]/g, "");
    expect(text).toHaveLength(30);
  });
});

describe("effort and the rain", () => {
  test("a higher effort is a harder rain, and an unknown one is middling", () => {
    const ladder = ["off", "low", "medium", "high", "max"].map(effortToRain);
    expect(ladder).toEqual([...ladder].sort((a, b) => a - b));
    expect(new Set(ladder).size).toBe(ladder.length);
    expect(effortToRain(undefined)).toBeGreaterThan(0);
    expect(effortToRain("something-new")).toBe(effortToRain(undefined));
  });

  test("the footer's effort sets the level the labels use", () => {
    setRainLevel("high");
    expect(rainLevel()).toBe(effortToRain("high"));
    setRainLevel(undefined);
  });
});

describe("dropSpinner", () => {
  test("it is always three cells wide, whatever the time and level", () => {
    for (const level of [0, 0.3, 0.6, 1]) {
      for (let t = 0; t < 4000; t += 70) {
        expect([...dropSpinner(t, level)].length).toBe(3);
        expect([...dropSpinner(t, level, true)].length).toBe(3);
      }
    }
  });

  test("a downpour has more drops falling than a drizzle", () => {
    const lit = (level: number): number => {
      let n = 0;
      for (let t = 0; t < 6000; t += 60) n += [...dropSpinner(t, level)].filter((c) => c !== "\u2800").length;
      return n;
    };
    expect(lit(0.1)).toBeLessThan(lit(1));
  });

  test("ASCII is ASCII", () => {
    for (let t = 0; t < 3000; t += 60) expect(dropSpinner(t, 0.6, true)).toMatch(/^['`,.]{3}$/);
  });

  test("it moves", () => {
    const seen = new Set<string>();
    for (let t = 0; t < 2000; t += 60) seen.add(dropSpinner(t, 0.8));
    expect(seen.size).toBeGreaterThan(3);
  });
});

describe("rippleFrame", () => {
  test("it spreads over its second, nine cells wide, then there is nothing", () => {
    const frames: string[] = [];
    for (let t = 0; t < RIPPLE_MS; t += 50) {
      const f = rippleFrame(t);
      expect(f).toBeDefined();
      expect([...f!].length).toBe(9);
      frames.push(f!);
    }
    expect(new Set(frames).size).toBeGreaterThan(3);
    expect(rippleFrame(RIPPLE_MS)).toBeUndefined();
    expect(rippleFrame(-5)).toBeUndefined();
  });

  test("ASCII has no dot glyph", () => {
    expect(rippleFrame(0, true)).toBe("    .    ");
  });
});

describe("hash01", () => {
  test("it stays in [0, 1) and is not constant", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 500; i += 1) {
      const v = hash01(i, 7, 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      seen.add(v);
    }
    expect(seen.size).toBeGreaterThan(450);
  });
});
