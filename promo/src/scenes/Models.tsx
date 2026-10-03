import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { COLORS, FONTS, type Copy } from "../config";
import { Reveal, Scene, Title } from "../components/Scene";
import { ease, sec } from "../lib/motion";

/**
 * A chip that arrives like a drop: a streak falls onto its place, a ring spreads where it lands,
 * and the chip is there.
 */
const Landing: React.FC<{ at: number; children: React.ReactNode; style?: React.CSSProperties; ring?: string }> = ({ at, children, style, ring = COLORS.lavender }) => {
  const frame = useCurrentFrame();
  const fall = interpolate(frame, [at - 12, at], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.in(Easing.quad) });
  const land = ease(frame, at, 14);
  const ripple = interpolate(frame, [at, at + 30], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return (
    <div style={{ position: "relative", ...style }}>
      {fall > 0 && fall < 1 ? (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: -160 + fall * 160,
            width: 3,
            height: 46,
            marginLeft: -1.5,
            borderRadius: 2,
            background: `linear-gradient(to bottom, rgba(180,167,255,0), ${COLORS.violetLight})`,
          }}
        />
      ) : null}
      {ripple > 0 && ripple < 1 ? (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: 40 + ripple * 260,
            height: 14 + ripple * 70,
            transform: "translate(-50%, -50%)",
            borderRadius: "50%",
            border: `1.5px solid ${ring}`,
            opacity: 0.7 * (1 - ripple),
          }}
        />
      ) : null}
      <div style={{ opacity: land, transform: `translateY(${(1 - land) * 6}px)` }}>{children}</div>
    </div>
  );
};

const chip: React.CSSProperties = {
  background: COLORS.surface,
  border: `1px solid ${COLORS.windowEdge}`,
  borderRadius: 14,
  height: 76,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 30,
  color: COLORS.text,
};

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontFamily: FONTS.mono, fontSize: 20, letterSpacing: 3, textTransform: "uppercase", color: COLORS.lavender, marginBottom: 22 }}>{children}</div>
);

export const Models: React.FC<{ copy: Copy["models"] }> = ({ copy }) => {
  const frame = useCurrentFrame();
  const scan = (frame % sec(1.6)) / sec(1.6);
  return (
    <Scene>
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 150 }}>
        <Reveal at={sec(0.2)}>
          <Title size={68}>{copy.title}</Title>
        </Reveal>
        <div style={{ display: "flex", gap: 72, marginTop: 84, alignItems: "flex-start" }}>
          <div style={{ width: 430 }}>
            <Reveal at={sec(0.55)}>
              <Label>{copy.localLabel}</Label>
            </Reveal>
            <Landing at={sec(0.8)} ring={COLORS.sky}>
              <div style={{ ...chip, height: 252, flexDirection: "column", gap: 14, border: `1px solid rgba(125,207,255,0.35)` }}>
                <div style={{ position: "relative", width: 64, height: 64 }}>
                  {[0, 0.5].map((o) => {
                    const k = (scan + o) % 1;
                    return (
                      <div
                        key={o}
                        style={{
                          position: "absolute",
                          left: 32 - 32 * k,
                          top: 32 - 32 * k,
                          width: 64 * k,
                          height: 64 * k,
                          borderRadius: "50%",
                          border: `1.5px solid ${COLORS.sky}`,
                          opacity: 1 - k,
                        }}
                      />
                    );
                  })}
                  <div style={{ position: "absolute", left: 26, top: 26, width: 12, height: 12, borderRadius: 6, background: COLORS.sky }} />
                </div>
                <div style={{ fontFamily: FONTS.mono, fontSize: 36, color: COLORS.text }}>{copy.localName}</div>
                <div style={{ fontFamily: FONTS.mono, fontSize: 22, color: COLORS.sky }}>{copy.localAddress}</div>
                <div style={{ fontSize: 21, color: COLORS.muted }}>{copy.localDetail}</div>
              </div>
            </Landing>
          </div>
          <div style={{ width: 880 }}>
            <Reveal at={sec(0.95)}>
              <Label>{copy.cloudLabel}</Label>
            </Reveal>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
              {copy.providers.map((name, i) => (
                <Landing key={name} at={sec(1.15) + i * 5}>
                  <div style={chip}>{name}</div>
                </Landing>
              ))}
            </div>
            <Reveal at={sec(2.2)} style={{ marginTop: 22 }}>
              <div style={{ fontSize: 24, color: COLORS.muted, textAlign: "center" }}>+ {copy.more}</div>
            </Reveal>
          </div>
        </div>
        <Reveal at={sec(2.8)} style={{ marginTop: 64 }}>
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 26,
              color: COLORS.text,
              background: COLORS.surface,
              border: `1px solid ${COLORS.windowEdge}`,
              borderRadius: 12,
              padding: "16px 28px",
            }}
          >
            <span style={{ color: COLORS.lavender }}>{"> "}</span>
            {copy.compat}
          </div>
        </Reveal>
        <Reveal at={sec(3.7)} style={{ marginTop: 40 }}>
          <div style={{ fontSize: 28, color: COLORS.muted }}>{copy.footnote}</div>
        </Reveal>
      </AbsoluteFill>
    </Scene>
  );
};
