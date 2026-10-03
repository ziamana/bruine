import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { COLORS, FONTS, VIDEO, type Copy } from "../config";
import { Scene } from "../components/Scene";
import { GlowGradient } from "../components/Glow";
import { ease, hash01, sec, typed } from "../lib/motion";

const FONT = 20;
const ROW = 29;
const CELL = 12.05; // one monospace cell at 20px
const WIN = { x: 76, y: 92, width: 1230, height: 900 };
const PAD_X = 22;

/** The script of the session, in frames from the scene's start. */
const T = {
  typeStart: sec(0.45),
  submit: sec(1.75),
  thinking: sec(1.9),
  reasonStart: sec(2.05),
  collapse: sec(4.7),
  readPending: sec(5.0),
  readDone: sec(5.35),
  editPending: sec(5.65),
  editDone: sec(5.95),
  diffStart: sec(6.0),
  bashPending: sec(7.0),
  approval: sec(7.15),
  approve: sec(8.55),
  bashDone: sec(9.6),
  answerStart: sec(9.85),
} as const;

const CALLOUT_AT = [T.thinking, T.readPending, T.editPending + 6, T.bashPending + 4, T.answerStart] as const;

const DOTS = ["⠁", "⠂", "⠄", "⡀"] as const;
/** Three cells of rain for a waiting label (src/ui/rain.ts dropSpinner), from frames. */
function dropSpinner(frame: number): string {
  const step = Math.floor((frame / VIDEO.fps) * 1000 / 120);
  let out = "";
  for (let cell = 0; cell < 3; cell += 1) {
    const at = (step + cell * 3) % 7;
    out += at < 4 ? DOTS[at] : "⠀";
  }
  return out;
}

const Row: React.FC<{ children?: React.ReactNode; bg?: string; style?: React.CSSProperties; rail?: string }> = ({ children, bg, style, rail }) => (
  <div
    style={{
      height: ROW,
      lineHeight: `${ROW}px`,
      whiteSpace: "pre",
      background: bg,
      position: "relative",
      paddingLeft: rail === undefined ? 0 : 0,
      ...style,
    }}
  >
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
    <span style={{ position: "absolute", left: 3, top: 4, width: 8, height: 11, borderLeft: `2px solid ${COLORS.faint}`, borderBottom: `2px solid ${COLORS.faint}` }} />
  </span>
);

type ToolState = "pending" | "ok";
const ToolRow: React.FC<{ state: ToolState; verb: string; target: string; tail: React.ReactNode; frame: number }> = ({ state, verb, target, tail, frame }) => (
  <Row bg={state === "ok" ? COLORS.toolOk : "#252830"} rail={state === "ok" ? COLORS.mint : "#afe3ff"} style={{ marginLeft: CELL * 2 - 6, paddingLeft: 6 + CELL }}>
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

const Terminal: React.FC<{ copy: Copy["demo"]; frame: number }> = ({ copy, frame }) => {
  const promptTyped = frame < T.submit ? typed(copy.prompt, frame, T.typeStart, 48) : "";
  const submitted = frame >= T.submit;
  const reasoningChars = Math.floor(((frame - T.reasonStart) / VIDEO.fps) * 68);
  const collapsed = frame >= T.collapse;
  const rows: React.ReactNode[] = [];
  const blank = (key: string): void => {
    rows.push(<Row key={key} />);
  };
  blank("b0");
  if (submitted) {
    rows.push(
      <Row key="user" bg="#152a36" style={{ paddingLeft: CELL * 2 }}>
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
        left -= line.length;
        rows.push(
          <Row key={`r${i}`} style={{ paddingLeft: CELL * 4 }}>
            <C c={COLORS.muted} i>
              {shown}
            </C>
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
      />,
    );
  }
  if (frame >= T.editPending) {
    const plus = copy.edit.stat.split(" ");
    rows.push(
      <ToolRow
        key="edit"
        state={frame >= T.editDone ? "ok" : "pending"}
        verb={copy.edit.verb}
        target={copy.edit.target}
        tail={
          <>
            <C c={COLORS.mint}>{plus[0]}</C> <C c={COLORS.rose}>{plus[1]}</C>
          </>
        }
        frame={frame}
      />,
    );
    copy.diff.forEach((line, i) => {
      const at = T.diffStart + i * 5;
      if (frame < at) return;
      const add = line.kind === "add";
      const del = line.kind === "del";
      rows.push(
        <Row key={`d${i}`} style={{ paddingLeft: CELL * 4, opacity: ease(frame, at, 6) }}>
          {i === 0 ? <Branch /> : <span style={{ display: "inline-block", width: CELL * 2 }} />}
          <span
            style={{
              display: "inline-block",
              width: WIN.width - 2 - PAD_X * 2 - CELL * 6,
              background: add ? COLORS.addBg : del ? COLORS.delBg : "transparent",
              color: add ? COLORS.addFg : del ? COLORS.delFg : COLORS.muted,
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
      <ToolRow
        key="bash"
        state={done ? "ok" : "pending"}
        verb={copy.bash.verb}
        target={copy.bash.target}
        tail={<C c={COLORS.faint}>{copy.bash.time}</C>}
        frame={frame}
      />,
    );
    if (done) {
      rows.push(
        <Row key="bash-out" style={{ paddingLeft: CELL * 4 }}>
          <Branch />
          <C c={COLORS.mint}>{copy.bash.output}</C>
        </Row>,
      );
    }
    blank("b3");
  }
  if (frame >= T.answerStart) {
    let left = Math.floor(((frame - T.answerStart) / VIDEO.fps) * 80);
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
  const approvalOn = frame >= T.approval && frame < T.approve + 8;
  const pressed = frame >= T.approve;
  const footerGlow = ease(frame, CALLOUT_AT[4], 12);

  return (
    <div
      style={{
        position: "absolute",
        left: WIN.x,
        top: WIN.y,
        width: WIN.width,
        height: WIN.height,
        background: COLORS.window,
        borderRadius: 16,
        border: `1px solid ${COLORS.windowEdge}`,
        boxShadow: "0 40px 120px rgba(0,0,0,0.55), 0 0 0 1px rgba(180,167,255,0.05)",
        overflow: "hidden",
        fontFamily: FONTS.mono,
        fontSize: FONT,
        color: COLORS.text,
      }}
    >
      <div style={{ height: 44, display: "flex", alignItems: "center", padding: "0 18px", borderBottom: `1px solid ${COLORS.windowEdge}`, background: "#0e1119" }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ width: 13, height: 13, borderRadius: 7, background: COLORS.chip, marginRight: 9 }} />
        ))}
        <div style={{ flex: 1, textAlign: "center", fontFamily: FONTS.sans, fontSize: 17, color: COLORS.faint, marginRight: 66 }}>
          bruine · {copy.project}
        </div>
      </div>
      <div style={{ padding: `14px ${PAD_X}px` }}>
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
            boxShadow: `0 0 0 ${2 * footerGlow}px rgba(180,167,255,${0.55 * footerGlow}), 0 0 ${24 * footerGlow}px rgba(180,167,255,${0.25 * footerGlow})`,
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
          <div style={{ marginTop: ROW, marginLeft: CELL * 4, opacity: frame >= T.approve ? 1 - ease(frame, T.approve + 2, 6) : ease(frame, T.approval, 6) }}>
            <Row>
              <C c={COLORS.amber}>?</C> <C c={COLORS.text} b>{copy.approval.question}</C>
            </Row>
            {copy.approval.options.map((option, i) => (
              <Row key={option} bg={i === 0 && pressed ? "rgba(125,207,255,0.16)" : undefined} style={{ marginLeft: -CELL * 2 }}>
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

const Callouts: React.FC<{ copy: Copy["demo"]; frame: number }> = ({ copy, frame }) => {
  const active = CALLOUT_AT.reduce((acc, at, i) => (frame >= at ? i : acc), -1);
  return (
    <div style={{ position: "absolute", left: 1360, top: WIN.y + 40, width: 456, display: "flex", flexDirection: "column", gap: 34 }}>
      {copy.callouts.map((callout, i) => {
        const shown = ease(frame, CALLOUT_AT[i]!, 16);
        const dim = i < active ? 1 - 0.55 * ease(frame, CALLOUT_AT[i + 1]!, 14) : 1;
        return (
          <div key={callout.title} style={{ opacity: shown * dim, transform: `translateX(${(1 - shown) * 18}px)`, display: "flex", gap: 20 }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 20, color: COLORS.lavender, paddingTop: 7, width: 30 }}>{String(i + 1).padStart(2, "0")}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 31, fontWeight: 600, color: COLORS.text, lineHeight: 1.2 }}>{callout.title}</div>
              <div style={{ fontSize: 22, color: COLORS.muted, lineHeight: 1.4, marginTop: 6 }}>{callout.body}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** A real session, start to finish: think, read, edit, ask, test, answer. */
export const Demo: React.FC<{ copy: Copy["demo"] }> = ({ copy }) => {
  const frame = useCurrentFrame();
  const push = interpolate(frame, [0, sec(12.6)], [1, 1.025]);
  return (
    <Scene>
      <AbsoluteFill style={{ transform: `scale(${push})`, transformOrigin: "35% 50%" }}>
        <Terminal copy={copy} frame={frame} />
      </AbsoluteFill>
      <Callouts copy={copy} frame={frame} />
    </Scene>
  );
};
