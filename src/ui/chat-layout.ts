import {
  Container,
  Editor,
  sliceByColumn,
  truncateToWidth,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";
import stringWidth from "string-width";
import { bruineIcons, withoutEmoji, type BruineIcons } from "../render/chars.js";
import { blendHex, bgEnabled, boxLine, colorDepth, fillLine, inkHex, paintHex, type PaletteRole } from "./palette.js";
import { reasoningStyle } from "../render/reasoning.js";
import { ansi } from "./theme.js";

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
  blue: ["sky", "skyDeep"],
  red: ["rose", "railErrorEnd"],
  // T55 P1c: the live rail is the brightest mark in the transcript. A tool in
  // flight and a tool that finished ten seconds ago used to be the same blue, so
  // "where is bruine right now" meant reading every block.
  active: ["railActive", "railActiveEnd"],
} as const satisfies Record<string, readonly [PaletteRole, PaletteRole]>;

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
  return paintHex(blendHex(inkHex(from), inkHex(to), t), char);
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/** Own block spacing/padding once, without changing the model's transcript. */
export class ChatTranscript extends Container {
  constructor(private icons: BruineIcons = bruineIcons()) {
    super();
  }
  /** What each block was laid out as, and from what, so a block that did not change is not laid out again. */
  #laid = new WeakMap<Component, { width: number; palette: string; rail: RailState | undefined; role: PaletteRole; showRail: boolean; block: string[]; piece: string[] }>();
  /** The rows of the last render, per block: a press has to find the block it landed on (D6). */
  #rows: Array<{ child: Component; from: number; to: number }> = [];

  /**
   * The clickable block on this transcript row, when there is one.
   *
   * The rows are this transcript's own, from the last render: the shell owns where
   * the transcript sits inside the frame, so a screen row is mapped to one of these
   * before it gets here. A press that lands on a block that does not claim clicks
   * is a selection, and nothing is claimed.
   */
  hitTest(row: number): Component | undefined {
    for (const block of this.#rows) {
      if (row < block.from || row >= block.to) continue;
      return typeof (block.child as { click?: unknown }).click === "function" ? block.child : undefined;
    }
    return undefined;
  }

  render(width: number): string[] {
    const inner = Math.max(1, width - 4);
    const lines: string[] = [];
    this.#rows = [];
    // The colours a card is painted with: when the terminal's background is probed, or the
    // theme changes, this string changes and every block is laid out again.
    const palette = [
      boxLine("toolOk", "", 8),
      boxLine("toolPending", "", 8),
      boxLine("toolErr", "", 8),
      fillLine("userBlock", ""),
      railPaint("blue", "x", 0),
      railPaint("red", "x", 0),
      railPaint("active", "x", 0),
      reasoningStyle("x"),
    ].join("|");
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
      // A call that shows a diff gets the neutral block: the two bands inside it are
      // the only colour that should mean anything here (see ToolCallComponent.diffCard).
      const role =
        rail === "active" || (child as { diffCard?: boolean }).diffCard === true
          ? "toolPending"
          : rail === "red"
            ? "toolErr"
            : "toolOk";
      const showRail = !bgEnabled();
      const block = child.render(rail === undefined ? inner : Math.max(1, width - 8));
      if (!block.length) continue;
      // A block that renders the same lines at the same width in the same colours lays out
      // the same card. Laying out is the cost: every line is measured and clipped, and a long
      // session held hundreds of settled blocks that were redone on every frame, so the
      // screen answered a keystroke a fifth of a second late. Only a block that changed pays.
      const hit = this.#laid.get(child);
      if (hit !== undefined && hit.width === width && hit.palette === palette && hit.rail === rail && hit.role === role && hit.showRail === showRail && sameLines(hit.block, block)) {
        const from = lines.length;
        lines.push(...hit.piece);
        this.#rows.push({ child, from, to: lines.length });
        continue;
      }
      const piece = ((): string[] => {
        const piece: string[] = [];
        piece.push("");
        // The rail runs the full height of the card, padding lines included (Aron: "la
        // barre bleue ne va pas jusqu'au bout"); its gradient spans all of them.
        const railSpan = block.length + 1;
        if (rail !== undefined) piece.push(card(role, showRail ? railPaint(rail, railChar, 0) : ""));
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
          // The band's top line is its own padding: one blank row in the tint above
          // the prompt, so the prompt sits inside the band rather than on its edge.
          // It used to carry a right-aligned `turn N`, which is one more piece of
          // chrome between the eye and the question that was asked, and a number the
          // reader has no use for: the receipt under the answer already counts what a
          // turn did.
          piece.push(band(""));
          // The accent spends the first of the band's two leading columns, so the
          // prompt still starts in column 2.
          for (const line of block) piece.push(band(` ${withoutEmoji(line)}`));
          piece.push(band(""));
          return piece;
        }
        for (const [i, line] of block.entries()) {
          const clean = (child as Component & { transcriptStyle?: string }).transcriptStyle === "reasoning" ? reasoningStyle(withoutEmoji(line)) : withoutEmoji(line);
          if (rail === undefined) {
            piece.push(truncateToWidth(`  ${clean}`, width - 2));
          } else {
            const colored = railPaint(rail, railChar, (i + 1) / railSpan);
            const body = `${showRail ? colored : " "} ${clean}`;
            piece.push(card(role, visibleWidth(body) > cardCells ? truncateToWidth(body, cardCells) : body));
          }
        }
        if (rail !== undefined) piece.push(card(role, showRail ? railPaint(rail, railChar, 1) : ""));
        return piece;
      })();
      this.#laid.set(child, { width, palette, rail, role, showRail, block, piece });
      const from = lines.length;
      lines.push(...piece);
      this.#rows.push({ child, from, to: lines.length });
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
  #bottomBorder = "";
  #frameBottomRow = 0;
  /** Boundary between editable rows and autocomplete, from the last render. */
  get frameBottomRow(): number { return this.#frameBottomRow; }
  protected override renderBottomBorder(width: number, hiddenLineCount: number): string {
    this.#bottomBorder = super.renderBottomBorder(width, hiddenLineCount);
    return this.#bottomBorder;
  }
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
    const rendered = super.render(width);
    this.#frameBottomRow = rendered.indexOf(this.#bottomBorder, 1);
    const lines = rendered.map((line) => chipMarkers(withoutEmoji(line)));
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
