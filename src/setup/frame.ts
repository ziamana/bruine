import { visibleWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import { isAscii, asciiText } from "../render/chars.js";
import { paint, onBg, colorDepth } from "../ui/palette.js";
import { ansi } from "../ui/theme.js";
import { Box } from "../ui/box.js";

export interface SetupFrameOptions {
  step?: number;
  total?: number;
  help: string;
  rows: () => number;
  status?: () => string;
  onContentHeight?: (rows: number, width: number) => void;
}

/** Shared title, step badge, content rhythm and keyboard help for full setup. */
export class SetupFrame implements Component {
  constructor(readonly title: string, private content: Component, private options: SetupFrameOptions) {}

  render(width: number): string[] {
    if (width <= 0) return [];
    const ascii = isAscii();
    const box = new Box(width, { ascii, ink: text => paint("lavender", text) });
    const w = box.innerWidth;
    const plainGlyphs = (text: string): string => asciiText(text, ascii);
    const row = (text: string): string => box.row(plainGlyphs(text));
    const heading = wrapTextWithAnsi(ansi.bold(ansi.text(plainGlyphs(this.title))), w);
    const badgeText = this.options.step === undefined ? "" : ` Step ${this.options.step}/${this.options.total ?? 9} `;
    const badge = onBg("chip", paint("lavender", badgeText));
    const header = heading.length === 1 && visibleWidth(heading[0]!) + badgeText.length + 3 <= w
      ? [row(`${heading[0]}${" ".repeat(w - visibleWidth(heading[0]!) - badgeText.length)}${badge}`)]
      : [...heading.map(row), ...(badgeText ? [row(badge)] : [])];
    const help = wrapTextWithAnsi(ansi.gray(plainGlyphs(this.options.help)), w).map(row);
    const status = this.options.status?.();
    const foot = [...(status ? wrapTextWithAnsi(ansi.gray(plainGlyphs(status)), w).map(row) : []), ...help];
    const budget = Math.max(1, this.options.rows() - header.length - foot.length - 4);
    this.options.onContentHeight?.(budget, w);
    const body = this.content.render(w);
    const rendered = [box.edge(), ...header, row(""), ...body.slice(0, budget).map(row), row(""), ...foot, box.edge("", true)];
    return colorDepth() === "none" ? rendered.map(line => line.replace(/\x1b\[[0-9;]*m/g, "")) : rendered;
  }
  handleInput(data: string): void { this.content.handleInput?.(data); }
  invalidate(): void { this.content.invalidate(); }
}
