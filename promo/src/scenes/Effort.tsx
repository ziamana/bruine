import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { COLORS, FONTS, type Copy } from "../config";
import { KeyCap, Scene, Words } from "../components/Scene";
import { glowColor, glowMode, type GlowMode } from "../components/Glow";
import { cellOf, TermRow } from "../components/TermGrid";
import type { Span } from "../data/terminal";
import { blendHex, ease } from "../lib/motion";
import { EFFORT, LIGHTNING } from "../timeline.ts";

const FONT = 22;
const COLS = 100;
/** The colour of the input box's border when the effort asks for no glow (as recorded). */
const REST = "#b4a7ff";

/**
 * The real bottom of bruine's screen, drawn as the terminal shows it (the rows recorded in
 * src/data/terminal.ts): the input box, the place and the mode, the context and the route with
 * the effort in its slot. The box's border is tinted column by column by the effort, with the
 * same law as src/ui/border-glow.ts.
 */
const PromptStrip: React.FC<{ prompt: string; level: string; mode: GlowMode; previous: GlowMode; mix: number; frame: number; heat: number }> = ({
  prompt,
  level,
  mode,
  previous,
  mix,
  frame,
  heat,
}) => {
  const cell = cellOf(FONT);
  const timeMs = (frame / 45) * 1000;
  const border = (col: number): string => {
    const tone = (m: GlowMode): string => (m === "off" ? REST : glowColor(m, col, timeMs));
    return mix >= 1 ? tone(mode) : blendHex(tone(previous), tone(mode), mix);
  };
  const line = (from: number, chars: string): Span[] => [...chars].map((ch, i) => [from + i, ch, border(from + i), null, 0]);
  const inner = COLS - 6;
  const route = `(local) Qwen3 Coder 30B`;
  const routeEnd = COLS - 2;
  const routeFrom = routeEnd - (route.length + 3 + level.length);
  const blink = Math.floor(frame / 24) % 2 === 0;
  const rows: Span[][] = [
    line(2, `╭${"─".repeat(inner)}╮`),
    [...line(2, "│"), [3, ` ${prompt}`, null, null, 0], [4 + prompt.length, " ", null, null, blink ? 8 : 0], ...line(COLS - 3, "│")],
    line(2, `╰${"─".repeat(inner)}╯`),
    [[2, "~/code/api", null, null, 0], [COLS - 5, "ask", "#8a90a6", null, 0]],
    [
      [2, "ctx", "#8a90a6", null, 0],
      [6, "0% of 100k", "#8fe3a3", null, 0],
      [routeFrom, route, "#e6e9f2", null, 0],
      [routeFrom + route.length + 1, "•", "#676e87", null, 0],
      [routeFrom + route.length + 3, level, mode === "off" ? "#8a90a6" : "#d9d0ff", null, mode === "off" ? 0 : 1],
    ],
  ];
  return (
    <div
      style={{
        position: "relative",
        width: COLS * cell.w,
        height: rows.length * cell.h,
        fontFamily: FONTS.mono,
        fontSize: FONT,
        filter: heat > 0.4 ? `drop-shadow(0 0 ${18 * heat}px rgba(180,167,255,${0.25 * heat}))` : undefined,
      }}
    >
      {rows.map((spans, y) => (
        <TermRow key={y} spans={spans} y={y} font={FONT} />
      ))}
    </div>
  );
};

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
        <div style={{ marginTop: 64, opacity: boxIn, transform: `translateY(${(1 - boxIn) * 20}px) scale(${1 + 0.008 * pulse})` }}>
          <PromptStrip prompt={copy.prompt} level={step < 0 ? "auto" : level} mode={mode} previous={previous} mix={mix} frame={frame} heat={heat} />
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
