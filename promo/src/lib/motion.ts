import { Easing, interpolate } from "remotion";
import { VIDEO, type CutName } from "../config";
import { clamp01, rainLevelAt, rainSpeed } from "../timeline.ts";

export { clamp01, hash01, sec } from "../timeline.ts";

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

const phasesOf: Partial<Record<CutName, Float64Array>> = {};

/**
 * Rain level and the rain's own clock at every frame. The clock is the sum of the time that
 * passed, each slice scaled by the speed it passed at (src/ui/rain.ts Weather), so slowing the
 * rain slows the drops already falling instead of jumping them.
 */
export function rainAt(frame: number, cut: CutName = "full"): { level: number; phase: number } {
  let phases = phasesOf[cut];
  if (phases === undefined) {
    const n = 4000;
    phases = phasesOf[cut] = new Float64Array(n);
    let acc = 0;
    for (let f = 0; f < n; f += 1) {
      phases[f] = acc;
      acc += (1000 / VIDEO.fps) * rainSpeed(rainLevelAt(f, cut));
    }
  }
  const f = Math.max(0, Math.min(phases.length - 1, Math.floor(frame)));
  return { level: rainLevelAt(f, cut), phase: phases[f]! };
}
