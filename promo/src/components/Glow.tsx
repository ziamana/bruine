import React from "react";
import { COLORS, SPECTRUM, VIDEO } from "../config";
import { blendHex } from "../lib/motion";

/** How the prompt frame shows the effort (src/ui/border-glow.ts): still, slow, fast or every colour. */
export type GlowMode = "off" | "slow" | "fast" | "rainbow";

export function glowMode(effort: string): GlowMode {
  if (effort === "high") return "slow";
  if (effort === "xhigh") return "fast";
  if (effort === "max") return "rainbow";
  return "off";
}

const PERIOD_MS: Record<Exclude<GlowMode, "off">, number> = { slow: 4200, fast: 900, rainbow: 600 };
/** How many terminal cells the pattern takes to repeat along the frame. */
const WAVELENGTH = 28;

function spectrum(x: number): string {
  const t = (((x % 1) + 1) % 1) * (SPECTRUM.length - 1);
  const k = Math.min(SPECTRUM.length - 2, Math.floor(t));
  return blendHex(SPECTRUM[k]!, SPECTRUM[k + 1]!, t - k);
}

/** The colour of the frame at a column, at a moment: the same law as glowColor. */
export function glowColor(mode: GlowMode, column: number, timeMs: number): string {
  if (mode === "off") return COLORS.faint;
  const phase = column / WAVELENGTH - timeMs / PERIOD_MS[mode];
  if (mode === "rainbow") return spectrum(phase);
  return blendHex(COLORS.violetDeep, COLORS.violetLight, 0.5 + 0.5 * Math.sin(2 * Math.PI * phase));
}

/**
 * A horizontal gradient that paints a border the way the terminal does, cell by cell along the
 * columns. `cellWidth` maps pixels back to terminal columns so the wavelength reads the same.
 */
export const GlowGradient: React.FC<{ id: string; mode: GlowMode; width: number; cellWidth: number; frame: number; from?: GlowMode; mix?: number }> = ({
  id,
  mode,
  width,
  cellWidth,
  frame,
  from,
  mix = 1,
}) => {
  const timeMs = (frame / VIDEO.fps) * 1000;
  const columns = Math.max(1, Math.round(width / cellWidth));
  const steps = 48;
  const stops: React.ReactNode[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const column = (i / steps) * columns;
    const to = glowColor(mode, column, timeMs);
    const color = from === undefined || mix >= 1 ? to : blendHex(glowColor(from, column, timeMs), to, mix);
    stops.push(<stop key={i} offset={i / steps} stopColor={color} />);
  }
  return (
    <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={width} y2={0}>
      {stops}
    </linearGradient>
  );
};
