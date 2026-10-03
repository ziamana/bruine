import React from "react";
import { COLORS, LOGO_STOPS } from "../config";
import { hash01 } from "../lib/motion";

/** The three-row BRUINE mark in the `future` FIGlet font (src/ui/logo-motion.ts LOGO). */
export const LOGO = ["┏┓ ┏━┓╻ ╻╻┏┓╻┏━╸", "┣┻┓┣┳┛┃ ┃┃┃┗┫┣╸ ", "┗━┛╹┗╸┗━┛╹╹ ╹┗━╸"] as const;

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

/** How long a letter cell stays wet before it is the letter, as a share of the whole fill. */
const WET = 0.09;

const COLS = LOGO[0].length;
const ROWS = LOGO.length;

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

/** When the drop reaches a cell, on the 0..1 clock of the fill (the same law as wordmarkFrame). */
const reachedAt = (column: number, row: number): number => 0.14 + hash01(column, row, 11) * 0.5 + row * 0.07;

/**
 * The wordmark forming under a drizzle: a drop falls into each letter cell, wets it, and the
 * letter fills in. A cell never loses what it has gained, which is what makes it read as rain
 * collecting. The clock runs on past 1 so the last splashes can finish; from about 1 on it is the
 * permanent mark. `shimmer` slides the gradient along it.
 */
export const Wordmark: React.FC<{ cell: number; phase: number; shimmer?: number; glow?: number }> = ({
  cell,
  phase,
  shimmer = 0,
  glow = 1,
}) => {
  const w = cell;
  const h = cell * 2.05;
  const t = cell * 0.3;
  const time = Math.max(0, phase);
  const width = COLS * w;
  const height = ROWS * h;
  const pad = h * 1.6;
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
            <rect key={`s${row}-${column}`} x={x + w / 2 - 1.2} y={yy - h * 0.55} width={2.4} height={h * 0.55} rx={1.2} fill="url(#streak)" opacity={k} />,
          );
        }
        continue;
      }
      if (into < 1) {
        const shade = into < 0.66 ? into / 0.66 : 1 - (into - 0.66) / 0.34;
        wet.push(<rect key={`w${row}-${column}`} x={x + 1} y={y + 1} width={w - 2} height={h - 2} fill="url(#wet)" opacity={0.85 * shade} />);
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
  return (
    <svg
      width={width}
      height={height + pad * 2}
      viewBox={`0 ${-pad} ${width} ${height + pad * 2}`}
      style={{ overflow: "visible" }}
    >
      <defs>
        <linearGradient id="mark" gradientUnits="userSpaceOnUse" x1={shift} y1={0} x2={shift + width} y2={0} spreadMethod="repeat">
          {LOGO_STOPS.map((c, i) => (
            <stop key={i} offset={i / (LOGO_STOPS.length - 1)} stopColor={c} />
          ))}
        </linearGradient>
        <pattern id="wet" width={4} height={4} patternUnits="userSpaceOnUse">
          <rect width={2} height={2} fill={COLORS.lavender} />
          <rect x={2} y={2} width={2} height={2} fill={COLORS.sky} opacity={0.6} />
        </pattern>
        <filter id="markGlow" x="-20%" y="-60%" width="140%" height="220%">
          <feGaussianBlur stdDeviation={cell * 0.45} />
        </filter>
        <linearGradient id="streak" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={COLORS.lavender} stopOpacity={0} />
          <stop offset="1" stopColor={COLORS.violetLight} stopOpacity={1} />
        </linearGradient>
      </defs>
      {streaks}
      {wet}
      <path d={lit.join("")} fill="url(#mark)" filter="url(#markGlow)" opacity={0.55 * glow} />
      <path d={lit.join("")} fill="url(#mark)" />
      {splashes}
    </svg>
  );
};

/** The mark's drawn size for a given cell, so callers can centre it. */
export const wordmarkSize = (cell: number): { width: number; height: number } => ({
  width: COLS * cell,
  height: ROWS * cell * 2.05,
});
