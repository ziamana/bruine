import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { COLORS, FONTS, type Copy } from "../config";
import { Reveal, Scene } from "../components/Scene";
import { Wordmark, wordmarkSize } from "../components/Wordmark";
import { sec, typed } from "../lib/motion";

const CELL = 40;

/** The mark again, the two commands that start it, and the rain easing off. */
export const Outro: React.FC<{ copy: Copy["outro"] }> = ({ copy }) => {
  const frame = useCurrentFrame();
  const fill = interpolate(frame, [sec(0.1), sec(1.3)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "extend" });
  const install = typed(copy.install, frame, sec(1.35), 34);
  const run = typed(copy.run, frame, sec(2.25), 20);
  const size = wordmarkSize(CELL);
  const cursor = (on: boolean): React.ReactNode =>
    on ? <span style={{ display: "inline-block", width: 14, height: 30, marginLeft: 2, verticalAlign: "-5px", background: COLORS.text, opacity: Math.floor(frame / 20) % 2 === 0 ? 0.9 : 0 }} /> : null;
  return (
    <Scene last>
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 170 }}>
        <div style={{ width: size.width, height: size.height, display: "flex", alignItems: "center" }}>
          <Wordmark cell={CELL} phase={fill} shimmer={frame / sec(10)} />
        </div>
        <Reveal at={sec(1.2)} style={{ marginTop: 80 }}>
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 34,
              background: COLORS.window,
              border: `1px solid ${COLORS.windowEdge}`,
              borderRadius: 16,
              padding: "26px 40px",
              width: 640,
              boxShadow: "0 30px 90px rgba(0,0,0,0.5)",
              lineHeight: 1.6,
            }}
          >
            <div>
              <span style={{ color: COLORS.lavender }}>$ </span>
              <span style={{ color: COLORS.text }}>{install}</span>
              {cursor(frame < sec(2.25))}
            </div>
            <div style={{ opacity: frame >= sec(2.15) ? 1 : 0 }}>
              <span style={{ color: COLORS.lavender }}>$ </span>
              <span style={{ color: COLORS.sky }}>{run}</span>
              {cursor(frame >= sec(2.25))}
            </div>
          </div>
        </Reveal>
        <Reveal at={sec(2.9)} style={{ marginTop: 64 }}>
          <div style={{ fontSize: 40, fontWeight: 500, color: COLORS.text }}>{copy.line}</div>
        </Reveal>
        <Reveal at={sec(3.35)} style={{ marginTop: 26 }}>
          <div style={{ fontSize: 26, color: COLORS.muted, textAlign: "center" }}>
            {copy.meta}
            <div style={{ fontFamily: FONTS.mono, color: COLORS.lavender, marginTop: 14, fontSize: 28 }}>{copy.url}</div>
          </div>
        </Reveal>
      </AbsoluteFill>
    </Scene>
  );
};
