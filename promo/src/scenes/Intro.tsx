import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { COLORS, FONTS, type Copy } from "../config";
import { Scene, Words } from "../components/Scene";
import { Wordmark, wordmarkSize } from "../components/Wordmark";
import { ease, sec } from "../lib/motion";
import { INTRO } from "../timeline.ts";

const CELL = 58;
const MARK_TOP = 214;
const HIT: [number, number] = [960, 452];

/** The first drop: it falls alone through the dark, lands, and the ground rings around it. */
const FirstDrop: React.FC<{ frame: number }> = ({ frame }) => {
  const fall = interpolate(frame, [INTRO.dropStart, INTRO.dropHit], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.in(Easing.quad) });
  const since = frame - INTRO.dropHit;
  const rings = since >= 0 ? [0, 7, 15, 26] : [];
  return (
    <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
      <defs>
        <linearGradient id="firstdrop" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={COLORS.violetLight} stopOpacity={0} />
          <stop offset="1" stopColor="#ffffff" stopOpacity={1} />
        </linearGradient>
        <radialGradient id="impact">
          <stop offset="0" stopColor={COLORS.violetLight} stopOpacity={0.9} />
          <stop offset="1" stopColor={COLORS.lavender} stopOpacity={0} />
        </radialGradient>
      </defs>
      {since < 0 && frame >= INTRO.dropStart ? (
        <rect x={HIT[0] - 2} y={-160 + fall * (HIT[1] + 160) - 120 * (0.3 + fall)} width={4} height={120 * (0.3 + fall)} rx={2} fill="url(#firstdrop)" />
      ) : null}
      {rings.map((delay, i) => {
        const t = (since - delay) / sec(1.9);
        if (t < 0 || t > 1) return null;
        const r = 30 + 1050 * (1 - Math.pow(1 - t, 2.6));
        return <ellipse key={i} cx={HIT[0]} cy={HIT[1]} rx={r} ry={r * 0.26} fill="none" stroke={i === 0 ? COLORS.violetLight : COLORS.lavender} strokeWidth={i === 0 ? 2.4 : 1.4} opacity={(i === 0 ? 0.8 : 0.5) * (1 - t)} />;
      })}
      {since >= 0 && since < sec(0.8) ? <circle cx={HIT[0]} cy={HIT[1]} r={40 + since * 9} fill="url(#impact)" opacity={1 - since / sec(0.8)} /> : null}
    </svg>
  );
};

/**
 * The name first, as a dictionary gives it: a fine, steady rain. Then the rain collects into the
 * mark, light passes over it, and the mark says what it is.
 */
export const Intro: React.FC<{ copy: Copy["intro"] }> = ({ copy }) => {
  const frame = useCurrentFrame();
  const out = ease(frame, INTRO.entryOut, sec(0.45), Easing.in(Easing.cubic));
  // The fill's clock runs on past 1 at the same pace, so the last splashes finish.
  const fill = interpolate(frame, [INTRO.fillStart, INTRO.fillEnd], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "extend" });
  const sweep = interpolate(frame, [INTRO.sweep, INTRO.sweep + sec(0.9)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const bloom = 1 + 0.9 * Math.max(0, 1 - Math.abs(frame - INTRO.fillEnd) / sec(0.5));
  const size = wordmarkSize(CELL);
  const pad = size.height / 3 * 1.6;
  const letters = [...copy.word];
  return (
    <Scene>
      <FirstDrop frame={frame} />
      {frame < INTRO.entryOut + sec(0.5) ? (
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            opacity: 1 - out,
            filter: out > 0 ? `blur(${out * 14}px)` : undefined,
            transform: `translateY(${-out * 30}px) scale(${1 + out * 0.04})`,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: -40 }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 150, color: COLORS.lavender, letterSpacing: 6, textShadow: "0 0 40px rgba(180,167,255,0.45)" }}>
              {letters.map((ch, i) => {
                const k = ease(frame, INTRO.word + i * 4, 18, Easing.out(Easing.cubic));
                return (
                  <span key={i} style={{ display: "inline-block", opacity: k, transform: `translateY(${(1 - k) * -40}px)`, filter: k < 1 ? `blur(${(1 - k) * 14}px)` : undefined }}>
                    {ch}
                  </span>
                );
              })}
            </div>
            <Words
              text={`${copy.phonetic}  ·  ${copy.kind}`}
              at={INTRO.phonetic}
              style={{ fontSize: 36, color: COLORS.muted, fontStyle: "italic", marginTop: 6, whiteSpace: "pre" }}
            />
            <Words text={copy.definition} at={INTRO.definition} stagger={4} style={{ fontSize: 58, color: COLORS.text, marginTop: 26, fontWeight: 500, letterSpacing: -0.5 }} />
          </div>
        </AbsoluteFill>
      ) : null}
      {fill > 0 ? (
        <div style={{ position: "absolute", left: (1920 - size.width) / 2, top: MARK_TOP - pad }}>
          <Wordmark id="intro" cell={CELL} phase={fill} frame={frame} shimmer={frame / sec(14)} glow={bloom * (0.6 + 0.4 * Math.min(1, fill))} sweep={sweep} reflect={ease(frame, INTRO.fillStart + sec(0.6), sec(1))} />
        </div>
      ) : null}
      <AbsoluteFill style={{ alignItems: "center", top: 772 }}>
        <Words text={copy.tagline} at={INTRO.tagline} stagger={3} style={{ fontSize: 62, fontWeight: 650, letterSpacing: -1, textAlign: "center" }} />
        <Words text={copy.sub} at={INTRO.sub} stagger={2} style={{ fontSize: 30, color: COLORS.muted, textAlign: "center", marginTop: 20, maxWidth: 1500 }} />
      </AbsoluteFill>
    </Scene>
  );
};
