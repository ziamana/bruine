import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { COLORS, FONTS, type Copy } from "../config";
import { KeyCap, Scene, Words } from "../components/Scene";
import { TERMINAL } from "../data/terminal";
import { TERM_BG, TermRow } from "../components/TermGrid";
import { ease, sec } from "../lib/motion";
import { CAPTION_AT, DEMO as T, recordingFrame } from "../timeline.ts";

/** The terminal the recording was made in, drawn at this size: 100 columns, 30 rows. */
const FONT = 21;
const CELL_W = FONT * 0.602;
const CELL_H = Math.round(FONT * 1.2);
const PAD = 22;
const BAR = 40;
const WIN = {
  x: 52,
  width: Math.round(TERMINAL.cols * CELL_W + PAD * 2),
  height: BAR + PAD + TERMINAL.rows * CELL_H + PAD,
};
const WIN_Y = Math.round((1080 - WIN.height) / 2);

/**
 * The camera: from `at`, it eases (over MOVE frames) to look at terminal row `row` with zoom `s`.
 * Gentle on purpose: the zoom never pushes the window into the captions' column.
 */
const SHOTS = [
  { at: 0, s: 1.0, row: 15 },
  { at: T.typeStart, s: 1.08, row: 10 },
  { at: T.thinking, s: 1.08, row: 14 },
  { at: T.queueSubmit, s: 1.06, row: 19 },
  { at: T.approval1, s: 1.07, row: 16 },
  { at: T.approval2, s: 1.07, row: 16 },
  { at: T.answer, s: 1.0, row: 15 },
] as const;
const MOVE = sec(0.9);

function camera(frame: number): { s: number; row: number } {
  let i = 0;
  while (i + 1 < SHOTS.length && frame >= SHOTS[i + 1]!.at) i += 1;
  const to = SHOTS[i]!;
  const from = SHOTS[Math.max(0, i - 1)]!;
  const k = i === 0 ? 1 : interpolate(frame, [to.at, to.at + MOVE], [0, 1], { extrapolateRight: "clamp", easing: Easing.bezier(0.65, 0, 0.35, 1) });
  return { s: from.s + (to.s - from.s) * k, row: from.row + (to.row - from.row) * k };
}

/** The window around the recording: a plain dark terminal, titled like one. */
const Terminal: React.FC<{ copy: Copy["demo"]; frame: number }> = ({ copy, frame }) => {
  const rows = TERMINAL.frames[recordingFrame(frame)]!;
  return (
    <div
      style={{
        position: "absolute",
        left: WIN.x,
        top: WIN_Y,
        width: WIN.width,
        height: WIN.height,
        background: TERM_BG,
        borderRadius: 14,
        border: `1px solid ${COLORS.windowEdge}`,
        boxShadow: "0 50px 140px rgba(0,0,0,0.6), 0 0 0 1px rgba(180,167,255,0.06), 0 0 120px rgba(180,167,255,0.07)",
        overflow: "hidden",
      }}
    >
      <div style={{ height: BAR, display: "flex", alignItems: "center", padding: "0 16px", borderBottom: "1px solid #1e2230", background: "#0b0d14" }}>
        {["#ff5f58", "#ffbd2e", "#28c840"].map((c) => (
          <div key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c, opacity: 0.8, marginRight: 8 }} />
        ))}
        <div style={{ flex: 1, textAlign: "center", fontFamily: FONTS.sans, fontSize: 15, color: COLORS.faint, marginRight: 60 }}>bruine · {copy.project}</div>
      </div>
      <div style={{ position: "relative", margin: PAD, marginTop: PAD / 2, fontFamily: FONTS.mono, fontSize: FONT, fontVariantLigatures: "none" }}>
        {rows.map((index, y) => (
          <TermRow key={y} spans={TERMINAL.rowTable[index]!} y={y} font={FONT} />
        ))}
      </div>
    </div>
  );
};

/** What the viewer is looking at, in a few words, in the column beside the terminal. */
const Captions: React.FC<{ copy: Copy["demo"]; frame: number }> = ({ copy, frame }) => {
  const active = CAPTION_AT.reduce((acc, at, i) => (frame >= at ? i : acc), -1);
  const left = WIN.x + WIN.width + 58;
  return (
    <div style={{ position: "absolute", left, top: 0, bottom: 0, width: 1920 - left - 56, display: "flex", flexDirection: "column", justifyContent: "center", gap: 30 }}>
      {copy.callouts.map((callout, i) => {
        const at = CAPTION_AT[i]!;
        const shown = ease(frame, at, 18);
        const current = i === active;
        const dim = current ? 1 : i < active ? 0.38 : 0;
        if (shown <= 0) return <div key={i} style={{ height: 0 }} />;
        return (
          <div key={i} style={{ opacity: Math.min(shown, 1) * dim, transform: `translateX(${(1 - shown) * 24}px)`, display: "flex", gap: 16 }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 17, color: COLORS.lavender, paddingTop: 9, width: 26 }}>{String(i + 1).padStart(2, "0")}</div>
            <div style={{ flex: 1 }}>
              <Words text={callout.title} at={at} stagger={3} style={{ fontSize: current ? 36 : 28, fontWeight: 650, letterSpacing: -0.5, color: COLORS.text, lineHeight: 1.15 }} />
              {current ? (
                <Words text={callout.body} at={at + 8} stagger={1} style={{ fontSize: 21, color: COLORS.muted, marginTop: 8, lineHeight: 1.4 }} />
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** The real bruine, recorded in a real terminal, start to finish: think, queue, ask, test, answer. */
export const Demo: React.FC<{ copy: Copy["demo"] }> = ({ copy }) => {
  const frame = useCurrentFrame();
  const cam = camera(frame);
  // Zoom about the window's centre column and the row the shot looks at.
  const originX = WIN.x + WIN.width / 2;
  const originY = WIN_Y + BAR + PAD / 2 + (cam.row + 0.5) * CELL_H;
  return (
    <Scene>
      <AbsoluteFill style={{ transform: `scale(${cam.s})`, transformOrigin: `${originX}px ${originY}px` }}>
        <Terminal copy={copy} frame={frame} />
      </AbsoluteFill>
      <Captions copy={copy} frame={frame} />
      <div style={{ position: "absolute", left: WIN.x + WIN.width - 230, bottom: 26 }}>
        <KeyCap label={`⏎ ${copy.enterKey}`} at={T.submit} hold={16} size={20} />
      </div>
      <div style={{ position: "absolute", left: WIN.x + WIN.width - 230, bottom: 26 }}>
        <KeyCap label={`⏎ ${copy.enterKey}`} at={T.queueSubmit} hold={16} size={20} />
      </div>
      <div style={{ position: "absolute", left: WIN.x + WIN.width - 230, bottom: 26 }}>
        <KeyCap label={`⏎ ${copy.enterKey}`} at={T.approve1} hold={16} size={20} />
      </div>
      <div style={{ position: "absolute", left: WIN.x + WIN.width - 230, bottom: 26 }}>
        <KeyCap label={`⏎ ${copy.enterKey}`} at={T.approve2} hold={16} size={20} />
      </div>
    </Scene>
  );
};
