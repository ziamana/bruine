import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { COLORS, FONTS, type Copy } from "../config";
import { Scene, Words } from "../components/Scene";
import { ease, sec } from "../lib/motion";
import { MODELS } from "../timeline.ts";

const HUB: [number, number] = [960, 540];
const HUB_SIZE = { width: 250, height: 92 };
const RING = { rx: 590, ry: 262 };
const CHIP = { width: 186, height: 66 };
const LOCAL = { width: 360, height: 210 };

/** Where the i-th cloud provider sits on the right half of the ring around the hub. */
function chipAt(i: number, n: number): [number, number] {
  const angle = ((-72 + (144 * i) / (n - 1)) * Math.PI) / 180;
  return [HUB[0] + RING.rx * Math.cos(angle), HUB[1] + RING.ry * Math.sin(angle)];
}
const LOCAL_AT: [number, number] = [HUB[0] - RING.rx, HUB[1]];

/** A line from the hub out to a model, drawn as it lands, with drops running in along it. */
const Route: React.FC<{ to: [number, number]; at: number; frame: number; color: string; seed: number }> = ({ to, at, frame, color, seed }) => {
  const draw = ease(frame, at - 6, 14, Easing.out(Easing.cubic));
  if (draw <= 0) return null;
  const [x0, y0] = HUB;
  const [x1, y1] = to;
  const length = Math.hypot(x1 - x0, y1 - y0);
  const pulses = [0, 0.5].map((o) => {
    const t = (((frame - at) / sec(1.3) + o + seed * 0.17) % 1 + 1) % 1;
    return { x: x1 + (x0 - x1) * t, y: y1 + (y0 - y1) * t, a: Math.sin(Math.PI * t) };
  });
  return (
    <g>
      <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={color} strokeWidth={1.4} strokeOpacity={0.35} strokeDasharray={length} strokeDashoffset={length * (1 - draw)} />
      {draw >= 1
        ? pulses.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={2.6} fill={color} opacity={0.9 * p.a} style={{ filter: "blur(0.6px)" }} />)
        : null}
    </g>
  );
};

/** A model that arrives like a drop: a ring spreads where it lands and the chip is there. */
const Landing: React.FC<{ at: number; frame: number; x: number; y: number; width: number; height: number; children: React.ReactNode; ring?: string }> = ({
  at,
  frame,
  x,
  y,
  width,
  height,
  children,
  ring = COLORS.lavender,
}) => {
  const land = ease(frame, at, 14, Easing.out(Easing.back(1.6)));
  const ripple = interpolate(frame, [at, at + 32], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const flash = Math.max(0, 1 - Math.abs(frame - at - 3) / 10);
  return (
    <>
      {ripple > 0 && ripple < 1 ? (
        <div
          style={{
            position: "absolute",
            left: x,
            top: y,
            width: width * (0.4 + ripple * 1.2),
            height: height * (0.4 + ripple * 1.6),
            transform: "translate(-50%, -50%)",
            borderRadius: "50%",
            border: `1.5px solid ${ring}`,
            opacity: 0.7 * (1 - ripple),
          }}
        />
      ) : null}
      <div
        style={{
          position: "absolute",
          left: x - width / 2,
          top: y - height / 2,
          width,
          height,
          opacity: Math.min(1, land * 1.4),
          transform: `translateY(${(1 - land) * -16}px) scale(${0.85 + 0.15 * land})`,
          boxShadow: `0 0 ${30 * flash}px rgba(180,167,255,${0.6 * flash})`,
          borderRadius: 14,
        }}
      >
        {children}
      </div>
    </>
  );
};

const chipStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  background: "rgba(28,32,48,0.92)",
  border: `1px solid ${COLORS.windowEdge}`,
  borderRadius: 14,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 29,
  color: COLORS.text,
  boxSizing: "border-box",
};

export const Models: React.FC<{ copy: Copy["models"] }> = ({ copy }) => {
  const frame = useCurrentFrame();
  const n = copy.providers.length;
  const scan = (frame % sec(1.6)) / sec(1.6);
  const hub = ease(frame, MODELS.hub, 18, Easing.out(Easing.back(1.4)));
  const breathe = 0.5 + 0.5 * Math.sin(frame / 9);
  return (
    <Scene>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        <Route to={LOCAL_AT} at={MODELS.local} frame={frame} color={COLORS.sky} seed={9} />
        {copy.providers.map((name, i) => (
          <Route key={name} to={chipAt(i, n)} at={MODELS.chip(i)} frame={frame} color={COLORS.lavender} seed={i} />
        ))}
      </svg>
      <AbsoluteFill style={{ alignItems: "center", top: 92 }}>
        <Words text={copy.title} at={MODELS.title} stagger={3} style={{ fontSize: 70, fontWeight: 650, letterSpacing: -1 }} />
      </AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: HUB[0] - HUB_SIZE.width / 2,
          top: HUB[1] - HUB_SIZE.height / 2,
          width: HUB_SIZE.width,
          height: HUB_SIZE.height,
          borderRadius: 22,
          background: COLORS.window,
          border: `1.5px solid ${COLORS.lavender}`,
          boxShadow: `0 0 ${40 + 20 * breathe}px rgba(180,167,255,${0.35 + 0.15 * breathe}), inset 0 0 24px rgba(180,167,255,0.12)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: FONTS.mono,
          fontSize: 40,
          color: COLORS.violetLight,
          letterSpacing: 2,
          opacity: Math.min(1, hub * 1.5),
          transform: `scale(${0.7 + 0.3 * hub})`,
        }}
      >
        <span style={{ color: COLORS.sky, marginRight: 14 }}>›</span>bruine
      </div>
      <Landing at={MODELS.local} frame={frame} x={LOCAL_AT[0]} y={LOCAL_AT[1]} width={LOCAL.width} height={LOCAL.height} ring={COLORS.sky}>
        <div style={{ ...chipStyle, flexDirection: "column", gap: 10, border: "1px solid rgba(125,207,255,0.45)", boxShadow: "0 20px 60px rgba(0,0,0,0.45)" }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 17, letterSpacing: 3, color: COLORS.sky, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ position: "relative", width: 22, height: 22, display: "inline-block" }}>
              {[0, 0.5].map((o) => {
                const k = (scan + o) % 1;
                return (
                  <span
                    key={o}
                    style={{ position: "absolute", left: 11 - 11 * k, top: 11 - 11 * k, width: 22 * k, height: 22 * k, borderRadius: "50%", border: `1.5px solid ${COLORS.sky}`, opacity: 1 - k }}
                  />
                );
              })}
              <span style={{ position: "absolute", left: 7, top: 7, width: 8, height: 8, borderRadius: 4, background: COLORS.sky }} />
            </span>
            {copy.localLabel}
          </div>
          <div style={{ fontFamily: FONTS.mono, fontSize: 40, color: COLORS.text }}>{copy.localName}</div>
          <div style={{ fontFamily: FONTS.mono, fontSize: 22, color: COLORS.sky }}>{copy.localAddress}</div>
          <div style={{ fontSize: 20, color: COLORS.muted }}>{copy.localDetail}</div>
        </div>
      </Landing>
      {copy.providers.map((name, i) => {
        const [x, y] = chipAt(i, n);
        return (
          <Landing key={name} at={MODELS.chip(i)} frame={frame} x={x} y={y} width={CHIP.width} height={CHIP.height}>
            <div style={chipStyle}>{name}</div>
          </Landing>
        );
      })}
      <div
        style={{
          position: "absolute",
          left: HUB[0] + RING.rx - 160,
          top: HUB[1] + RING.ry + 58,
          width: 400,
          textAlign: "center",
          fontSize: 23,
          color: COLORS.muted,
          opacity: ease(frame, MODELS.more, 16),
        }}
      >
        + {copy.more}
      </div>
      <div
        style={{
          position: "absolute",
          left: HUB[0] + 18,
          top: HUB[1] - RING.ry - 50,
          fontFamily: FONTS.mono,
          fontSize: 17,
          letterSpacing: 3,
          color: COLORS.lavender,
          textTransform: "uppercase",
          opacity: ease(frame, MODELS.chip(0), 16),
        }}
      >
        {copy.cloudLabel}
      </div>
      <AbsoluteFill style={{ alignItems: "center", top: 902 }}>
        <div
          style={{
            fontFamily: FONTS.mono,
            fontSize: 25,
            color: COLORS.text,
            background: "rgba(28,32,48,0.9)",
            border: `1px solid ${COLORS.windowEdge}`,
            borderRadius: 12,
            padding: "13px 26px",
            opacity: ease(frame, MODELS.compat, 16),
            transform: `translateY(${(1 - ease(frame, MODELS.compat, 16)) * 12}px)`,
          }}
        >
          <span style={{ color: COLORS.lavender }}>{"> "}</span>
          {copy.compat}
        </div>
        <Words text={copy.footnote} at={MODELS.footnote} stagger={2} style={{ fontSize: 27, color: COLORS.muted, marginTop: 26 }} />
      </AbsoluteFill>
    </Scene>
  );
};
