import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, FADE, FONTS } from "../config";

/**
 * A scene's entrance and exit: it rises a few pixels out of the rain and settles, and leaves the
 * same way. Over the overlap the old scene is gone before the new one arrives, with a breath of
 * rain alone between them, so two layouts never sit on top of each other.
 */
export const Scene: React.FC<{ children: React.ReactNode; first?: boolean; last?: boolean }> = ({ children, first, last }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const enter = first ? 1 : interpolate(frame, [FADE * 0.45, FADE], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const exit = last ? 1 : interpolate(frame, [durationInFrames - FADE, durationInFrames - FADE * 0.55], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.in(Easing.quad) });
  const opacity = Math.min(enter, exit);
  const y = (1 - enter) * 14 - (1 - exit) * 10;
  return (
    <AbsoluteFill style={{ opacity, transform: `translateY(${y}px)`, fontFamily: FONTS.sans, color: COLORS.text }}>
      {children}
    </AbsoluteFill>
  );
};

/** A line that fades up into place from `at`. */
export const Reveal: React.FC<{ at: number; children: React.ReactNode; style?: React.CSSProperties; rise?: number; length?: number }> = ({
  at,
  children,
  style,
  rise = 12,
  length = 18,
}) => {
  const frame = useCurrentFrame();
  const k = interpolate(frame, [at, at + length], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  return <div style={{ opacity: k, transform: `translateY(${(1 - k) * rise}px)`, ...style }}>{children}</div>;
};

export const Title: React.FC<{ children: React.ReactNode; size?: number; style?: React.CSSProperties }> = ({ children, size = 64, style }) => (
  <div style={{ fontSize: size, fontWeight: 600, letterSpacing: -0.5, lineHeight: 1.15, color: COLORS.text, ...style }}>{children}</div>
);
