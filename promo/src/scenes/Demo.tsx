import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { COLORS, FONTS, type Copy } from "../config";
import { KeyCap, Scene, Words } from "../components/Scene";
import { TERMINAL } from "../data/terminal";
import { cellOf, TERM_BG, TermRow } from "../components/TermGrid";
import { ease } from "../lib/motion";
import { CAPTION_AT, DEMO as T, recordingFrame, sec } from "../timeline.ts";

/**
 * The recording is 104 columns by 26 rows (the narrowest where the status bar keeps its long
 * form), drawn as large as the frame allows: 28.5 px type, about half as large again as a
 * window beside a column of captions could be. The window is taller than the space under the
 * captions, so a camera follows the last line bruine has written.
 */
const FONT = 28.5;
const CELL = cellOf(FONT);
const PAD = 22;
const BAR = 46;
const WIN = {
  x: Math.round((1920 - (TERMINAL.cols * CELL.w + PAD * 2)) / 2),
  width: Math.round(TERMINAL.cols * CELL.w + PAD * 2),
  height: BAR + PAD / 2 + TERMINAL.rows * CELL.h + PAD,
};
/** Everything under the captions: the window slides inside this band. */
const VIEW = { top: 196, bottom: 1062 };
const HIGHEST = VIEW.top;
const LOWEST = VIEW.bottom - WIN.height;

/** The last row with something on it, for every frame of the recording. */
const LAST_ROW: number[] = TERMINAL.frames.map((rows) => {
  for (let y = rows.length - 1; y >= 0; y -= 1) {
    if (TERMINAL.rowTable[rows[y]!]!.some(([, text, , bg]) => text.trim() !== "" || bg !== null)) return y;
  }
  return 0;
});

/** Where the window's top sits so the last written row is on screen, one row of air under it. */
function target(frame: number): number {
  const last = LAST_ROW[recordingFrame(frame)]!;
  const bottom = BAR + PAD / 2 + (last + 2) * CELL.h;
  return Math.max(LOWEST, Math.min(HIGHEST, VIEW.bottom - bottom));
}

/** The camera: the target, followed with a lag (the average of the last 0.8 s of targets). */
function windowTop(frame: number): number {
  const span = sec(0.8);
  let sum = 0;
  for (let i = 0; i < span; i += 1) sum += target(frame - i);
  return sum / span;
}

const Terminal: React.FC<{ copy: Copy["demo"]; frame: number }> = ({ copy, frame }) => {
  const rows = TERMINAL.frames[recordingFrame(frame)]!;
  return (
    <div
      style={{
        position: "absolute",
        left: WIN.x,
        top: windowTop(frame),
        width: WIN.width,
        height: WIN.height,
        background: TERM_BG,
        borderRadius: 16,
        border: `1px solid ${COLORS.windowEdge}`,
        boxShadow: "0 50px 140px rgba(0,0,0,0.6), 0 0 0 1px rgba(180,167,255,0.06), 0 0 120px rgba(180,167,255,0.07)",
        overflow: "hidden",
      }}
    >
      <div style={{ height: BAR, display: "flex", alignItems: "center", padding: "0 18px", borderBottom: "1px solid #1e2230", background: "#0b0d14" }}>
        {["#ff5f58", "#ffbd2e", "#28c840"].map((c) => (
          <div key={c} style={{ width: 14, height: 14, borderRadius: 7, background: c, opacity: 0.8, marginRight: 9 }} />
        ))}
        <div style={{ flex: 1, textAlign: "center", fontFamily: FONTS.sans, fontSize: 22, color: COLORS.muted, marginRight: 70 }}>bruine · {copy.project}</div>
      </div>
      <div style={{ position: "relative", margin: PAD, marginTop: PAD / 2, fontFamily: FONTS.mono, fontSize: FONT, fontVariantLigatures: "none" }}>
        {rows.map((index, y) => (
          <TermRow key={y} spans={TERMINAL.rowTable[index]!} y={y} font={FONT} />
        ))}
      </div>
    </div>
  );
};

/**
 * One caption at a time, above the window: what the viewer is looking at, in a few words. The
 * scene opens on its title until the first thing worth naming happens.
 */
const Caption: React.FC<{ copy: Copy["demo"]; frame: number }> = ({ copy, frame }) => {
  const active = CAPTION_AT.reduce((acc, at, i) => (frame >= at ? i : acc), -1);
  const items = [{ at: 0, number: "", title: copy.title, body: copy.titleBody }, ...copy.callouts.map((c, i) => ({ at: CAPTION_AT[i]!, number: String(i + 1).padStart(2, "0"), ...c }))];
  return (
    <>
      {items.map((item, i) => {
        const current = i === active + 1;
        const next = items[i + 1];
        const leaving = next === undefined ? 0 : ease(frame, next.at, 10, Easing.in(Easing.cubic));
        if (frame < item.at || (!current && leaving >= 1)) return null;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: WIN.x + 4,
              right: WIN.x + 230,
              top: 46,
              display: "flex",
              alignItems: "baseline",
              gap: 22,
              opacity: 1 - leaving,
              transform: `translateY(${-leaving * 16}px)`,
            }}
          >
            {item.number !== "" ? <div style={{ fontFamily: FONTS.mono, fontSize: 30, color: COLORS.lavender }}>{item.number}</div> : null}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Words text={item.title} at={item.at} stagger={3} style={{ fontSize: 56, fontWeight: 650, letterSpacing: -1, color: COLORS.text, lineHeight: 1.05 }} />
              <Words text={item.body} at={item.at + 8} stagger={1} style={{ fontSize: 30, color: COLORS.muted, lineHeight: 1.3 }} />
            </div>
          </div>
        );
      })}
    </>
  );
};

/** The keys the recording pressed, large, in the corner of the captions. */
const KEYS: Array<{ at: number; label: (copy: Copy["demo"]) => string }> = [
  { at: T.submit, label: (c) => `⏎ ${c.enterKey}` },
  { at: T.queueSubmit, label: (c) => `⏎ ${c.enterKey}` },
  { at: T.approve1, label: () => "y" },
  { at: T.approve2, label: () => "a" },
];

/** The real bruine, recorded in a real terminal, start to finish: think, queue, ask, test, answer. */
export const Demo: React.FC<{ copy: Copy["demo"] }> = ({ copy }) => {
  const frame = useCurrentFrame();
  // The window slides under the captions: its top fades out before it reaches them.
  const mask = `linear-gradient(to bottom, transparent ${VIEW.top - 26}px, #000 ${VIEW.top + 10}px)`;
  const arrive = interpolate(frame, [0, sec(0.6)], [40, 0], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return (
    <Scene>
      <AbsoluteFill style={{ maskImage: mask, WebkitMaskImage: mask, transform: `translateY(${arrive}px)` }}>
        <Terminal copy={copy} frame={frame} />
      </AbsoluteFill>
      <Caption copy={copy} frame={frame} />
      {KEYS.map((key, i) => (
        <div key={i} style={{ position: "absolute", right: WIN.x + 4, top: 52 }}>
          <KeyCap label={key.label(copy)} at={key.at} hold={20} size={36} />
        </div>
      ))}
    </Scene>
  );
};
