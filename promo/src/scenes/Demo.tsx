import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { COLORS, FONTS, VIDEO, type Copy } from "../config";
import { KeyCap, Scene, Words } from "../components/Scene";
import { GlowGradient } from "../components/Glow";
import { ease, hash01, sec, typed } from "../lib/motion";
import { CAPTION_AT, DEMO as T } from "../timeline.ts";

const FONT = 21;
const ROW = 31;
const CELL = FONT * 0.602; // one monospace cell
const WIN = { x: 210, y: 64, width: 1500, height: 952 };
const PAD_X = 26;
const BAR = 44;
const TOP_PAD = 14;

/** The centre of a terminal row on the unzoomed frame, for the camera to aim at. */
const rowY = (row: number): number => WIN.y + BAR + TOP_PAD + row * ROW + ROW / 2;

/**
 * The camera's shots: from `at`, it moves (over MOVE frames) to look at (fx, fy) with zoom `s`,
 * and puts that point at (tx, ty) on screen, above the captions. The zoom stays under 1.26 so the
 * window's whole width is always in frame: the camera moves along the session, it never cuts a
 * line.
 */
const SHOTS = [
  { at: 0, s: 1, fx: 960, fy: 540, tx: 960, ty: 540 },
  { at: T.typeStart - sec(0.35), s: 1.25, fx: 960, fy: rowY(4), tx: 960, ty: 430 },
  { at: T.thinking, s: 1.25, fx: 960, fy: rowY(6.5), tx: 960, ty: 400 },
  { at: T.readPending, s: 1.18, fx: 960, fy: rowY(10.5), tx: 960, ty: 410 },
  { at: T.approval - 4, s: 1.22, fx: 960, fy: rowY(19.5), tx: 960, ty: 400 },
  { at: T.bashDone, s: 1.2, fx: 960, fy: rowY(17.5), tx: 960, ty: 400 },
  { at: T.answerStart + sec(1.4), s: 1.12, fx: 960, fy: rowY(19.5), tx: 960, ty: 430 },
  { at: sec(12.3), s: 1.02, fx: 960, fy: 540, tx: 960, ty: 520 },
] as const;
const MOVE = sec(0.8);

function camera(frame: number): { s: number; x: number; y: number } {
  let i = 0;
  while (i + 1 < SHOTS.length && frame >= SHOTS[i + 1]!.at) i += 1;
  const to = SHOTS[i]!;
  const from = SHOTS[Math.max(0, i - 1)]!;
  const k = i === 0 ? 1 : interpolate(frame, [to.at, to.at + MOVE], [0, 1], { extrapolateRight: "clamp", easing: Easing.bezier(0.65, 0, 0.35, 1) });
  const lerp = (a: number, b: number): number => a + (b - a) * k;
  // Interpolate zoom geometrically, so the move feels even at every scale.
  const s = Math.exp(lerp(Math.log(from.s), Math.log(to.s)));
  const fx = lerp(from.fx, to.fx);
  const fy = lerp(from.fy, to.fy);
  const tx = lerp(from.tx, to.tx);
  const ty = lerp(from.ty, to.ty);
  return { s, x: tx - fx * s, y: ty - fy * s };
}

const DOTS = ["⠁", "⠂", "⠄", "⡀"] as const;
/** Three cells of rain for a waiting label (src/ui/rain.ts dropSpinner), from frames. */
function dropSpinner(frame: number): string {
  const step = Math.floor(((frame / VIDEO.fps) * 1000) / 120);
  let out = "";
  for (let cell = 0; cell < 3; cell += 1) {
    const at = (step + cell * 3) % 7;
    out += at < 4 ? DOTS[at] : "⠀";
  }
  return out;
}

const Row: React.FC<{ children?: React.ReactNode; bg?: string; style?: React.CSSProperties; rail?: string }> = ({ children, bg, style, rail }) => (
  <div style={{ height: ROW, lineHeight: `${ROW}px`, whiteSpace: "pre", background: bg, position: "relative", ...style }}>
    {rail === undefined ? null : <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: rail }} />}
    {children}
  </div>
);

const C: React.FC<{ c: string; children: React.ReactNode; b?: boolean; i?: boolean }> = ({ c, children, b, i }) => (
  <span style={{ color: c, fontWeight: b ? 700 : 400, fontStyle: i ? "italic" : "normal" }}>{children}</span>
);

/** The `⎿` branch a tool's output hangs from, drawn so it does not depend on the font. */
const Branch: React.FC = () => (
  <span style={{ display: "inline-block", width: CELL * 2, height: ROW, position: "relative", verticalAlign: "top" }}>
    <span style={{ position: "absolute", left: 3, top: 5, width: 8, height: 12, borderLeft: `2px solid ${COLORS.faint}`, borderBottom: `2px solid ${COLORS.faint}` }} />
  </span>
);

type ToolState = "pending" | "ok";
const ToolRow: React.FC<{ state: ToolState; verb: string; target: string; tail: React.ReactNode; frame: number; doneAt: number }> = ({ state, verb, target, tail, frame, doneAt }) => {
  const flash = state === "ok" ? Math.max(0, 1 - (frame - doneAt) / 14) : 0;
  return (
    <Row
      bg={state === "ok" ? COLORS.toolOk : "#252830"}
      rail={state === "ok" ? COLORS.mint : "#afe3ff"}
      style={{ marginLeft: CELL * 2 - 6, paddingLeft: 6 + CELL, boxShadow: flash > 0 ? `inset 0 0 0 999px rgba(143,227,163,${0.16 * flash})` : undefined }}
    >
      {state === "ok" ? <C c={COLORS.mint}>✓</C> : <C c={COLORS.sky}>·</C>}
      {"  "}
      <C c={COLORS.text} b>
        {verb}
      </C>
      {"  "}
      <C c={COLORS.sky}>{target}</C>
      {"  "}
      {state === "ok" ? tail : <C c={COLORS.lavender}>{dropSpinner(frame)}</C>}
    </Row>
  );
};

const Terminal: React.FC<{ copy: Copy["demo"]; frame: number }> = ({ copy, frame }) => {
  const promptTyped = frame < T.submit ? typed(copy.prompt, frame, T.typeStart, T.typeCps) : "";
  const submitted = frame >= T.submit;
  const reasoningChars = Math.floor(((frame - T.reasonStart) / VIDEO.fps) * T.reasonCps);
  const collapsed = frame >= T.collapse;
  const rows: React.ReactNode[] = [];
  const blank = (key: string): void => {
    rows.push(<Row key={key} />);
  };
  blank("b0");
  if (submitted) {
    const k = ease(frame, T.submit, 8);
    rows.push(
      <Row key="user" bg="#152a36" style={{ paddingLeft: CELL * 2, opacity: k }}>
        <C c={COLORS.sky}>›</C> <C c={COLORS.text}>{copy.prompt}</C>
      </Row>,
    );
    blank("b1");
  }
  if (frame >= T.thinking) {
    if (!collapsed) {
      rows.push(
        <Row key="think" style={{ paddingLeft: CELL * 2 }}>
          <C c={COLORS.lavender}>∴</C> <C c={COLORS.lavender}>{copy.thinking}</C> <C c={COLORS.lavender}>{dropSpinner(frame)}</C>
        </Row>,
      );
      let left = reasoningChars;
      copy.reasoning.forEach((line, i) => {
        const shown = line.slice(0, Math.max(0, left));
        const writing = left >= 0 && left < line.length;
        left -= line.length;
        rows.push(
          <Row key={`r${i}`} style={{ paddingLeft: CELL * 4 }}>
            <C c={COLORS.muted} i>
              {shown}
            </C>
            {writing ? <span style={{ color: COLORS.lavender }}>▍</span> : null}
          </Row>,
        );
      });
    } else {
      rows.push(
        <Row key="thought" style={{ paddingLeft: CELL * 2, opacity: interpolate(frame, [T.collapse, T.collapse + 8], [0.3, 1], { extrapolateRight: "clamp" }) }}>
          <C c={COLORS.faint}>∴</C> <C c={COLORS.muted}>{copy.thought}</C>
        </Row>,
      );
    }
    blank("b2");
  }
  if (frame >= T.readPending) {
    rows.push(
      <ToolRow
        key="read"
        state={frame >= T.readDone ? "ok" : "pending"}
        verb={copy.read.verb}
        target={copy.read.target}
        tail={<C c={COLORS.faint}>{copy.read.time}</C>}
        frame={frame}
        doneAt={T.readDone}
      />,
    );
  }
  if (frame >= T.editPending) {
    const stat = copy.edit.stat.split(" ");
    rows.push(
      <ToolRow
        key="edit"
        state={frame >= T.editDone ? "ok" : "pending"}
        verb={copy.edit.verb}
        target={copy.edit.target}
        tail={
          <>
            <C c={COLORS.mint}>{stat[0]}</C> <C c={COLORS.rose}>{stat[1]}</C>
          </>
        }
        frame={frame}
        doneAt={T.editDone}
      />,
    );
    copy.diff.forEach((line, i) => {
      const at = T.diffStart + i * T.diffStep;
      if (frame < at) return;
      const add = line.kind === "add";
      const del = line.kind === "del";
      const k = ease(frame, at, 7);
      rows.push(
        <Row key={`d${i}`} style={{ paddingLeft: CELL * 4 }}>
          {i === 0 ? <Branch /> : <span style={{ display: "inline-block", width: CELL * 2 }} />}
          <span
            style={{
              display: "inline-block",
              width: WIN.width - 2 - PAD_X * 2 - CELL * 6,
              background: add ? COLORS.addBg : del ? COLORS.delBg : "transparent",
              color: add ? COLORS.addFg : del ? COLORS.delFg : COLORS.muted,
              clipPath: `inset(0 ${(1 - k) * 100}% 0 0)`,
            }}
          >
            {add ? " + " : del ? " - " : "   "}
            {line.text}
          </span>
        </Row>,
      );
    });
  }
  if (frame >= T.bashPending) {
    const done = frame >= T.bashDone;
    rows.push(
      <ToolRow key="bash" state={done ? "ok" : "pending"} verb={copy.bash.verb} target={copy.bash.target} tail={<C c={COLORS.faint}>{copy.bash.time}</C>} frame={frame} doneAt={T.bashDone} />,
    );
    if (done) {
      rows.push(
        <Row key="bash-out" style={{ paddingLeft: CELL * 4, opacity: ease(frame, T.bashDone, 8) }}>
          <Branch />
          <C c={COLORS.mint}>{copy.bash.output}</C>
        </Row>,
      );
    }
    blank("b3");
  }
  if (frame >= T.answerStart) {
    let left = Math.floor(((frame - T.answerStart) / VIDEO.fps) * T.answerCps);
    copy.answer.forEach((line, i) => {
      const shown = line.slice(0, Math.max(0, left));
      left -= line.length;
      rows.push(
        <Row key={`a${i}`} style={{ paddingLeft: CELL * 2 }}>
          <C c={COLORS.text}>{shown}</C>
        </Row>,
      );
    });
    blank("b4");
  }

  // The live speed: measured while the model writes, held once it stops.
  const writing = (frame >= T.reasonStart && frame < T.collapse) || (frame >= T.answerStart && frame < T.answerStart + sec(1.4));
  const tps = frame < T.reasonStart ? "  -  " : writing ? (57 + hash01(Math.floor(frame / 6), 3) * 3.4).toFixed(1) : "58.6";
  const ruleWidth = WIN.width - PAD_X * 2;
  const approvalOn = frame >= T.approval && frame < T.approve + 10;
  const pressed = frame >= T.approve;
  const footerGlow = ease(frame, CAPTION_AT[4], 12);
  const approvalIn = ease(frame, T.approval, 10, Easing.out(Easing.back(1.4)));

  return (
    <div
      style={{
        position: "absolute",
        left: WIN.x,
        top: WIN.y,
        width: WIN.width,
        height: WIN.height,
        background: COLORS.window,
        borderRadius: 18,
        border: `1px solid ${COLORS.windowEdge}`,
        boxShadow: "0 50px 140px rgba(0,0,0,0.6), 0 0 0 1px rgba(180,167,255,0.06), 0 0 120px rgba(180,167,255,0.06)",
        overflow: "hidden",
        fontFamily: FONTS.mono,
        fontSize: FONT,
        color: COLORS.text,
      }}
    >
      <div style={{ height: BAR, display: "flex", alignItems: "center", padding: "0 18px", borderBottom: `1px solid ${COLORS.windowEdge}`, background: "#0e1119" }}>
        {["#ff7a90", "#f2cf73", "#8fe3a3"].map((c) => (
          <div key={c} style={{ width: 13, height: 13, borderRadius: 7, background: c, opacity: 0.55, marginRight: 9 }} />
        ))}
        <div style={{ flex: 1, textAlign: "center", fontFamily: FONTS.sans, fontSize: 17, color: COLORS.faint, marginRight: 66 }}>bruine · {copy.project}</div>
      </div>
      <div style={{ padding: `${TOP_PAD}px ${PAD_X}px` }}>
        <Row>
          {" "}
          <C c={COLORS.lavender} b>
            bruine
          </C>{" "}
          <C c={COLORS.faint}>v0.0.1</C>
        </Row>
        <Row>
          {" "}
          <C c={COLORS.muted}>{copy.hints}</C>
        </Row>
        {rows}
        <svg width={ruleWidth} height={ROW} style={{ display: "block" }}>
          <defs>
            <GlowGradient id="rule" mode="slow" width={ruleWidth} cellWidth={CELL} frame={frame} />
          </defs>
          <rect x={0} y={ROW / 2 - 1} width={ruleWidth} height={2} fill="url(#rule)" />
        </svg>
        <Row>
          <C c={COLORS.sky}> › </C>
          <C c={COLORS.text}>{promptTyped}</C>
          <span
            style={{
              display: "inline-block",
              width: CELL,
              height: ROW - 8,
              verticalAlign: "middle",
              background: COLORS.text,
              opacity: Math.floor(frame / 24) % 2 === 0 || (frame > T.typeStart && frame < T.submit) ? 0.85 : 0,
            }}
          />
        </Row>
        <svg width={ruleWidth} height={ROW} style={{ display: "block" }}>
          <rect x={0} y={ROW / 2 - 1} width={ruleWidth} height={2} fill="url(#rule)" />
        </svg>
        <Row
          style={{
            display: "flex",
            justifyContent: "space-between",
            margin: "0 -10px",
            padding: "0 10px",
            borderRadius: 6,
            boxShadow: `0 0 0 ${2 * footerGlow}px rgba(180,167,255,${0.6 * footerGlow}), 0 0 ${28 * footerGlow}px rgba(180,167,255,${0.3 * footerGlow})`,
          }}
        >
          <span>
            <C c={COLORS.text}>{copy.footerLeft.slice(0, 3)}</C>
            <C c={COLORS.muted}>{copy.footerLeft.slice(3)}</C>
          </span>
          <span>
            <C c={COLORS.mint}>{tps}</C> <C c={COLORS.muted}>{copy.footerRight}</C>
          </span>
        </Row>
        {approvalOn ? (
          <div
            style={{
              marginTop: ROW,
              marginLeft: CELL * 2,
              width: 560,
              padding: "6px 0 6px 14px",
              borderRadius: 10,
              border: `1.5px solid rgba(242,207,115,${0.5 * approvalIn})`,
              boxShadow: `0 0 40px rgba(242,207,115,${0.12 * approvalIn})`,
              opacity: pressed ? 1 - ease(frame, T.approve + 3, 7) : Math.min(1, approvalIn),
              transform: `scale(${0.96 + 0.04 * approvalIn})`,
              transformOrigin: "left top",
            }}
          >
            <Row>
              <C c={COLORS.amber}>?</C>{" "}
              <C c={COLORS.text} b>
                {copy.approval.question}
              </C>
            </Row>
            {copy.approval.options.map((option, i) => (
              <Row key={option} bg={i === 0 && pressed ? "rgba(125,207,255,0.2)" : undefined}>
                {i === 0 ? <C c={COLORS.sky}>→ </C> : "  "}
                {i === 0 ? (
                  <C c={COLORS.text} b>
                    {option}
                  </C>
                ) : (
                  <C c={COLORS.muted}>{option}</C>
                )}
              </Row>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
};

/** The caption under the shot: what the viewer is looking at, in a few words. */
const Caption: React.FC<{ copy: Copy["demo"]; frame: number }> = ({ copy, frame }) => {
  const active = CAPTION_AT.reduce((acc, at, i) => (frame >= at ? i : acc), -1);
  if (active < 0) return null;
  const callout = copy.callouts[active]!;
  const at = CAPTION_AT[active]!;
  const next = CAPTION_AT[active + 1];
  const out = next === undefined ? 0 : ease(frame, next - 8, 8);
  const bar = ease(frame, at, 14);
  return (
    <div style={{ position: "absolute", left: 120, bottom: 86, width: 1100, opacity: 1 - out, filter: out > 0 ? `blur(${out * 8}px)` : undefined }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 14 }}>
        <span style={{ fontFamily: FONTS.mono, fontSize: 20, color: COLORS.lavender, letterSpacing: 2 }}>
          {String(active + 1).padStart(2, "0")} / {String(copy.callouts.length).padStart(2, "0")}
        </span>
        <span style={{ height: 2, width: 120 * bar, background: `linear-gradient(90deg, ${COLORS.lavender}, transparent)` }} />
      </div>
      <Words key={`t${active}`} text={callout.title} at={at} stagger={3} style={{ fontSize: 58, fontWeight: 650, letterSpacing: -1, color: COLORS.text, textShadow: "0 4px 30px rgba(0,0,0,0.8)" }} />
      <Words key={`b${active}`} text={callout.body} at={at + 8} stagger={1} style={{ fontSize: 28, color: COLORS.muted, marginTop: 10, textShadow: "0 2px 16px rgba(0,0,0,0.9)" }} />
    </div>
  );
};

/** A real session, start to finish, filmed: think, read, edit, ask, test, answer. */
export const Demo: React.FC<{ copy: Copy["demo"] }> = ({ copy }) => {
  const frame = useCurrentFrame();
  const cam = camera(frame);
  return (
    <Scene>
      <AbsoluteFill style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.s})`, transformOrigin: "0 0" }}>
        <Terminal copy={copy} frame={frame} />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "linear-gradient(to top, rgba(11,13,20,0.96) 0%, rgba(11,13,20,0.82) 20%, rgba(11,13,20,0) 42%)" }} />
      <Caption copy={copy} frame={frame} />
      <div style={{ position: "absolute", right: 130, bottom: 110 }}>
        <KeyCap label={`⏎ ${copy.enterKey}`} at={T.submit} />
      </div>
      <div style={{ position: "absolute", right: 130, bottom: 110 }}>
        <KeyCap label={`⏎ ${copy.enterKey}`} at={T.approve} />
      </div>
    </Scene>
  );
};
