import { Easing, interpolate } from "remotion";
import { sceneFrames, VIDEO } from "../config";

/** A number in [0, 1) that depends only on its inputs (the same hash as src/ui/rain.ts). */
export function hash01(a: number, b = 0, c = 0): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(c | 0, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 0x100000000;
}

export const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** 0 before `start`, 1 after `start + length`, eased in between. */
export function ease(frame: number, start: number, length: number, easing = Easing.bezier(0.25, 0.1, 0.25, 1)): number {
  return interpolate(frame, [start, start + length], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing,
  });
}

/** The first characters of `text`, as if typed from `start` at `cps` characters per second. */
export function typed(text: string, frame: number, start: number, cps: number): string {
  const n = Math.floor(((frame - start) / VIDEO.fps) * cps);
  return text.slice(0, Math.max(0, Math.min(text.length, n)));
}

/** Seconds to frames. */
export const sec = (s: number): number => Math.round(s * VIDEO.fps);

/** Blend two hex colours, t in 0..1. */
export function blendHex(from: string, to: string, t: number): string {
  const a = parseInt(from.slice(1), 16);
  const b = parseInt(to.slice(1), 16);
  const k = clamp01(t);
  const ch = (shift: number): number => {
    const x = (a >> shift) & 255;
    const y = (b >> shift) & 255;
    return Math.round(x + (y - x) * k);
  };
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("")}`;
}

/** How hard it rains at an effort (src/ui/rain.ts effortToRain). */
export function effortToRain(effort: string): number {
  switch (effort) {
    case "low":
      return 0.28;
    case "medium":
      return 0.5;
    case "high":
      return 0.75;
    case "xhigh":
    case "max":
      return 1;
    default:
      return 0.45;
  }
}

/** How fast the rain falls at a level (src/ui/rain.ts rainSpeed). */
export const rainSpeed = (level: number): number => 0.35 + 1.5 * clamp01(level);

/** When each effort step lands in the effort scene, in frames from the scene's start. */
export const EFFORT_STEPS = [sec(0.7), sec(1.5), sec(2.3), sec(3.1), sec(3.9)] as const;

/**
 * The weather of the whole film: [frame, level] keys the rain eases between. The effort scene
 * drives it step by step, so the rain there is the one the product shows.
 */
function rainKeys(): Array<[number, number]> {
  const s = sceneFrames();
  const e = s.effort.from;
  const levels = ["low", "medium", "high", "xhigh", "max"].map(effortToRain);
  return [
    [0, 0.08],
    [sec(1.2), 0.4],
    [s.intro.from + sec(3.2), 0.6],
    [s.models.from, 0.3],
    [s.demo.from, 0.14],
    [s.demo.from + s.demo.duration - sec(0.8), 0.14],
    [e + EFFORT_STEPS[0], 0.1],
    ...EFFORT_STEPS.map((step, i): [number, number] => [e + step + sec(0.35), levels[i]!]),
    [e + s.effort.duration - sec(0.6), 1],
    [s.promises.from + sec(0.8), 0.22],
    [s.outro.from + sec(1), 0.35],
    [s.outro.from + s.outro.duration - sec(1.6), 0.0],
  ];
}

let table: { level: Float64Array; phase: Float64Array } | undefined;

/**
 * Rain level and the rain's own clock at every frame. The clock is the sum of the time that
 * passed, each slice scaled by the speed it passed at (src/ui/rain.ts Weather), so slowing the
 * rain slows the drops already falling instead of jumping them.
 */
export function rainAt(frame: number): { level: number; phase: number } {
  if (table === undefined) {
    const keys = rainKeys();
    const n = 4000;
    const level = new Float64Array(n);
    const phase = new Float64Array(n);
    let acc = 0;
    for (let f = 0; f < n; f += 1) {
      level[f] = interpolate(f, keys.map((k) => k[0]), keys.map((k) => k[1]), {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.inOut(Easing.sin),
      });
      phase[f] = acc;
      acc += (1000 / VIDEO.fps) * rainSpeed(level[f]!);
    }
    table = { level, phase };
  }
  const f = Math.max(0, Math.min(table.level.length - 1, Math.floor(frame)));
  return { level: table.level[f]!, phase: table.phase[f]! };
}
