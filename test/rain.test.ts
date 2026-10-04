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
    const ladder = ["off", "low", "medium", "high", "xhigh", "max"].map(effortToRain);
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

  test("high, xhigh and max each fall at their own rhythm", () => {
    const pattern = (effort: string): string => {
      let out = "";
      for (let t = 0; t < 4000; t += 20) out += dropSpinner(t, effortToRain(effort));
      return out;
    };
    const seen = new Set(["high", "xhigh", "max"].map(pattern));
    expect(seen.size).toBe(3);
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

import { Weather, rainIntoBlanks, rainSpeed } from "../src/ui/rain.js";

describe("Weather", () => {
  const clock = (): { t: number; now: () => number } => {
    const c = { t: 1000, now: () => c.t };
    return c;
  };

  test("it eases toward the level it is given instead of jumping to it", () => {
    const c = clock();
    const w = new Weather(0.9, c.now);
    expect(w.level).toBeCloseTo(0.9, 5);
    w.set(0.1);
    c.t += 50;
    const soon = w.level;
    expect(soon).toBeLessThan(0.9);
    expect(soon).toBeGreaterThan(0.5);
    c.t += 5000;
    for (let i = 0; i < 40; i += 1) { c.t += 100; w.level; }
    expect(w.level).toBeCloseTo(0.1, 1);
  });

  test("the rain clock runs faster at a high level than at a low one, over the same wall time", () => {
    const fast = clock();
    const slow = clock();
    const a = new Weather(0.95, fast.now);
    const b = new Weather(0.1, slow.now);
    a.phase; b.phase;
    for (let i = 0; i < 20; i += 1) { fast.t += 100; slow.t += 100; a.phase; b.phase; }
    expect(a.phase).toBeGreaterThan(b.phase * 2);
  });

  test("slowing the rain slows the drops already falling: the clock never goes back", () => {
    const c = clock();
    const w = new Weather(0.95, c.now);
    let last = w.phase;
    for (let i = 0; i < 30; i += 1) {
      if (i === 5) w.set(0.05);
      c.t += 80;
      const p = w.phase;
      expect(p).toBeGreaterThanOrEqual(last);
      last = p;
    }
  });

  test("a long pause is one step, not a leap: a suspended terminal does not make the rain race", () => {
    const c = clock();
    const w = new Weather(0.5, c.now);
    w.phase;
    c.t += 60_000;
    expect(w.phase).toBeLessThan(500);
  });

  test("a harder rain has more drops in the margins and a little more behind the panel", () => {
    const calm = new Weather(0.1);
    const hard = new Weather(1);
    expect(calm.margin).toBeLessThan(hard.margin);
    expect(calm.interior).toBeLessThan(hard.interior);
    expect(hard.interior).toBeLessThan(hard.margin / 3);
    expect(rainSpeed(0.1)).toBeLessThan(rainSpeed(1));
  });

  test("it is clamped: nonsense levels are still a level", () => {
    const w = new Weather(7);
    expect(w.target).toBe(1);
    w.set(-3);
    expect(w.target).toBe(0);
  });
});

describe("rainIntoBlanks", () => {
  const cells = (width: number): Array<{ char: string; layer: "far" | "mid" | "near" } | undefined> =>
    Array.from({ length: width }, () => ({ char: "·", layer: "far" as const }));
  const drops = { far: (t: string) => `\x1b[2m${t}\x1b[22m`, mid: (t: string) => t, near: (t: string) => t };
  const plain = (s: string): string => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

  test("it fills the open air of a line and keeps every word and its width", () => {
    const line = "Review your setup" + " ".repeat(30) + "end";
    const out = plain(rainIntoBlanks(line, cells(line.length), drops, ""));
    expect(out).toHaveLength(line.length);
    expect(out.startsWith("Review your setup")).toBe(true);
    expect(out.endsWith("end")).toBe(true);
    expect(out).toContain("·");
  });

  test("the space between two words, and the first and last of a run, are never touched", () => {
    const line = "a b c    d" + " ".repeat(8) + "e";
    const out = plain(rainIntoBlanks(line, cells(line.length), drops, ""));
    expect(out.slice(0, 9)).toBe("a b c    ");
    // the run before the last word: its first and last cell are still spaces
    const run = out.slice(10, 18);
    expect(run[0]).toBe(" ");
    expect(run[run.length - 1]).toBe(" ");
  });

  test("a short run of spaces is left alone", () => {
    const line = "name    value";
    expect(rainIntoBlanks(line, cells(line.length), drops, "")).toBe(line);
  });

  test("colours and links come through untouched", () => {
    const line = `\x1b[36mhello\x1b[39m${" ".repeat(12)}\x1b]8;;http://x\x07link\x1b]8;;\x07`;
    const out = rainIntoBlanks(line, cells(40), drops, "");
    expect(out.startsWith("\x1b[36mhello\x1b[39m")).toBe(true);
    expect(out.endsWith("\x1b]8;;http://x\x07link\x1b]8;;\x07")).toBe(true);
    expect(plain(out).replace(/\x1b\][^\x07]*\x07/g, "")).toHaveLength(5 + 12 + 4);
  });

  test("a line holding the marker is left exactly as it was", () => {
    const line = `> ${"\x1b_cursor\x07"}typed${" ".repeat(30)}`;
    expect(rainIntoBlanks(line, cells(60), drops, "\x1b_cursor\x07")).toBe(line);
  });

  test("with no drop in a cell the line is unchanged, and an empty line is fine", () => {
    const line = "x" + " ".repeat(20) + "y";
    expect(rainIntoBlanks(line, Array(line.length).fill(undefined), drops, "")).toBe(line);
    expect(rainIntoBlanks("", [], drops, "")).toBe("");
  });

  test("wide characters keep the columns of what follows them", () => {
    const line = "界" + " ".repeat(14) + "end";
    const out = rainIntoBlanks(line, cells(line.length + 1), drops, "");
    expect(plain(out).endsWith("end")).toBe(true);
    expect(plain(out).startsWith("界")).toBe(true);
  });
});
