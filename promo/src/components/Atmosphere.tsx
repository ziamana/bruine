import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, FADE, VIDEO } from "../config";
import { DROP_LANDS, hash01, LIGHTNING, SCENES, sec, transitions } from "../timeline.ts";

/** Slow banks of lavender and sky mist drifting low across the night. */
export const Fog: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / VIDEO.fps;
  const blob = (x: number, y: number, w: number, h: number, color: string, alpha: number): string =>
    `radial-gradient(ellipse ${w}px ${h}px at ${x}px ${y}px, rgba(${color},${alpha}) 0%, rgba(${color},0) 100%)`;
  return (
    <AbsoluteFill
      style={{
        background: [
          blob(500 + 160 * Math.sin(t * 0.13), 900 + 30 * Math.sin(t * 0.21), 900, 260, "180,167,255", 0.07),
          blob(1450 + 200 * Math.sin(t * 0.09 + 1.7), 980, 1000, 240, "125,207,255", 0.05),
          blob(960 + 300 * Math.sin(t * 0.07 + 3), 160, 1200, 300, "180,167,255", 0.035),
        ].join(", "),
      }}
    />
  );
};

/** How bright the far lightning is at a frame: a sharp rise and a long fade, twice. */
export function lightningAt(frame: number): number {
  const e = SCENES.effort.from;
  const flash = (at: number, length: number, peak: number): number => {
    const t = frame - at;
    if (t < 0 || t > length) return 0;
    return peak * (t < 2 ? t / 2 : Math.exp(-(t - 2) / (length / 4)));
  };
  return Math.max(flash(e + LIGHTNING[0], 30, 1), flash(e + LIGHTNING[1], 20, 0.65));
}

/** A jagged bolt, seeded, from the top of the sky down towards the horizon. */
function boltPath(seed: number, x0: number, y0: number, y1: number): string {
  let x = x0;
  let d = `M${x0} ${y0}`;
  const steps = 16;
  for (let i = 1; i <= steps; i += 1) {
    x += (hash01(seed, i, 1) - 0.5) * 70;
    d += ` L${x.toFixed(1)} ${(y0 + ((y1 - y0) * i) / steps).toFixed(1)}`;
  }
  return d;
}

/** The far storm behind everything: the sky lights up and a thin bolt shows for an instant. */
export const LightningSky: React.FC = () => {
  const frame = useCurrentFrame();
  const k = lightningAt(frame);
  if (k <= 0.001) return null;
  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 70% 60% at 72% 8%, rgba(217,208,255,${0.42 * k}) 0%, rgba(180,167,255,${0.12 * k}) 45%, transparent 80%)`,
        }}
      />
      <svg width={VIDEO.width} height={VIDEO.height} style={{ position: "absolute", filter: "blur(1.2px)" }}>
        <path d={boltPath(5, 1420, -20, 560)} stroke={COLORS.violetLight} strokeWidth={2.4} fill="none" opacity={0.8 * k} />
        <path d={boltPath(9, 1440, 200, 430)} stroke={COLORS.violetLight} strokeWidth={1.2} fill="none" opacity={0.5 * k} />
      </svg>
    </AbsoluteFill>
  );
};

/** The whole frame brightens a little with the flash, over the scenes too. */
export const LightningWash: React.FC = () => {
  const k = lightningAt(useCurrentFrame());
  if (k <= 0.001) return null;
  return <AbsoluteFill style={{ background: `rgba(217,208,255,${0.07 * k})`, mixBlendMode: "screen" }} />;
};

export const Vignette: React.FC = () => (
  <AbsoluteFill style={{ background: "radial-gradient(ellipse 75% 70% at 50% 48%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)" }} />
);

/** Film grain: a seeded noise that changes every frame, barely there. */
export const Grain: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ opacity: 0.07, mixBlendMode: "overlay" }}>
      <svg width={VIDEO.width} height={VIDEO.height}>
        <filter id="grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={frame % 17} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>
    </AbsoluteFill>
  );
};

/** How far a scene-change ripple has spread, `t` frames after its drop landed. */
export function wipeRadius(t: number): number {
  return interpolate(t, [0, FADE - DROP_LANDS - 1], [0, 2350], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.3, 0.2, 0.25, 1),
  });
}
/** The soft edge of the ripple mask, in pixels. */
export const WIPE_EDGE = 140;

/**
 * The drop that changes the scene: it falls onto a point, and rings spread from where it landed,
 * the outer one carrying the edge of the next scene.
 */
export const TransitionRings: React.FC = () => {
  const frame = useCurrentFrame();
  const shapes: React.ReactNode[] = [];
  for (const tr of transitions()) {
    const t = frame - tr.at;
    if (t < -sec(0.3) || t > FADE + 20) continue;
    if (t < 0) {
      const k = 1 + t / sec(0.3);
      const y = tr.y - 520 * (1 - k * k);
      shapes.push(<rect key={`${tr.scene}-d`} x={tr.x - 1.6} y={y - 70} width={3.2} height={70} rx={1.6} fill="url(#tdrop)" opacity={0.9} />);
      continue;
    }
    const r = wipeRadius(t);
    const fade = 1 - t / (FADE + 20);
    // The leading ring splits into its colours at the edge, like light through a raindrop.
    shapes.push(<circle key={`${tr.scene}-ar`} cx={tr.x + 3} cy={tr.y} r={r * 1.006} fill="none" stroke={COLORS.pink} strokeWidth={2} opacity={0.4 * fade} style={{ mixBlendMode: "screen" }} />);
    shapes.push(<circle key={`${tr.scene}-ab`} cx={tr.x - 3} cy={tr.y} r={r * 0.994} fill="none" stroke={COLORS.sky} strokeWidth={2} opacity={0.4 * fade} style={{ mixBlendMode: "screen" }} />);
    shapes.push(<circle key={`${tr.scene}-a`} cx={tr.x} cy={tr.y} r={r} fill="none" stroke={COLORS.violetLight} strokeWidth={2.5} opacity={0.75 * fade} />);
    shapes.push(<circle key={`${tr.scene}-b`} cx={tr.x} cy={tr.y} r={r * 0.62} fill="none" stroke={COLORS.lavender} strokeWidth={1.5} opacity={0.5 * fade} />);
    shapes.push(<circle key={`${tr.scene}-c`} cx={tr.x} cy={tr.y} r={r * 0.33} fill="none" stroke={COLORS.sky} strokeWidth={1} opacity={0.4 * fade} />);
    if (t < 8) shapes.push(<circle key={`${tr.scene}-f`} cx={tr.x} cy={tr.y} r={10 + t * 6} fill={COLORS.violetLight} opacity={0.5 * (1 - t / 8)} style={{ filter: "blur(6px)" }} />);
  }
  if (shapes.length === 0) return null;
  return (
    <AbsoluteFill>
      <svg width={VIDEO.width} height={VIDEO.height}>
        <defs>
          <linearGradient id="tdrop" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={COLORS.violetLight} stopOpacity={0} />
            <stop offset="1" stopColor={COLORS.violetLight} stopOpacity={1} />
          </linearGradient>
        </defs>
        {shapes}
      </svg>
    </AbsoluteFill>
  );
};

/**
 * A scene inside the film: it appears inside the ripple of the drop that opens it, and leaves
 * outside the ripple of the drop that opens the next one, so two layouts never mix.
 */
export const SceneShell: React.FC<{ children: React.ReactNode; enter?: [number, number]; exit?: [number, number] }> = ({ children, enter, exit }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const masks: string[] = [];
  let scale = 1;
  // A camera that breathes: a few pixels of slow drift, never enough to read as movement.
  const t = frame / 45;
  const driftX = Math.sin(t * 0.47) * 3;
  const driftY = Math.cos(t * 0.31) * 2;
  if (enter !== undefined) {
    const t = frame - DROP_LANDS;
    if (t < 0) return null;
    const r = wipeRadius(t);
    if (r < 2300) masks.push(`radial-gradient(circle at ${enter[0]}px ${enter[1]}px, #000 ${Math.max(0, r - WIPE_EDGE)}px, transparent ${r}px)`);
    scale = interpolate(t, [0, FADE + 8], [1.05, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  }
  let dim = 1;
  if (exit !== undefined) {
    const t = frame - (durationInFrames - FADE + DROP_LANDS);
    if (t >= 0) {
      const r = wipeRadius(t);
      masks.push(`radial-gradient(circle at ${exit[0]}px ${exit[1]}px, transparent ${Math.max(0, r - WIPE_EDGE)}px, #000 ${r}px)`);
      dim = 1 - 0.35 * Math.min(1, t / (FADE - DROP_LANDS));
    }
  }
  const mask = masks.length > 0 ? masks.join(", ") : undefined;
  return (
    <AbsoluteFill
      style={{
        transform: `translate(${driftX}px, ${driftY}px) scale(${scale})`,
        opacity: dim,
        maskImage: mask,
        WebkitMaskImage: mask,
        maskComposite: masks.length > 1 ? "intersect" : undefined,
        WebkitMaskComposite: masks.length > 1 ? "source-in" : undefined,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};
