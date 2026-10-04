import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { COLORS, FONTS, type Copy } from "../config";
import { Scene, Words } from "../components/Scene";
import { ease, sec } from "../lib/motion";
import { PROMISES } from "../timeline.ts";

const CARD_AT = PROMISES.cards;
const VISUAL = 230;

const Speed: React.FC<{ copy: Copy["promises"]["speed"]; at: number }> = ({ copy, at }) => {
  const frame = useCurrentFrame();
  const strike = ease(frame, at + PROMISES.strike, 10);
  const count = interpolate(frame, [at + PROMISES.countFrom, at + PROMISES.countTo], [0, Number(copy.measured)], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const settled = Math.max(0, 1 - Math.abs(frame - at - PROMISES.countTo) / 12);
  return (
    <div style={{ height: VISUAL, display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 56, paddingBottom: 18 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ position: "relative", fontFamily: FONTS.mono, fontSize: 64, color: COLORS.faint }}>
          {copy.quoted}
          <div style={{ position: "absolute", left: -6, top: "52%", height: 4, width: `calc(${strike * 100}% + 12px)`, background: COLORS.rose, borderRadius: 2 }} />
        </div>
        <div style={{ fontSize: 20, color: COLORS.faint, marginTop: 6 }}>{copy.quotedLabel}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ fontFamily: FONTS.mono, fontSize: 104, color: COLORS.mint, lineHeight: 1, textShadow: `0 0 ${30 * settled + 10}px rgba(143,227,163,${0.25 + 0.5 * settled})` }}>
          <Odometer value={count} digits={copy.measured.length} height={104} />
        </div>
        <div style={{ fontSize: 20, color: COLORS.muted, marginTop: 10 }}>
          {copy.measuredLabel} · <span style={{ fontFamily: FONTS.mono }}>{copy.unit}</span>
        </div>
      </div>
    </div>
  );
};

/**
 * Digits that roll like a counter: the ones wheel turns continuously and carries into the tens
 * only in its last tenth of a turn, so the number reads at every frame.
 */
const Odometer: React.FC<{ value: number; digits: number; height: number }> = ({ value, digits, height }) => {
  const wheels: number[] = [];
  let carry = value;
  for (let d = 0; d < digits; d += 1) {
    const place = Math.pow(10, d);
    const whole = Math.floor(value / place);
    const ones = (value / place) % 10;
    // The lowest wheel turns smoothly; a higher one moves only while the one below passes 9 to 0.
    const below = d === 0 ? 0 : (value / Math.pow(10, d - 1)) % 10;
    wheels.unshift(d === 0 ? ones : (whole % 10) + Math.max(0, below - 9));
    carry = whole;
  }
  void carry;
  return (
    <span style={{ display: "inline-flex" }}>
      {wheels.map((pos, i) => (
        <span key={i} style={{ display: "inline-block", height, overflow: "hidden", lineHeight: `${height}px` }}>
          <span style={{ display: "flex", flexDirection: "column", transform: `translateY(${-pos * height}px)` }}>
            {Array.from({ length: 11 }, (_, n) => (
              <span key={n} style={{ height }}>{n % 10}</span>
            ))}
          </span>
        </span>
      ))}
    </span>
  );
};

const VERDICT = { allow: COLORS.mint, ask: COLORS.amber, deny: COLORS.rose } as const;
const Rules: React.FC<{ rules: Copy["promises"]["rules"]; at: number }> = ({ rules, at }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ height: VISUAL, display: "flex", flexDirection: "column", justifyContent: "center", gap: 14, padding: "0 6px" }}>
      {rules.map((rule, i) => {
        const k = ease(frame, at + sec(0.45) + i * 8, 12);
        const verdict = ease(frame, at + sec(0.45) + i * 8 + 10, 10, Easing.out(Easing.back(2)));
        return (
          <div
            key={rule.command}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              background: COLORS.window,
              border: `1px solid ${COLORS.windowEdge}`,
              borderRadius: 10,
              padding: "0 16px",
              height: 54,
              opacity: k,
              transform: `translateX(${(1 - k) * 12}px)`,
              fontFamily: FONTS.mono,
              fontSize: 22,
            }}
          >
            <span style={{ color: COLORS.text }}>
              <span style={{ color: COLORS.faint }}>$ </span>
              {rule.command}
            </span>
            <span
              style={{
                color: VERDICT[rule.verdict],
                border: `1.5px solid ${VERDICT[rule.verdict]}`,
                borderRadius: 999,
                padding: "2px 14px",
                fontSize: 19,
                opacity: Math.min(1, verdict),
                transform: `scale(${0.6 + 0.4 * verdict})`,
                display: "inline-block",
              }}
            >
              {rule.label}
            </span>
          </div>
        );
      })}
    </div>
  );
};

const Cache: React.FC<{ copy: Copy["promises"]["cache"]; at: number }> = ({ copy, at }) => {
  const frame = useCurrentFrame();
  const segment = (w: number, color: string, label?: string, alpha = 1): React.ReactNode => (
    <div
      style={{
        width: w,
        height: 34,
        borderRadius: 6,
        background: color,
        opacity: alpha,
        fontFamily: FONTS.mono,
        fontSize: 16,
        color: COLORS.night,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {label}
    </div>
  );
  return (
    <div style={{ height: VISUAL, display: "flex", flexDirection: "column", justifyContent: "center", gap: 12, padding: "0 6px" }}>
      {[1, 2, 3].map((turn, i) => {
        const k = ease(frame, at + sec(0.45) + i * 8, 12);
        return (
          <div key={turn} style={{ display: "flex", alignItems: "center", gap: 6, opacity: k }}>
            <div style={{ width: 60, fontFamily: FONTS.mono, fontSize: 17, color: COLORS.faint, whiteSpace: "nowrap" }}>
              {copy.turn} {turn}
            </div>
            {segment(110, COLORS.lavender, copy.system)}
            {segment(84, COLORS.sky, copy.tools)}
            {Array.from({ length: turn * 2 }, (_, m) => (
              <React.Fragment key={m}>{segment(18, m % 2 === 0 ? COLORS.chip : "#3a4058")}</React.Fragment>
            ))}
          </div>
        );
      })}
      <div style={{ marginLeft: 66, width: 200, opacity: ease(frame, at + sec(1.2), 12), transform: `scaleX(${0.3 + 0.7 * ease(frame, at + sec(1.2), 12)})`, transformOrigin: "left" }}>
        <div style={{ height: 10, borderLeft: `1.5px solid ${COLORS.lavender}`, borderRight: `1.5px solid ${COLORS.lavender}`, borderBottom: `1.5px solid ${COLORS.lavender}` }} />
        <div style={{ fontSize: 18, color: COLORS.lavender, textAlign: "center", marginTop: 8, whiteSpace: "nowrap" }}>{copy.same}</div>
      </div>
    </div>
  );
};

export const Promises: React.FC<{ copy: Copy["promises"] }> = ({ copy }) => {
  const frame = useCurrentFrame();
  const visuals = [
    <Speed key="s" copy={copy.speed} at={CARD_AT[0]} />,
    <Rules key="r" rules={copy.rules} at={CARD_AT[1]} />,
    <Cache key="c" copy={copy.cache} at={CARD_AT[2]} />,
  ];
  return (
    <Scene>
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 225 }}>
        <Words text={copy.title} at={PROMISES.title} stagger={4} style={{ fontSize: 72, fontWeight: 650, letterSpacing: -1 }} />
        <div style={{ display: "flex", gap: 40, marginTop: 72, perspective: 1400 }}>
          {copy.cards.map((card, i) => {
            const k = ease(frame, CARD_AT[i]!, 22, Easing.out(Easing.cubic));
            const edge = interpolate(frame, [CARD_AT[i]! + 6, CARD_AT[i]! + 40], [-0.3, 1.3], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            const land = Math.max(0, 1 - Math.abs(frame - CARD_AT[i]! - 14) / 18);
            return (
              <div
                key={card.title}
                style={{
                  width: 530,
                  background: "rgba(28,32,48,0.88)",
                  border: `1px solid ${COLORS.windowEdge}`,
                  borderRadius: 22,
                  padding: "34px 36px 40px",
                  boxSizing: "border-box",
                  opacity: k,
                  transform: `translateY(${(1 - k) * 60}px) rotateX(${(1 - k) * 28}deg)`,
                  transformOrigin: "50% 100%",
                  position: "relative",
                  overflow: "hidden",
                  boxShadow: `0 30px 80px rgba(0,0,0,0.45), 0 0 ${50 * land}px rgba(180,167,255,${0.3 * land})`,
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    width: "100%",
                    height: 2,
                    background: `linear-gradient(90deg, transparent ${edge * 100 - 30}%, ${COLORS.violetLight} ${edge * 100}%, transparent ${edge * 100 + 30}%)`,
                  }}
                />
                <div style={{ fontFamily: FONTS.mono, fontSize: 20, color: COLORS.lavender }}>{String(i + 1).padStart(2, "0")}</div>
                {visuals[i]}
                <div style={{ height: 1, background: COLORS.windowEdge, margin: "10px 0 28px" }} />
                <div style={{ fontSize: 36, fontWeight: 600, color: COLORS.text, lineHeight: 1.2 }}>{card.title}</div>
                <div style={{ fontSize: 23, color: COLORS.muted, lineHeight: 1.45, marginTop: 14 }}>{card.body}</div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </Scene>
  );
};
