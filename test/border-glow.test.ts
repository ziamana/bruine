/**
 * The prompt's frame says how hard the model thinks: a slow violet at high, a fast one at xhigh,
 * every colour at max, whichever model it is.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Component } from "@earendil-works/pi-tui";
import { GLOW_PERIOD_MS, glowColor, glowMode, tintBorder } from "../src/ui/border-glow.js";
import { PromptFrame } from "../src/ui/prompt-frame.js";
import { TurnActivity } from "../src/ui/turn-activity.js";
import { setRainLevel } from "../src/ui/rain.js";
import { ASCII_ICONS, UNICODE_ICONS } from "../src/render/chars.js";
import { resetColorDepth } from "../src/ui/palette.js";

const plain = (s: string): string => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
const rgbOf = (hex: string): [number, number, number] => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const distance = (a: string, b: string): number => {
  const [x, y] = [rgbOf(a), rgbOf(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};

describe("glowMode: by the name of the effort, in any model", () => {
  test("high is slow, xhigh is fast, max is every colour, and everything else is nothing", () => {
    expect(glowMode("high")).toBe("slow");
    expect(glowMode("xhigh")).toBe("fast");
    expect(glowMode("max")).toBe("rainbow");
    for (const quiet of ["off", "minimal", "low", "medium", "auto", "?", "", undefined, "ultra"]) expect(glowMode(quiet)).toBe("off");
  });

  test("case and spelling do not matter", () => {
    expect(glowMode(" HIGH ")).toBe("slow");
    expect(glowMode("XHigh")).toBe("fast");
    expect(glowMode("extra-high")).toBe("fast");
    expect(glowMode("Maximum")).toBe("rainbow");
  });
});

describe("glowColor", () => {
  const COLUMNS = Array.from({ length: 80 }, (_, i) => i);

  test("every colour is a real hex colour", () => {
    for (const mode of ["slow", "fast", "rainbow"] as const) {
      for (const c of COLUMNS) for (const t of [0, 333, 1700, 9000]) expect(glowColor(mode, c, t)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  test("the violet stays violet: blue is always at least as strong as green", () => {
    for (const mode of ["slow", "fast"] as const) {
      for (const c of COLUMNS) for (const t of [0, 250, 700, 2100]) {
        const [r, g, b] = rgbOf(glowColor(mode, c, t));
        expect(b).toBeGreaterThanOrEqual(g);
        expect(r).toBeGreaterThanOrEqual(g);
      }
    }
  });

  test("max is many colours at once across the frame, and they travel", () => {
    const row = (t: number): string[] => COLUMNS.map((c) => glowColor("rainbow", c, t));
    expect(new Set(row(0)).size).toBeGreaterThan(20);
    expect(row(0)).not.toEqual(row(800));
    // It repeats after one period.
    expect(row(0)).toEqual(row(GLOW_PERIOD_MS.rainbow));
  });

  test("the violet shimmer is fast at xhigh and slow at high: the same hundred milliseconds moves it further", () => {
    const moved = (mode: "slow" | "fast"): number => {
      let total = 0;
      for (const c of COLUMNS) total += distance(glowColor(mode, c, 0), glowColor(mode, c, 100));
      return total;
    };
    expect(moved("fast")).toBeGreaterThan(moved("slow") * 3);
    expect(GLOW_PERIOD_MS.fast).toBeLessThan(GLOW_PERIOD_MS.slow);
  });

  test("the pattern is a wave along the frame, not one colour for all of it", () => {
    expect(new Set(COLUMNS.map((c) => glowColor("slow", c, 0))).size).toBeGreaterThan(10);
  });
});

describe("tintBorder", () => {
  beforeEach(() => { process.env.BRUINE_COLOR = "truecolor"; resetColorDepth(); });
  afterEach(() => { process.env.BRUINE_COLOR = "basic"; resetColorDepth(); });
  const top = "╭─── Working 3s ──────────────╮";
  const body = "│ hello world                 │";

  test("it colours every border cell of a rule and leaves the text and the width as they were", () => {
    const out = tintBorder(top, "all", "slow", 0);
    expect(plain(out)).toBe(top);
    expect(out.match(/\x1b\[38;2;/g)!.length).toBe([...top].filter((c) => "─│╭╮╰╯".includes(c)).length);
  });

  test("on a row of the body only the two edges are border", () => {
    const out = tintBorder(body, "edges", "fast", 123);
    expect(plain(out)).toBe(body);
    expect(out.match(/\x1b\[38;2;/g)).toHaveLength(2);
  });

  test("a line of the body that holds its own box glyph in the text is still only two edges", () => {
    const line = "│ a │ b ─ c ╭ d │";
    expect(tintBorder(line, "edges", "slow", 0).match(/\x1b\[38;2;/g)).toHaveLength(2);
  });

  test("the colours and links already on the line come through", () => {
    const line = `\x1b[35m╭─\x1b[39m \x1b[1mWorking\x1b[22m \x1b]8;;http://x\x07link\x1b]8;;\x07 ${"─".repeat(6)}╮`;
    const out = tintBorder(line, "all", "rainbow", 50);
    expect(out).toContain("\x1b[1mWorking\x1b[22m");
    expect(out).toContain("\x1b]8;;http://x\x07link\x1b]8;;\x07");
    expect(plain(out).replace(/\x1b\][^\x07]*\x07/g, "")).toBe(plain(line).replace(/\x1b\][^\x07]*\x07/g, ""));
  });

  test("a line with no border is returned as it came, and an empty line is fine", () => {
    expect(tintBorder("just text", "all", "slow", 0)).toBe("just text");
    expect(tintBorder("", "all", "slow", 0)).toBe("");
    expect(tintBorder("x", "edges", "slow", 0)).toBe("x");
  });

  test("the same moment gives the same colours, a later one gives others", () => {
    expect(tintBorder(top, "all", "rainbow", 400)).toBe(tintBorder(top, "all", "rainbow", 400));
    expect(tintBorder(top, "all", "rainbow", 400)).not.toBe(tintBorder(top, "all", "rainbow", 1400));
  });
});

describe("the prompt frame", () => {
  const content: Component = {
    render: (width) => ["─".repeat(width), "> hello".padEnd(width), "─".repeat(width)],
    invalidate: () => {},
  };
  const editor = (focused = true) => ({ focused, borderColor: (t: string) => t, frameBottomRow: 2 });
  let saved: Record<string, string | undefined> = {};
  let tty: boolean | undefined;
  beforeEach(() => {
    saved = { c: process.env.BRUINE_COLOR, g: process.env.BRUINE_NO_GLOW, n: process.env.BRUINE_NO_ANIMATION, ci: process.env.CI, t: process.env.TERM, a: process.env.BRUINE_ASCII };
    process.env.BRUINE_COLOR = "truecolor";
    process.env.BRUINE_NO_GLOW = "0";
    delete process.env.BRUINE_NO_ANIMATION;
    delete process.env.CI;
    process.env.BRUINE_ASCII = "0";
    process.env.TERM = "xterm-256color";
    tty = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    resetColorDepth();
  });
  afterEach(() => {
    const back = (k: string, v: string | undefined): void => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
    back("BRUINE_COLOR", saved.c); back("BRUINE_NO_GLOW", saved.g); back("BRUINE_NO_ANIMATION", saved.n); back("CI", saved.ci); back("TERM", saved.t); back("BRUINE_ASCII", saved.a);
    Object.defineProperty(process.stdout, "isTTY", { value: tty, configurable: true });
    setRainLevel(undefined);
    resetColorDepth();
  });

  const colours = (line: string): number => new Set(line.match(/38;2;\d+;\d+;\d+/g)).size;
  const make = (icons = UNICODE_ICONS, focused = true): { frame: PromptFrame; clock: { t: number } } => {
    const clock = { t: 10_000 };
    return { frame: new PromptFrame(content, editor(focused), new TurnActivity(() => clock.t), icons, () => clock.t), clock };
  };

  test("at high, xhigh and max the frame's colours move with time and its text never changes", () => {
    for (const effort of ["high", "xhigh", "max"]) {
      setRainLevel(effort);
      const { frame, clock } = make();
      const a = frame.render(60);
      clock.t += 700;
      const b = frame.render(60);
      expect(a.join("\n"), effort).not.toBe(b.join("\n"));
      expect(a.map(plain), effort).toEqual(b.map(plain));
      expect(frame.active, effort).toBe(true);
    }
  });

  test("at every other effort the frame is as it always was, and nothing keeps repainting for it", () => {
    for (const effort of ["off", "minimal", "low", "medium", "auto", undefined]) {
      setRainLevel(effort);
      const { frame, clock } = make();
      const a = frame.render(60);
      clock.t += 700;
      expect(frame.render(60), String(effort)).toEqual(a);
      expect(frame.active, String(effort)).toBe(false);
      // The frame's own colour, one for the whole border: not a gradient.
      expect(colours(a[0]!), String(effort)).toBe(1);
    }
  });

  test("max is many hues along the frame, high is one family of them", () => {
    const hues = (effort: string): number => {
      setRainLevel(effort);
      const top = make().frame.render(80)[0]!;
      return new Set(top.match(/38;2;(\d+;\d+;\d+)/g)).size;
    };
    expect(hues("max")).toBeGreaterThan(10);
    setRainLevel("max");
    const maxTop = make().frame.render(80)[0]!;
    const reds = [...maxTop.matchAll(/38;2;(\d+);(\d+);(\d+)/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])] as const);
    // Warm and cool both appear: red above blue somewhere, blue above red somewhere.
    expect(reds.some(([r, , b]) => r > b + 40)).toBe(true);
    expect(reds.some(([r, , b]) => b > r + 40)).toBe(true);
  });

  test("xhigh moves faster than high", () => {
    const change = (effort: string): number => {
      setRainLevel(effort);
      const { frame, clock } = make();
      const a = [...frame.render(80)[0]!.matchAll(/38;2;(\d+);(\d+);(\d+)/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
      clock.t += 100;
      const b = [...frame.render(80)[0]!.matchAll(/38;2;(\d+);(\d+);(\d+)/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
      return a.reduce((n, c, i) => n + Math.hypot(c[0]! - b[i]![0]!, c[1]! - b[i]![1]!, c[2]! - b[i]![2]!), 0);
    };
    expect(change("xhigh")).toBeGreaterThan(change("high") * 3);
  });

  test("the sides of the box follow along, not only the top and the bottom", () => {
    setRainLevel("max");
    const lines = make().frame.render(60);
    expect(lines[1]!.match(/38;2;/g)!.length).toBeGreaterThanOrEqual(2);
    expect(plain(lines[1]!).startsWith("│")).toBe(true);
  });

  test("no glow in ASCII, without motion, with BRUINE_NO_GLOW=1, on a terminal that cannot blend colours, or on a frame nobody is in", () => {
    setRainLevel("max");
    const drawn = (icons = UNICODE_ICONS, focused = true): boolean => colours(make(icons, focused).frame.render(60)[0]!) > 3;
    expect(drawn()).toBe(true);
    expect(drawn(ASCII_ICONS)).toBe(false);
    expect(drawn(UNICODE_ICONS, false)).toBe(false);
    process.env.BRUINE_NO_GLOW = "1";
    expect(drawn()).toBe(false);
    process.env.BRUINE_NO_GLOW = "0";
    process.env.BRUINE_NO_ANIMATION = "1";
    expect(drawn()).toBe(false);
    delete process.env.BRUINE_NO_ANIMATION;
    process.env.BRUINE_COLOR = "basic";
    resetColorDepth();
    expect(drawn()).toBe(false);
  });

  test("the frame keeps every cell of its width while it glows", () => {
    for (const effort of ["high", "xhigh", "max"]) {
      setRainLevel(effort);
      const { frame, clock } = make();
      for (let i = 0; i < 6; i += 1) {
        clock.t += 130;
        for (const line of frame.render(70)) expect([...plain(line)].length).toBe(70);
      }
    }
  });
});
