import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { COLORS, FONTS, type Copy } from "../config";
import { KeyCap, Scene, Words } from "../components/Scene";
import { GlowGradient, glowMode, type GlowMode } from "../components/Glow";
import { ease } from "../lib/motion";
import { EFFORT, LIGHTNING } from "../timeline.ts";

const BOX = { width: 1240, height: 108 };
const CELL = 14.5;

/** The ground shakes for a moment under the near thunder. */
function shake(frame: number): [number, number] {
  const t = frame - LIGHTNING[0];
  if (t < 0 || t > 16) return [0, 0];
  const k = (1 - t / 16) * 5;
  return [Math.sin(t * 2.7) * k, Math.cos(t * 3.9) * k * 0.6];
}

export const Effort: React.FC<{ copy: Copy["effort"] }> = ({ copy }) => {
  const frame = useCurrentFrame();
  const steps = EFFORT.steps;
  const step = steps.reduce((acc, at, i) => (frame >= at ? i : acc), -1);
  const level = copy.levels[Math.max(0, step)]!;
  const mode: GlowMode = step < 0 ? "off" : glowMode(level);
  const previous: GlowMode = step <= 0 ? "off" : glowMode(copy.levels[step - 1]!);
  const mix = step < 0 ? 1 : ease(frame, steps[step]!, 10);
  const pulse = step < 0 ? 0 : 1 - ease(frame, steps[step]!, 16);
  const [sx, sy] = shake(frame);
  const boxIn = ease(frame, EFFORT.box, 18, Easing.out(Easing.cubic));
  const heat = step < 0 ? 0 : (step + mix) / steps.length;
  return (
    <Scene>
      <AbsoluteFill style={{ alignItems: "center", top: 230, transform: `translate(${sx}px, ${sy}px)` }}>
        <Words text={copy.title} at={EFFORT.title} stagger={3} style={{ fontSize: 70, fontWeight: 650, letterSpacing: -1, textAlign: "center" }} />
        <Words text={copy.sub} at={EFFORT.sub} stagger={1} style={{ fontSize: 28, color: COLORS.muted, textAlign: "center", marginTop: 22 }} />
        <div style={{ position: "relative", width: BOX.width, height: BOX.height, marginTop: 74, opacity: boxIn, transform: `translateY(${(1 - boxIn) * 20}px) scale(${1 + 0.012 * pulse})` }}>
          <svg width={BOX.width} height={BOX.height} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
            <defs>
              <GlowGradient id="frame" mode={mode} from={previous} mix={mix} width={BOX.width} cellWidth={CELL} frame={frame} />
              <filter id="frameGlow" x="-10%" y="-60%" width="120%" height="220%">
                <feGaussianBlur stdDeviation={10} />
              </filter>
            </defs>
            <rect x={1} y={1} width={BOX.width - 2} height={BOX.height - 2} rx={20} fill="none" stroke="url(#frame)" strokeWidth={6} filter="url(#frameGlow)" opacity={0.25 + 0.6 * heat} />
            <rect x={1} y={1} width={BOX.width - 2} height={BOX.height - 2} rx={20} fill="rgba(17,20,30,0.94)" stroke="url(#frame)" strokeWidth={2.5} />
          </svg>
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 38px",
              fontFamily: FONTS.mono,
              fontSize: 31,
            }}
          >
            <span>
              <span style={{ color: COLORS.sky }}>› </span>
              <span style={{ color: COLORS.text }}>{copy.prompt}</span>
            </span>
            <span style={{ color: COLORS.muted }}>
              {copy.label}{" "}
              <span
                style={{
                  color: step >= 2 ? COLORS.violetLight : COLORS.text,
                  display: "inline-block",
                  minWidth: 100,
                  transform: `scale(${1 + 0.18 * pulse})`,
                  textShadow: step >= 2 ? `0 0 ${18 * (0.5 + pulse)}px rgba(217,208,255,0.7)` : undefined,
                }}
              >
                {step < 0 ? "off" : level}
              </span>
            </span>
          </div>
        </div>
        <div style={{ display: "flex", marginTop: 46, fontFamily: FONTS.mono, fontSize: 27, opacity: ease(frame, EFFORT.box + 6, 16) }}>
          {copy.levels.map((name, i) => {
            const on = i === step;
            const done = i < step;
            const k = on ? ease(frame, steps[i]!, 10) : 0;
            return (
              <div key={name} style={{ width: 210, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
                <span style={{ color: on ? COLORS.text : done ? COLORS.muted : COLORS.faint, transform: `scale(${1 + 0.12 * k * pulse})` }}>{name}</span>
                <div style={{ display: "flex", gap: 6, height: 40, alignItems: "flex-end" }}>
                  {Array.from({ length: i + 1 }, (_, d) => (
                    <div
                      key={d}
                      style={{
                        width: 3,
                        height: 12 + d * 6,
                        borderRadius: 2,
                        background: on || done ? COLORS.lavender : COLORS.faint,
                        opacity: on ? 0.5 + 0.5 * k : done ? 0.6 : 0.35,
                        boxShadow: on ? `0 0 10px rgba(180,167,255,${0.8 * k})` : undefined,
                      }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div
          style={{
            fontFamily: FONTS.mono,
            fontSize: 27,
            color: COLORS.muted,
            marginTop: 70,
            opacity: interpolate(frame, [EFFORT.weather, EFFORT.weather + 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          }}
        >
          {copy.weather}
        </div>
      </AbsoluteFill>
      {steps.map((at, i) => (
        <div key={i} style={{ position: "absolute", right: 150, top: 110, display: "flex", gap: 10, alignItems: "center" }}>
          <KeyCap label={copy.keys[0]!} at={at} hold={14} size={22} />
          <KeyCap label={copy.keys[1]!} at={at} hold={14} size={22} />
        </div>
      ))}
    </Scene>
  );
};
