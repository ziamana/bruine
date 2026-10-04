import React from "react";
import { COLORS, LOGO_STOPS } from "../config";
import { LOGO, reachedAt, WET } from "../timeline.ts";

type Arm = "u" | "d" | "l" | "r";
/** Which heavy arms each box-drawing glyph has, from the centre of its cell to its edges. */
const ARMS: Record<string, Arm[]> = {
  "┏": ["r", "d"],
  "┓": ["l", "d"],
  "┗": ["u", "r"],
  "┛": ["u", "l"],
  "━": ["l", "r"],
  "┃": ["u", "d"],
  "┣": ["u", "d", "r"],
  "┫": ["u", "d", "l"],
  "┳": ["d", "l", "r"],
  "┻": ["u", "l", "r"],
  "╸": ["l"],
  "╹": ["u"],
  "╻": ["d"],
};

const COLS = LOGO[0].length;
const ROWS = LOGO.length;
const RATIO = 2.05;

function glyphPath(ch: string, x: number, y: number, w: number, h: number, t: number): string {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const half = t / 2;
  const rect = (x0: number, y0: number, x1: number, y1: number): string =>
    `M${x0.toFixed(2)} ${y0.toFixed(2)}H${x1.toFixed(2)}V${y1.toFixed(2)}H${x0.toFixed(2)}Z`;
  const parts: string[] = [rect(cx - half, cy - half, cx + half, cy + half)];
  for (const arm of ARMS[ch] ?? []) {
    if (arm === "u") parts.push(rect(cx - half, y, cx + half, cy + half));
    if (arm === "d") parts.push(rect(cx - half, cy - half, cx + half, y + h));
    if (arm === "l") parts.push(rect(x, cy - half, cx + half, cy + half));
    if (arm === "r") parts.push(rect(cx - half, cy - half, x + w, cy + half));
  }
  return parts.join("");
}

/**
 * The wordmark forming under a drizzle: a drop falls into each letter cell, wets it, and the
 * letter fills in. A cell never loses what it has gained, which is what makes it read as rain
 * collecting. The clock runs on past 1 so the last splashes can finish; from about 1 on it is
 * the permanent mark.
 *
 * `shimmer` slides the gradient along the mark, `sweep` (0..1) passes a band of light across it,
 * and `reflect` lays the mark on wet ground under itself, trembling.
 */
export const Wordmark: React.FC<{
  id: string;
  cell: number;
  phase: number;
  frame: number;
  shimmer?: number;
  glow?: number;
  sweep?: number;
  reflect?: number;
}> = ({ id, cell, phase, frame, shimmer = 0, glow = 1, sweep = -1, reflect = 0 }) => {
  const w = cell;
  const h = cell * RATIO;
  const t = cell * 0.3;
  const time = Math.max(0, phase);
  const width = COLS * w;
  const height = ROWS * h;
  const pad = h * 1.6;
  const gap = h * 0.12;
  const reflectHeight = reflect > 0 ? height * 0.8 + gap : 0;
  const lit: string[] = [];
  const wet: React.ReactNode[] = [];
  const streaks: React.ReactNode[] = [];
  const splashes: React.ReactNode[] = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let column = 0; column < COLS; column += 1) {
      const ch = LOGO[row]![column]!;
      if (ch === " ") continue;
      const x = column * w;
      const y = row * h;
      const reached = reachedAt(column, row);
      const into = (time - reached) / WET;
      const above = row === 0 || LOGO[row - 1]![column] === " ";
      if (into < 0) {
        // The drop on its way down, for the moment before it lands.
        const ahead = reached - time;
        if (above && ahead < 0.16) {
          const k = 1 - ahead / 0.16;
          const yy = y - h * 1.4 * (1 - k);
          streaks.push(
            <rect key={`s${row}-${column}`} x={x + w / 2 - 1.2} y={yy - h * 0.55} width={2.4} height={h * 0.55} rx={1.2} fill={`url(#${id}-streak)`} opacity={k} />,
          );
        }
        continue;
      }
      if (into < 1) {
        const shade = into < 0.66 ? into / 0.66 : 1 - (into - 0.66) / 0.34;
        wet.push(<rect key={`w${row}-${column}`} x={x + 1} y={y + 1} width={w - 2} height={h - 2} fill={`url(#${id}-wet)`} opacity={0.85 * shade} />);
        if (into < 0.5) {
          const k = into / 0.5;
          wet.push(<circle key={`f${row}-${column}`} cx={x + w / 2} cy={y + h / 2} r={w * (0.2 + 0.9 * k)} fill={COLORS.violetLight} opacity={0.35 * (1 - k)} />);
        }
      }
      if (into >= 0.45) lit.push(glyphPath(ch, x, y, w, h, t));
      if (row === ROWS - 1 && into >= 0 && into < 1.6) {
        const k = into / 1.6;
        splashes.push(
          <ellipse
            key={`r${column}`}
            cx={x + w / 2}
            cy={height + h * 0.28}
            rx={w * (0.12 + 0.45 * k)}
            ry={h * 0.06 * (0.4 + k)}
            fill="none"
            stroke={COLORS.lavender}
            strokeWidth={1.4}
            opacity={0.6 * (1 - k)}
          />,
        );
      }
    }
  }
  const shift = shimmer * width;
  const d = lit.join("");
  const band = width * 0.22;
  const sweepX = -band * 2 + sweep * (width + band * 4);
  const wobble = 0.045 + 0.006 * Math.sin(frame / 13);
  return (
    <svg width={width} height={height + pad * 2 + reflectHeight} viewBox={`0 ${-pad} ${width} ${height + pad * 2 + reflectHeight}`} style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={`${id}-mark`} gradientUnits="userSpaceOnUse" x1={shift} y1={0} x2={shift + width} y2={0} spreadMethod="repeat">
          {LOGO_STOPS.map((c, i) => (
            <stop key={i} offset={i / (LOGO_STOPS.length - 1)} stopColor={c} />
          ))}
        </linearGradient>
        <linearGradient id={`${id}-sweep`} gradientUnits="userSpaceOnUse" x1={sweepX} y1={0} x2={sweepX + band} y2={height * 0.6}>
          <stop offset="0" stopColor="#ffffff" stopOpacity={0} />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity={0.95} />
          <stop offset="1" stopColor="#ffffff" stopOpacity={0} />
        </linearGradient>
        <pattern id={`${id}-wet`} width={4} height={4} patternUnits="userSpaceOnUse">
          <rect width={2} height={2} fill={COLORS.lavender} />
          <rect x={2} y={2} width={2} height={2} fill={COLORS.sky} opacity={0.6} />
        </pattern>
        <linearGradient id={`${id}-streak`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={COLORS.lavender} stopOpacity={0} />
          <stop offset="1" stopColor={COLORS.violetLight} stopOpacity={1} />
        </linearGradient>
        <filter id={`${id}-flare`} x="-50%" y="-500%" width="200%" height="1100%">
          <feGaussianBlur stdDeviation={`${cell * 0.6} ${cell * 0.08}`} />
        </filter>
        <linearGradient id={`${id}-flareline`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={COLORS.sky} stopOpacity={0} />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity={1} />
          <stop offset="1" stopColor={COLORS.pink} stopOpacity={0} />
        </linearGradient>
        <filter id={`${id}-glow`} x="-20%" y="-60%" width="140%" height="220%">
          <feGaussianBlur stdDeviation={cell * 0.45} />
        </filter>
        <filter id={`${id}-water`} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency={`0.004 ${wobble}`} numOctaves={1} seed={4} />
          <feDisplacementMap in="SourceGraphic" scale={cell * 0.16} xChannelSelector="R" yChannelSelector="G" />
          <feGaussianBlur stdDeviation="2 1.2" />
        </filter>
        <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity={0.38} />
          <stop offset="0.7" stopColor="#fff" stopOpacity={0} />
        </linearGradient>
        <mask id={`${id}-reflect-mask`} maskUnits="userSpaceOnUse" x={-50} y={height} width={width + 100} height={reflectHeight + 20}>
          <rect x={-50} y={height + gap * 0.5} width={width + 100} height={reflectHeight} fill={`url(#${id}-fade)`} />
        </mask>
      </defs>
      {reflect > 0 && d !== "" ? (
        <g mask={`url(#${id}-reflect-mask)`} opacity={reflect}>
          <g filter={`url(#${id}-water)`}>
            <path d={d} fill={`url(#${id}-mark)`} transform={`translate(0 ${2 * height + gap}) scale(1 -1)`} />
          </g>
        </g>
      ) : null}
      {streaks}
      {wet}
      <path d={d} fill={`url(#${id}-mark)`} filter={`url(#${id}-glow)`} opacity={0.55 * glow} />
      <path d={d} fill={`url(#${id}-mark)`} />
      {sweep > 0 && sweep < 1 ? <path d={d} fill={`url(#${id}-sweep)`} style={{ mixBlendMode: "screen" }} /> : null}
      {sweep > 0 && sweep < 1 ? (
        // An anamorphic flare riding the light across the mark.
        <g opacity={Math.sin(Math.PI * sweep)} style={{ mixBlendMode: "screen" }}>
          <rect x={sweepX + band / 2 - width * 0.45} y={height * 0.5 - cell * 0.05} width={width * 0.9} height={cell * 0.1} fill={`url(#${id}-flareline)`} filter={`url(#${id}-flare)`} />
          <ellipse cx={sweepX + band / 2} cy={height * 0.5} rx={cell * 1.2} ry={cell * 0.9} fill="#ffffff" opacity={0.18} filter={`url(#${id}-glow)`} />
        </g>
      ) : null}
      {splashes}
    </svg>
  );
};

/** The mark's drawn size for a given cell (without its reflection), so callers can place it. */
export const wordmarkSize = (cell: number): { width: number; height: number } => ({
  width: COLS * cell,
  height: ROWS * cell * RATIO,
});
