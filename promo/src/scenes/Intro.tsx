import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { COLORS, FONTS, type Copy } from "../config";
import { Reveal, Scene, Title } from "../components/Scene";
import { Wordmark, wordmarkSize } from "../components/Wordmark";
import { ease, sec } from "../lib/motion";

const CELL = 54;

/**
 * The name first, as a dictionary gives it: a fine, steady rain. Then the rain collects into the
 * mark, and the mark says what it is.
 */
export const Intro: React.FC<{ copy: Copy["intro"] }> = ({ copy }) => {
  const frame = useCurrentFrame();
  const entryOut = 1 - ease(frame, sec(2.5), sec(0.45));
  // The fill's clock runs on past 1 at the same pace, so the last splashes finish.
  const fill = interpolate(frame, [sec(2.7), sec(4.5)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "extend" });
  const lift = ease(frame, sec(4.3), sec(0.7));
  const size = wordmarkSize(CELL);
  return (
    <Scene first>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: entryOut }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 18 }}>
          <Reveal at={sec(0.4)}>
            <span style={{ fontFamily: FONTS.mono, fontSize: 112, color: COLORS.lavender, letterSpacing: 2 }}>{copy.word}</span>
          </Reveal>
          <Reveal at={sec(0.85)}>
            <span style={{ fontSize: 34, color: COLORS.muted }}>
              {copy.phonetic}
              <span style={{ margin: "0 18px", color: COLORS.faint }}>·</span>
              <em>{copy.kind}</em>
            </span>
          </Reveal>
          <Reveal at={sec(1.3)}>
            <span style={{ fontSize: 50, color: COLORS.text }}>{copy.definition}</span>
          </Reveal>
        </div>
      </AbsoluteFill>
      {fill > 0 ? (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <div style={{ transform: `translateY(${-lift * 90}px)`, width: size.width, height: size.height, display: "flex", alignItems: "center" }}>
            <Wordmark cell={CELL} phase={fill} shimmer={frame / sec(14)} glow={0.6 + 0.4 * Math.min(1, fill)} />
          </div>
        </AbsoluteFill>
      ) : null}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingTop: size.height + 150 }}>
        <Reveal at={sec(4.45)}>
          <Title size={58} style={{ textAlign: "center" }}>
            {copy.tagline}
          </Title>
        </Reveal>
        <Reveal at={sec(4.85)} style={{ marginTop: 22 }}>
          <div style={{ fontSize: 30, color: COLORS.muted, textAlign: "center", maxWidth: 1400 }}>{copy.sub}</div>
        </Reveal>
      </AbsoluteFill>
    </Scene>
  );
};
