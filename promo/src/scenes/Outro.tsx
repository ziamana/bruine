import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { COLORS, FONTS, type Copy } from "../config";
import { KeyCap, Reveal, Scene, Words } from "../components/Scene";
import { Wordmark, wordmarkSize } from "../components/Wordmark";
import { ease, sec, typed } from "../lib/motion";
import { OUTRO } from "../timeline.ts";

const CELL = 42;
const MARK_TOP = 132;

/** The mark again, on wet ground, the two commands that start it, and the rain easing off. */
export const Outro: React.FC<{ copy: Copy["outro"] }> = ({ copy }) => {
  const frame = useCurrentFrame();
  const fill = interpolate(frame, [OUTRO.fillStart, OUTRO.fillEnd], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "extend" });
  const sweep = interpolate(frame, [OUTRO.sweep, OUTRO.sweep + sec(0.9)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const install = typed(copy.install, frame, OUTRO.installStart, OUTRO.installCps);
  const run = typed(copy.run, frame, OUTRO.runStart, OUTRO.runCps);
  const size = wordmarkSize(CELL);
  const pad = (size.height / 3) * 1.6;
  const ran = ease(frame, OUTRO.enter2, 12);
  const cursor = (on: boolean): React.ReactNode =>
    on ? <span style={{ display: "inline-block", width: 15, height: 32, marginLeft: 2, verticalAlign: "-6px", background: COLORS.text, opacity: Math.floor(frame / 20) % 2 === 0 ? 0.9 : 0 }} /> : null;
  return (
    <Scene>
      <div style={{ position: "absolute", left: (1920 - size.width) / 2, top: MARK_TOP - pad }}>
        <Wordmark id="outro" cell={CELL} phase={fill} frame={frame} shimmer={frame / sec(10)} glow={1 + 0.8 * Math.max(0, 1 - Math.abs(frame - OUTRO.fillEnd) / sec(0.5))} sweep={sweep} reflect={ease(frame, OUTRO.fillStart + sec(0.4), sec(0.8))} />
      </div>
      <AbsoluteFill style={{ alignItems: "center", top: 600 }}>
        <Reveal at={OUTRO.box}>
          <div
            style={{
              position: "relative",
              fontFamily: FONTS.mono,
              fontSize: 36,
              background: "rgba(17,20,30,0.95)",
              border: `1px solid ${ran > 0 ? `rgba(180,167,255,${0.25 + 0.4 * ran})` : COLORS.windowEdge}`,
              borderRadius: 18,
              padding: "24px 44px",
              width: 700,
              boxShadow: `0 30px 90px rgba(0,0,0,0.5), 0 0 ${60 * ran}px rgba(180,167,255,${0.2 * ran})`,
              lineHeight: 1.6,
            }}
          >
            <div>
              <span style={{ color: COLORS.lavender }}>$ </span>
              <span style={{ color: COLORS.text }}>{install}</span>
              {cursor(frame < OUTRO.runStart)}
            </div>
            <div style={{ opacity: frame >= OUTRO.enter1 + 3 ? 1 : 0 }}>
              <span style={{ color: COLORS.lavender }}>$ </span>
              <span style={{ color: COLORS.sky }}>{run}</span>
              {cursor(frame >= OUTRO.runStart)}
            </div>
            <div style={{ position: "absolute", right: -150, top: 36 }}>
              <KeyCap label="⏎" at={OUTRO.enter1} hold={12} size={24} />
            </div>
            <div style={{ position: "absolute", right: -150, top: 36 }}>
              <KeyCap label="⏎" at={OUTRO.enter2} hold={16} size={24} />
            </div>
          </div>
        </Reveal>
        <Words text={copy.line} at={OUTRO.line} stagger={3} style={{ fontSize: 46, fontWeight: 550, color: COLORS.text, marginTop: 58, letterSpacing: -0.5 }} />
        <Reveal at={OUTRO.meta} style={{ marginTop: 22 }}>
          <div style={{ fontSize: 26, color: COLORS.muted, textAlign: "center" }}>
            {copy.meta}
            <div style={{ fontFamily: FONTS.mono, color: COLORS.lavender, marginTop: 14, fontSize: 30, textShadow: "0 0 24px rgba(180,167,255,0.45)" }}>{copy.url}</div>
          </div>
        </Reveal>
      </AbsoluteFill>
    </Scene>
  );
};
