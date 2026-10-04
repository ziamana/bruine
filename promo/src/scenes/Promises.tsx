import React from "react";
import { AbsoluteFill, Easing, useCurrentFrame } from "remotion";
import { COLORS, FONTS, type Copy } from "../config";
import { Scene, Words } from "../components/Scene";
import { ease } from "../lib/motion";
import { PROMISES } from "../timeline.ts";

const TURNS = 4;
const ROW_H = 58;
const LABEL_W = 120;
const SYSTEM_W = 260;
const TOOLS_W = 200;
const MESSAGE_W = 44;

/**
 * The one promise the demo cannot show: the prompt cache. Every turn sends the same system
 * prompt and the same tools, byte for byte, and only the conversation grows after them, so the
 * provider serves the start of every request from its cache. A test asserts it.
 */
export const Promises: React.FC<{ copy: Copy["promises"] }> = ({ copy }) => {
  const frame = useCurrentFrame();
  const bracket = ease(frame, PROMISES.bracket, 14, Easing.out(Easing.cubic));
  const block = (width: number, color: string, label?: string, glow = 0): React.ReactNode => (
    <div
      style={{
        width,
        height: ROW_H - 14,
        borderRadius: 8,
        background: color,
        fontFamily: FONTS.mono,
        fontSize: 26,
        color: COLORS.night,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        boxShadow: glow > 0 ? `0 0 ${24 * glow}px rgba(180,167,255,${0.6 * glow})` : undefined,
      }}
    >
      {label}
    </div>
  );
  return (
    <Scene>
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 170 }}>
        <Words text={copy.title} at={PROMISES.title} stagger={4} style={{ fontSize: 76, fontWeight: 650, letterSpacing: -1 }} />
        <Words text={copy.body} at={PROMISES.body} stagger={1} style={{ fontSize: 34, color: COLORS.muted, marginTop: 20, maxWidth: 1400, textAlign: "center", lineHeight: 1.35 }} />
        <div style={{ marginTop: 70, display: "flex", flexDirection: "column", gap: 14 }}>
          {Array.from({ length: TURNS }, (_, i) => {
            const k = ease(frame, PROMISES.row(i), 12, Easing.out(Easing.cubic));
            // The cached start lights up once the bracket says what it is.
            const lit = bracket * (0.5 + 0.5 * Math.sin((frame - PROMISES.bracket) / 9 - i * 0.7));
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, height: ROW_H, opacity: k, transform: `translateX(${(1 - k) * -30}px)` }}>
                <div style={{ width: LABEL_W, fontFamily: FONTS.mono, fontSize: 28, color: COLORS.muted, whiteSpace: "nowrap" }}>
                  {copy.cache.turn} {i + 1}
                </div>
                {block(SYSTEM_W, COLORS.lavender, copy.cache.system, lit)}
                {block(TOOLS_W, COLORS.sky, copy.cache.tools, lit)}
                {Array.from({ length: (i + 1) * 2 }, (_, m) => (
                  <React.Fragment key={m}>{block(MESSAGE_W, m % 2 === 0 ? COLORS.chip : "#3a4058")}</React.Fragment>
                ))}
              </div>
            );
          })}
          <div style={{ marginLeft: LABEL_W + 10, width: SYSTEM_W + TOOLS_W + 10, opacity: bracket, transform: `scaleX(${0.3 + 0.7 * bracket})`, transformOrigin: "left" }}>
            <div style={{ height: 16, borderLeft: `2px solid ${COLORS.lavender}`, borderRight: `2px solid ${COLORS.lavender}`, borderBottom: `2px solid ${COLORS.lavender}` }} />
            <div style={{ fontSize: 32, color: COLORS.lavender, textAlign: "center", marginTop: 12, whiteSpace: "nowrap" }}>{copy.cache.same}</div>
          </div>
        </div>
      </AbsoluteFill>
    </Scene>
  );
};
