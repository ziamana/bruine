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
import { blendHex, bgEnabled, colorDepth, fillLine, paintHex } from "./palette.js";
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
  blue: ["#7dcfff", "#4aa8e0"],
  red: ["#ff7a90", "#c04a5e"],
} as const;

/**
 * The tool rail, shaded from `sky` to `skyDeep` down the block so a run of tool
 * calls reads as one gradient rather than a stack of identical bars. 16-color
 * terminals keep the flat blue/red, where a blended hex would collapse to a
 * single code.
 */
export function railPaint(rail: "blue" | "red", char: string, t: number): string {
  const d = colorDepth();
  if (d !== "truecolor" && d !== "256") return rail === "red" ? ansi.red(char) : ansi.blue(char);
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
    for (const child of this.children) {
      const rail = (child as { rail?: "blue" | "red" }).rail;
      // Same 2-column margin on both sides: railed blocks lose 2 more cells to "▍ ".
      const block = child.render(rail === undefined ? inner : Math.max(1, width - 6));
      if (!block.length) continue;
      lines.push("");
      if ((child as { surface?: boolean }).surface === true) {
        // User prompt: a full-width tinted band (Nuage), one line of padding each
        // side, opening on the same 1-column accent as the console band.
        const band = (text: string): string => {
          const painted = bgEnabled();
          const cut = truncateToWidth(text, width - 1);
          const body = painted ? cut + " ".repeat(Math.max(0, width - 1 - visibleWidth(cut))) : cut;
          return fillLine("surface", (painted ? ansi.edge(" ") : " ") + body);
        };
        lines.push(band(""));
        // The accent spends the first of the band's two leading columns, so the
        // prompt still starts in column 2.
        for (const line of block) lines.push(band(` ${withoutEmoji(line)}`));
        lines.push(band(""));
        continue;
      }
      const last = block.length - 1;
      for (const [i, line] of block.entries()) {
        const clean = withoutEmoji(line);
        if (rail === undefined) {
          lines.push(truncateToWidth(`  ${clean}`, width - 2));
        } else {
          const colored = railPaint(rail, railChar, last === 0 ? 0 : i / last);
          lines.push(truncateToWidth(`  ${colored} ${clean}`, width - 2));
        }
      }
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
    out[row] = head + shown + " ".repeat(Math.max(0, width - at - visibleWidth(shown)));
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
    const painted = bgEnabled();
    // The accent belongs to the surface, so it only exists when there is one: on
    // 16 colors the band is byte for byte the 2-column margin it replaced, rather
    // than a lone colored bar with nothing to anchor it.
    const accent = painted ? ansi.edge(" ") : " ";
    const lines: string[] = [];
    for (const zone of this.zones) {
      for (const raw of zone.render(inner)) {
        const body = truncateToWidth(raw, inner);
        const pad = painted ? " ".repeat(Math.max(0, inner - visibleWidth(body))) : "";
        // The accent is flush against the left edge, exactly like the prompt
        // band's, and spends the first of the two margin columns: nothing to its
        // left but the terminal's own background, and the body still starts at 2.
        lines.push(fillLine("surface", `${accent} ${body}${pad}`));
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
