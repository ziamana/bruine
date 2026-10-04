import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { COLORS, VIDEO } from "../config";
import { clamp01, hash01, rainAt } from "../lib/motion";

/** One terminal row in pixels: the rain falls in rows per second, as in the terminal. */
const ROW = 24;
const COLUMN = 15;

type Layer = "far" | "mid" | "near";
/** Far drops are small and slow, near ones long and quick: that is all the depth there is. */
const LAYERS: Record<Layer, { speed: number; length: number; color: string; width: number; alpha: number; floor: number; ring: number }> = {
  far: { speed: 3.2, length: 0, color: COLORS.faint, width: 2.1, alpha: 0.55, floor: 0.87, ring: 9 },
  mid: { speed: 6, length: 0.6, color: COLORS.muted, width: 1.6, alpha: 0.55, floor: 0.93, ring: 17 },
  near: { speed: 10, length: 1.7, color: COLORS.lavender, width: 1.9, alpha: 0.75, floor: 0.985, ring: 30 },
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

/** How long a ring spreads where a drop landed, in seconds of rain. */
const RING_LIFE = 0.5;

/**
 * The film's weather: a pure function of the frame, like src/ui/rain.ts rainGrid, but drawn in
 * vector with sub-pixel positions so it is smooth at 45 fps. Each drop falls to its own depth on
 * the ground and leaves a ring there; the share of columns that carry a drop follows the rain
 * level, and a drop fades in or out rather than popping when it changes.
 */
export const Rain: React.FC<{ seed?: number }> = ({ seed = 7 }) => {
  const frame = useCurrentFrame();
  const { level, phase } = rainAt(frame);
  const stretch = 0.7 + 0.9 * level;
  const columns = Math.ceil(VIDEO.width / COLUMN);
  const rows = Math.ceil(VIDEO.height / ROW);
  const drops: React.ReactNode[] = [];
  const rings: React.ReactNode[] = [];
  for (let column = 0; column < columns; column += 1) {
    for (let stream = 0; stream < STREAMS.length; stream += 1) {
      const kind = STREAMS[stream]!;
      const s = seed + stream * 101;
      const presence = clamp01((kind.density(level) - hash01(column, s, 1)) / 0.06);
      if (presence <= 0) continue;
      const pick = hash01(column, s, 2);
      const layer: Layer = pick < kind.far ? "far" : pick < kind.mid ? "mid" : "near";
      const spec = LAYERS[layer];
      const gap = 6 + Math.floor(hash01(column, s, 3) * 24);
      const period = rows + spec.length + gap;
      const offset = hash01(column, s, 4) * period;
      const head = ((phase / 1000) * spec.speed + offset) % period;
      const x = column * COLUMN + COLUMN / 2 + (hash01(column, s, 5) - 0.5) * 6;
      const floorY = VIDEO.height * spec.floor + (hash01(column, s, 6) - 0.5) * 46;
      const length = spec.length * ROW * stretch;
      const bottom = head * ROW;
      const alpha = spec.alpha * presence;
      const key = `${column}-${stream}`;
      if (bottom < floorY) {
        if (spec.length === 0) {
          drops.push(<circle key={key} cx={x} cy={bottom} r={spec.width} fill={spec.color} opacity={alpha} />);
        } else {
          drops.push(
            <rect
              key={key}
              x={x - spec.width / 2}
              y={bottom - length}
              width={spec.width}
              height={length}
              rx={spec.width / 2}
              fill={layer === "near" ? "url(#drop)" : spec.color}
              opacity={alpha}
            />,
          );
        }
        continue;
      }
      const age = (bottom - floorY) / ROW / spec.speed / RING_LIFE;
      if (age >= 1) continue;
      const grow = 1 - Math.pow(1 - age, 2.4);
      const rx = spec.ring * (0.15 + 0.85 * grow);
      rings.push(
        <ellipse
          key={key}
          cx={x}
          cy={floorY}
          rx={rx}
          ry={rx * 0.2}
          fill="none"
          stroke={layer === "far" ? COLORS.faint : COLORS.lavender}
          strokeWidth={layer === "near" ? 1.4 : 1}
          opacity={alpha * (1 - age) * 0.9}
        />,
      );
      if (layer === "near" && age > 0.25) {
        const a2 = (age - 0.25) / 0.75;
        const r2 = spec.ring * 0.55 * (1 - Math.pow(1 - a2, 2));
        rings.push(
          <ellipse key={`${key}b`} cx={x} cy={floorY} rx={r2} ry={r2 * 0.2} fill="none" stroke={COLORS.lavender} strokeWidth={0.9} opacity={alpha * (1 - a2) * 0.6} />,
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
        {rings}
        {drops}
      </svg>
    </AbsoluteFill>
  );
};

/**
 * A few drops right in front of the lens: long, soft and out of focus. They only come with real
 * rain, so a quiet scene keeps a clean frame.
 */
export const RainFront: React.FC = () => {
  const frame = useCurrentFrame();
  const { level, phase } = rainAt(frame);
  const drops: React.ReactNode[] = [];
  for (let i = 0; i < 22; i += 1) {
    const presence = clamp01((level - 0.3 - hash01(i, 3, 1) * 0.7) / 0.08);
    if (presence <= 0) continue;
    const speed = 30 + hash01(i, 3, 2) * 18;
    const length = 140 + hash01(i, 3, 3) * 160;
    const period = VIDEO.height + length + 600 + hash01(i, 3, 4) * 900;
    const y = (((phase / 1000) * speed * ROW + hash01(i, 3, 5) * period) % period) - length;
    const x = hash01(i, 3, 6) * VIDEO.width;
    const width = 3 + hash01(i, 3, 7) * 3;
    drops.push(<rect key={i} x={x} y={y} width={width} height={length} rx={width / 2} fill="url(#front)" opacity={0.3 * presence} />);
  }
  if (drops.length === 0) return null;
  return (
    <AbsoluteFill style={{ filter: "blur(2.5px)" }}>
      <svg width={VIDEO.width} height={VIDEO.height}>
        <defs>
          <linearGradient id="front" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={COLORS.violetLight} stopOpacity={0} />
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
