import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { COLORS, VIDEO } from "../config";
import { clamp01, hash01, rainAt } from "../lib/motion";

/** One terminal row in pixels: the rain falls in rows per second, as in the terminal. */
const ROW = 24;
const COLUMN = 15;

type Layer = "far" | "mid" | "near";
/** Far drops are small and slow, near ones long and quick: that is all the depth there is. */
const LAYERS: Record<Layer, { speed: number; length: number; color: string; width: number; alpha: number }> = {
  far: { speed: 3.2, length: 0, color: COLORS.faint, width: 2.2, alpha: 0.55 },
  mid: { speed: 6, length: 0.6, color: COLORS.muted, width: 1.6, alpha: 0.55 },
  near: { speed: 10, length: 1.7, color: COLORS.lavender, width: 1.8, alpha: 0.7 },
};

/**
 * Independent drops per column. The first stream is the drizzle and is mostly far drops; the
 * others only open as the rain gets heavier, and they are nearer, so a downpour is denser,
 * closer and longer at once.
 */
const STREAMS = [
  { density: (level: number) => 0.06 + 0.62 * level, far: 0.5, mid: 0.85 },
  { density: (level: number) => (level - 0.22) * 1.1, far: 0.25, mid: 0.7 },
  { density: (level: number) => (level - 0.55) * 1.6, far: 0.05, mid: 0.45 },
] as const;

/**
 * The film's weather: a pure function of the frame, like src/ui/rain.ts rainGrid, but drawn in
 * vector with sub-pixel positions so it is smooth at 45 fps. The share of columns that carry a
 * drop follows the rain level, and a drop fades in or out rather than popping when it changes.
 */
export const Rain: React.FC<{ seed?: number; opacity?: number }> = ({ seed = 7, opacity = 1 }) => {
  const frame = useCurrentFrame();
  const { level, phase } = rainAt(frame);
  const stretch = 0.7 + 0.9 * level;
  const columns = Math.ceil(VIDEO.width / COLUMN);
  const rows = Math.ceil(VIDEO.height / ROW);
  const drops: React.ReactNode[] = [];
  for (let column = 0; column < columns; column += 1) {
    for (let stream = 0; stream < STREAMS.length; stream += 1) {
      const kind = STREAMS[stream]!;
      const s = seed + stream * 101;
      const gate = hash01(column, s, 1);
      const presence = clamp01((kind.density(level) - gate) / 0.06);
      if (presence <= 0) continue;
      const pick = hash01(column, s, 2);
      const layer: Layer = pick < kind.far ? "far" : pick < kind.mid ? "mid" : "near";
      const spec = LAYERS[layer];
      const gap = 6 + Math.floor(hash01(column, s, 3) * 24);
      const period = rows + spec.length + gap;
      const offset = hash01(column, s, 4) * period;
      const y = (((phase / 1000) * spec.speed + offset) % period) - spec.length;
      const x = column * COLUMN + COLUMN / 2 + (hash01(column, s, 5) - 0.5) * 6;
      const top = y * ROW;
      const length = spec.length * ROW * stretch;
      const alpha = spec.alpha * presence * opacity;
      if (spec.length === 0) {
        drops.push(<circle key={`${column}-${stream}`} cx={x} cy={top} r={spec.width} fill={spec.color} opacity={alpha} />);
      } else {
        drops.push(
          <rect
            key={`${column}-${stream}`}
            x={x - spec.width / 2}
            y={top}
            width={spec.width}
            height={length}
            rx={spec.width / 2}
            fill={layer === "near" ? "url(#drop)" : spec.color}
            opacity={alpha}
          />,
        );
      }
    }
  }
  return (
    <AbsoluteFill>
      <svg width={VIDEO.width} height={VIDEO.height} viewBox={`0 0 ${VIDEO.width} ${VIDEO.height}`}>
        <defs>
          <linearGradient id="drop" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
            <stop offset="0" stopColor={COLORS.lavender} stopOpacity={0} />
            <stop offset="1" stopColor={COLORS.violetLight} stopOpacity={1} />
          </linearGradient>
        </defs>
        {drops}
      </svg>
    </AbsoluteFill>
  );
};

/** The night the rain falls on: near-black with a faint lavender haze low on the screen. */
export const Backdrop: React.FC = () => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(ellipse 80% 60% at 50% 110%, ${COLORS.nightGlow} 0%, ${COLORS.night} 70%)`,
    }}
  />
);
