import React from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, FONTS } from "../config";

/** The frame a scene draws in. Its entrance and exit belong to the film (SceneShell). */
export const Scene: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill style={{ fontFamily: FONTS.sans, color: COLORS.text }}>{children}</AbsoluteFill>
);

/** A block that comes into focus from `at`: it rises, sharpens and lights up. */
export const Reveal: React.FC<{ at: number; children: React.ReactNode; style?: React.CSSProperties; rise?: number; length?: number; blur?: number }> = ({
  at,
  children,
  style,
  rise = 14,
  length = 20,
  blur = 10,
}) => {
  const frame = useCurrentFrame();
  const k = interpolate(frame, [at, at + length], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  return (
    <div style={{ opacity: k, transform: `translateY(${(1 - k) * rise}px)`, filter: k < 1 ? `blur(${(1 - k) * blur}px)` : undefined, ...style }}>
      {children}
    </div>
  );
};

/**
 * A line that arrives word by word, each word coming out of a blur like a drop coming into
 * focus. `stagger` is the frames between two words.
 */
export const Words: React.FC<{ text: string; at: number; stagger?: number; style?: React.CSSProperties; wordStyle?: (i: number) => React.CSSProperties | undefined }> = ({
  text,
  at,
  stagger = 3,
  style,
  wordStyle,
}) => {
  const frame = useCurrentFrame();
  const words = text.split(" ");
  return (
    <div style={style}>
      {words.map((word, i) => {
        const k = interpolate(frame, [at + i * stagger, at + i * stagger + 16], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.out(Easing.cubic),
        });
        return (
          <React.Fragment key={i}>
            <span
              style={{
                display: "inline-block",
                opacity: k,
                transform: `translateY(${(1 - k) * 22}px)`,
                filter: k < 1 ? `blur(${(1 - k) * 12}px)` : undefined,
                ...wordStyle?.(i),
              }}
            >
              {word}
            </span>
            {i < words.length - 1 ? " " : null}
          </React.Fragment>
        );
      })}
    </div>
  );
};

export const Title: React.FC<{ children: React.ReactNode; size?: number; style?: React.CSSProperties }> = ({ children, size = 64, style }) => (
  <div style={{ fontSize: size, fontWeight: 650, letterSpacing: -1, lineHeight: 1.15, color: COLORS.text, ...style }}>{children}</div>
);

/** A key on a keyboard, pressed at `at`: it pops in, goes down, comes back up, and goes. */
export const KeyCap: React.FC<{ label: string; at: number; hold?: number; size?: number }> = ({ label, at, hold = 26, size = 26 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < at - 6 || frame > at + hold + 10) return null;
  const pop = spring({ frame: frame - (at - 6), fps, config: { damping: 14, stiffness: 220 } });
  const press = frame >= at && frame < at + 5 ? 1 : 0;
  const out = interpolate(frame, [at + hold, at + hold + 10], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: size * 2.2,
        height: size * 2.1,
        padding: `0 ${size * 0.7}px`,
        borderRadius: size * 0.45,
        background: `linear-gradient(${COLORS.chip}, ${COLORS.surface})`,
        border: `1.5px solid ${press ? COLORS.lavender : "#3a4058"}`,
        boxShadow: press ? `0 1px 0 #0a0c12, 0 0 28px rgba(180,167,255,0.55)` : `0 ${size * 0.22}px 0 #0a0c12, 0 10px 30px rgba(0,0,0,0.5)`,
        transform: `translateY(${press * size * 0.18}px) scale(${0.6 + 0.4 * pop})`,
        opacity: Math.min(pop, out),
        fontFamily: FONTS.mono,
        fontSize: size,
        color: press ? COLORS.violetLight : COLORS.text,
      }}
    >
      {label}
    </div>
  );
};
