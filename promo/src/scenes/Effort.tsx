import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { COLORS, FONTS, type Copy } from "../config";
import { Reveal, Scene, Title } from "../components/Scene";
import { GlowGradient, glowMode, type GlowMode } from "../components/Glow";
import { EFFORT_STEPS, ease, sec } from "../lib/motion";

const BOX = { width: 1240, height: 104 };
const CELL = 14.5;

/** A far flash of lavender behind the rain, twice, when the effort is at its highest. */
function lightning(frame: number, from: number): number {
  const flash = (at: number, length: number): number => {
    const t = frame - at;
    if (t < 0 || t > length) return 0;
    return t < 2 ? t / 2 : Math.exp(-(t - 2) / (length / 4));
  };
  return Math.max(flash(from + 10, 22), 0.6 * flash(from + 19, 16));
}

export const Effort: React.FC<{ copy: Copy["effort"] }> = ({ copy }) => {
  const frame = useCurrentFrame();
  const step = EFFORT_STEPS.reduce((acc, at, i) => (frame >= at ? i : acc), -1);
  const level = copy.levels[Math.max(0, step)]!;
  const mode: GlowMode = step < 0 ? "off" : glowMode(level);
  const previous: GlowMode = step <= 0 ? "off" : glowMode(copy.levels[step - 1]!);
  const mix = step < 0 ? 1 : ease(frame, EFFORT_STEPS[step]!, 10);
  const flash = lightning(frame, EFFORT_STEPS[4]);
  const pulse = step < 0 ? 0 : 1 - ease(frame, EFFORT_STEPS[step]!, 14);
  return (
    <Scene>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 70% 55% at 62% 18%, rgba(217,208,255,${0.3 * flash}) 0%, rgba(180,167,255,${0.08 * flash}) 45%, transparent 75%)`,
        }}
      />
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 255 }}>
        <Reveal at={sec(0.15)}>
          <Title size={66} style={{ textAlign: "center" }}>
            {copy.title}
          </Title>
        </Reveal>
        <Reveal at={sec(0.4)} style={{ marginTop: 22 }}>
          <div style={{ fontSize: 28, color: COLORS.muted, textAlign: "center" }}>{copy.sub}</div>
        </Reveal>
        <Reveal at={sec(0.45)} style={{ marginTop: 76 }}>
          <div style={{ position: "relative", width: BOX.width, height: BOX.height }}>
            <svg width={BOX.width} height={BOX.height} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
              <defs>
                <GlowGradient id="frame" mode={mode} from={previous} mix={mix} width={BOX.width} cellWidth={CELL} frame={frame} />
              </defs>
              <rect x={1} y={1} width={BOX.width - 2} height={BOX.height - 2} rx={18} fill="rgba(17,20,30,0.92)" stroke="url(#frame)" strokeWidth={2.5} />
            </svg>
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0 36px",
                fontFamily: FONTS.mono,
                fontSize: 30,
              }}
            >
              <span>
                <span style={{ color: COLORS.sky }}>› </span>
                <span style={{ color: COLORS.text }}>{copy.prompt}</span>
              </span>
              <span style={{ color: COLORS.muted }}>
                {copy.label}{" "}
                <span style={{ color: step >= 2 ? COLORS.violetLight : COLORS.text, display: "inline-block", minWidth: 100, transform: `scale(${1 + 0.12 * pulse})` }}>
                  {step < 0 ? "off" : level}
                </span>
              </span>
            </div>
          </div>
        </Reveal>
        <Reveal at={sec(0.6)} style={{ marginTop: 44 }}>
          <div style={{ display: "flex", gap: 0, fontFamily: FONTS.mono, fontSize: 26 }}>
            {copy.levels.map((name, i) => {
              const on = i === step;
              const done = i < step;
              const k = on ? ease(frame, EFFORT_STEPS[i]!, 10) : 0;
              return (
                <div key={name} style={{ width: 200, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
                  <span style={{ color: on ? COLORS.text : done ? COLORS.muted : COLORS.faint }}>{name}</span>
                  <div style={{ display: "flex", gap: 6, height: 34, alignItems: "flex-end" }}>
                    {Array.from({ length: i + 1 }, (_, d) => (
                      <div
                        key={d}
                        style={{
                          width: 3,
                          height: 12 + d * 5,
                          borderRadius: 2,
                          background: on || done ? COLORS.lavender : COLORS.faint,
                          opacity: on ? 0.5 + 0.5 * k : done ? 0.6 : 0.35,
                        }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Reveal>
        <Reveal at={sec(4.35)} style={{ marginTop: 70 }}>
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 26,
              color: COLORS.muted,
              opacity: interpolate(frame, [sec(4.35), sec(4.6)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
            }}
          >
            {copy.weather}
          </div>
        </Reveal>
      </AbsoluteFill>
    </Scene>
  );
};
