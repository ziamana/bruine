import {
  Container,
  Editor,
  sliceByColumn,
  truncateToWidth,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";
import stringWidth from "string-width";
import { kumoIcons, withoutEmoji, type KumoIcons } from "../render/chars.js";
import { blendHex, bgEnabled, boxLine, colorDepth, fillLine, paintHex, NUAGE, type PaletteRole } from "./palette.js";
import { reasoningStyle } from "../render/reasoning.js";
import { ansi } from "./theme.js";

/** Columns of empty space kept on each side of a bottom-area component. */
const MARGIN = 2;

/** Collapse thresholds matching pi-tui Editor (T27.5): >10 lines or >1000 chars. */
export function pasteChip(text: string): string | undefined {
  const lines = text.split("\n").length;
  if (lines > 10) return ansi.chip(`[Pasted ${String(lines)} lines]`);
  if (text.length > 1000) return ansi.chip(`[Pasted ${String(text.length)} chars]`);
  return undefined;
}

/** Render pi-tui paste markers as chips: `[paste #1 +22 lines]` → `[Pasted 22 lines]`. */
export function chipMarkers(line: string): string {
  return line
    .replace(/\[paste #\d+ \+(\d+) lines\]/g, (_, n) => ansi.chip(`[Pasted ${String(n)} lines]`))
    .replace(/\[paste #\d+ (\d+) chars\]/g, (_, n) => ansi.chip(`[Pasted ${String(n)} chars]`));
}

/** The rail's top and bottom colors, so a tool call fades down its own height. */
const RAIL_FADE = {
  blue: [NUAGE.sky.hex, NUAGE.skyDeep.hex],
  red: [NUAGE.rose.hex, NUAGE.railErrorEnd.hex],
  // T55 P1c: the live rail is the brightest mark in the transcript. A tool in
  // flight and a tool that finished ten seconds ago used to be the same blue, so
  // "where is kumo right now" meant reading every block.
  active: [NUAGE.railActive.hex, NUAGE.railActiveEnd.hex],
} as const;

/** What the left rail is saying: live, settled, or failed. */
export type RailState = keyof typeof RAIL_FADE;

/**
 * The tool rail, shaded from `sky` to `skyDeep` down the block so a run of tool
 * calls reads as one gradient rather than a stack of identical bars. 16-color
 * terminals keep the flat blue/red, where a blended hex would collapse to a
 * single code.
 */
export function railPaint(rail: RailState, char: string, t: number): string {
  const d = colorDepth();
  if (d !== "truecolor" && d !== "256") {
    if (rail === "active") return ansi.cyan(char);
    return rail === "red" ? ansi.red(char) : ansi.blue(char);
  }
  const [from, to] = RAIL_FADE[rail];
  return paintHex(blendHex(from, to, t), char);
}

/** Own block spacing/padding once, without changing the model's transcript. */
export class ChatTranscript extends Container {
  constructor(private icons: KumoIcons = kumoIcons()) {
    super();
  }
  render(width: number): string[] {
    const inner = Math.max(1, width - 4);
    const lines: string[] = [];
    // A thicker rail (Aron, 2026-09-26: "la barre bleue est trop fine").
    const railChar = this.icons.think === "*" ? "|" : "▍";
    // Tool calls (bash, write, read…) sit on the same gray as the prompt band and the
    // console band (Aron, 2026-09-26). Each call is its own card, separated from the
    // next, and the gray starts at the rail: the 2-column page margins stay unpainted
    // on both sides.
    const cardCells = Math.max(1, width - 4);
    const card = (role: PaletteRole, text: string): string => `  ${boxLine(role, text, cardCells)}`;
    for (const child of this.children) {
      const rail = (child as { rail?: RailState }).rail;
      // Same 2-column margin on both sides: railed blocks lose 2 more cells to "▍ "
      // and 2 more to the right margin, so a line that ends in a measurement
      // (the duration, the diff counter) has 2 cells of gray after it instead of
      // finishing on the card border.
      const role = rail === "active" ? "toolPending" : rail === "red" ? "toolErr" : "toolOk";
      const showRail = !bgEnabled();
      const block = child.render(rail === undefined ? inner : Math.max(1, width - 8));
      if (!block.length) continue;
      lines.push("");
      // The rail runs the full height of the card, padding lines included (Aron: "la
      // barre bleue ne va pas jusqu'au bout"); its gradient spans all of them.
      const railSpan = block.length + 1;
      if (rail !== undefined) lines.push(card(role, showRail ? railPaint(rail, railChar, 0) : ""));
      if ((child as { surface?: boolean }).surface === true) {
        // User prompt: a full-width tinted band (Nuage), one line of padding each
        // side, opening on the same 1-column accent as the console band.
        const band = (text: string): string => {
          const painted = bgEnabled();
          const inner = width - 1;
          // Only clip a line that genuinely overflows. truncateToWidth reserves
          // three cells for its ellipsis as soon as the text carries ANSI, so a
          // full-width line that already fits would come back with its last
          // three characters replaced by "...".
          const cut = visibleWidth(text) > inner ? truncateToWidth(text, inner) : text;
          const body = painted ? cut + " ".repeat(Math.max(0, inner - visibleWidth(cut))) : cut;
          return fillLine("userBlock", (painted ? " " : railPaint("blue", railChar, 0)) + body);
        };
        // T55 P1b: the turn number rides the band's own top line, right-aligned.
        // It costs no extra row (that line was already a blank pad), and it lands
        // exactly where the eye already goes to find out which turn it is on.
        const turn = (child as { turn?: number }).turn;
        const label = turn === undefined ? "" : ansi.gray(`turn ${String(turn)}`);
        const inner = width - 1;
        // Right-aligned inside the 2-column margin the page keeps everywhere else,
        // so the number is not glued to the last column of the terminal.
        const top = label === "" ? "" : " ".repeat(Math.max(1, inner - MARGIN - visibleWidth(label))) + label;
        lines.push(band(top));
        // The accent spends the first of the band's two leading columns, so the
        // prompt still starts in column 2.
        for (const line of block) lines.push(band(` ${withoutEmoji(line)}`));
        lines.push(band(""));
        continue;
      }
      const last = block.length - 1;
      for (const [i, line] of block.entries()) {
        const clean = (child as Component & { transcriptStyle?: string }).transcriptStyle === "reasoning" ? reasoningStyle(withoutEmoji(line)) : withoutEmoji(line);
        if (rail === undefined) {
          lines.push(truncateToWidth(`  ${clean}`, width - 2));
        } else {
          const colored = railPaint(rail, railChar, (i + 1) / railSpan);
          const body = `${showRail ? colored : " "} ${clean}`;
          lines.push(card(role, visibleWidth(body) > cardCells ? truncateToWidth(body, cardCells) : body));
        }
      }
      if (rail !== undefined) lines.push(card(role, showRail ? railPaint(rail, railChar, 1) : ""));
    }
    return lines;
  }
}

/**
 * Keep user content intact internally while applying the same display policy.
 *
 * The suggestion is drawn INSIDE the input line, in italics, right after the
 * cursor, the way fish draws an autosuggestion. It used to replace the whole
 * editor with one dim line, which threw away the input box and ignored the
 * width, so a long suggestion spilled over the line below it.
 */
export class PlainGlyphEditor extends Editor {
  #ghost = "";
  setGhost(text: string): void {
    this.#ghost = text;
  }
  clearGhost(): void {
    this.#ghost = "";
  }
  get ghost(): string {
    return this.#ghost;
  }
  render(width: number): string[] {
    const lines = super.render(width).map((line) => chipMarkers(withoutEmoji(line)));
    if (this.#ghost === "" || this.getText().trim() !== "") return lines;
    return this.#withGhost(lines, width);
  }
  /** Splice the suggestion after the cursor, clipped to the room that is left. */
  #withGhost(lines: string[], width: number): string[] {
    const { line, col } = this.getCursor();
    // Row 0 is the editor's top border, so the text rows start at 1.
    const row = line + 1;
    const target = lines[row];
    if (target === undefined) return lines;
    const before = stringWidth(this.getText().split("\n")[line]?.slice(0, col) ?? "");
    // + 1 for the cursor cell the editor paints itself.
    const at = before + 1;
    const room = width - at;
    if (room <= 1) return lines;
    const head = sliceByColumn(target, 0, at);
    const shown = truncateToWidth(ansi.italic(this.#ghost), room, "");
    const out = [...lines];
    // Plain spaces, not the editor's own tail: slicing it would re-open the
    // cursor's inverse attribute and leave a highlighted block after the text.
    // The slice ends right after the cursor cell, whose inverse video ("\x1b[7m") is closed
    // later in the editor's own tail, which we drop: close it here, or the suggestion and
    // everything after it on the line (the cockpit too) turns white.
    out[row] = head + "\x1b[27m" + shown + " ".repeat(Math.max(0, width - at - visibleWidth(shown)));
    return out;
  }
}

/** Same left and right margin (2 columns) around any bottom-area component. */
export class Margin extends Container {
  constructor(private inner: Component, private cols = 2) {
    super();
  }
  override render(width: number): string[] {
    const w = Math.max(1, width - this.cols * 2);
    const pad = " ".repeat(this.cols);
    return this.inner.render(w).map((l) => `${pad}${l}`);
  }
  override invalidate(): void {
    this.inner.invalidate();
  }
}

/**
 * The console band: the whole interactive bottom zone (editor, cockpit, footer)
 * on one painted surface, edge to edge, opening on a 1-column sky accent that
 * echoes the tool rail above it.
 *
 * Painting only this zone, and never the transcript, is what makes a background
 * safe here. kumo renders on the main screen, so the scrollback belongs to the
 * terminal and keeps its own background: a band that starts where the app
 * starts and ends at the bottom of the live area can never show a seam, while a
 * full-bleed fill would leave a hard horizontal line the moment you scroll up.
 *
 * The content keeps the 2-column margin it had under `Margin` (the accent takes
 * the first of those two columns, so nothing reflows); only the surface runs to
 * the right edge.
 */
export class ConsoleBand extends Container {
  constructor(private zones: Component[]) {
    super();
  }
  override render(width: number): string[] {
    const inner = Math.max(1, width - MARGIN * 2);
    const lines: string[] = [];
    for (const zone of this.zones) {
      for (const raw of zone.render(inner)) {
        // The bottom area keeps the terminal's own background: the editor is framed
        // by its two rules and the status bar is plain text under it, so nothing
        // here is a painted slab. Same 2-column margin as before.
        lines.push(`${" ".repeat(MARGIN)}${truncateToWidth(raw, inner)}`);
      }
    }
    return lines;
  }
  override invalidate(): void {
    for (const zone of this.zones) zone.invalidate();
  }
}

/** Blank rows above a block, and only while that block actually renders lines. */
export class Gap extends Container {
  constructor(private inner: Component, private rows = 1) {
    super();
  }
  override render(width: number): string[] {
    const lines = this.inner.render(width);
    if (lines.length === 0) return lines;
    return [...Array.from({ length: this.rows }, () => ""), ...lines];
  }
  override invalidate(): void {
    this.inner.invalidate();
  }
}
