import { truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import { kumoIcons } from "../render/chars.js";
import { paint, onBg, colorDepth } from "../ui/palette.js";
import { ansi } from "../ui/theme.js";

export interface SetupFrameOptions {
  step?: number;
  total?: number;
  help: string;
  rows: () => number;
  status?: () => string;
}

/** Shared title, step badge, content rhythm and keyboard help for full setup. */
export class SetupFrame implements Component {
  constructor(readonly title: string, private content: Component, private options: SetupFrameOptions) {}

  render(width: number): string[] {
    if (width <= 0) return [];
    const ascii = process.env.KUMO_ASCII === "1" || kumoIcons().think === "*";
    const glyph = ascii ? { top: "+", bottom: "+", right: "+", lower: "+", bar: "|", line: "-" } : { top: "╭", bottom: "╰", right: "╮", lower: "╯", bar: "│", line: "─" };
    const w = Math.max(1, width - 4);
    const plainGlyphs = (text: string): string => ascii ? text.replaceAll("↑", "up").replaceAll("↓", "down").replaceAll("←", "<").replaceAll("→", ">").replaceAll("…", "...").replaceAll("·", "/").replaceAll("★", "*") : text;
    const fit = (text: string, cells: number): string => visibleWidth(text) > cells ? truncateToWidth(text, cells, ascii ? "..." : "…") : text;
    const row = (text: string): string => {
      const body = fit(plainGlyphs(text), w);
      return fit(`${paint("lavender", glyph.bar)} ${body}${" ".repeat(Math.max(0, w - visibleWidth(body)))} ${paint("lavender", glyph.bar)}`, width);
    };
    const edge = (left: string, right: string): string => paint("lavender", fit(`${left}${glyph.line.repeat(Math.max(0, width - 2))}${right}`, width));
    const heading = wrapTextWithAnsi(ansi.bold(ansi.text(plainGlyphs(this.title))), w);
    const badgeText = this.options.step === undefined ? "" : ` Step ${this.options.step}/${this.options.total ?? 9} `;
    const badge = onBg("chip", paint("lavender", badgeText));
    const header = heading.length === 1 && visibleWidth(heading[0]!) + badgeText.length + 3 <= w
      ? [row(`${heading[0]}${" ".repeat(w - visibleWidth(heading[0]!) - badgeText.length)}${badge}`)]
      : [...heading.map(row), ...(badgeText ? [row(badge)] : [])];
    const help = wrapTextWithAnsi(ansi.gray(plainGlyphs(this.options.help)), w).map(row);
    const status = this.options.status?.();
    const foot = [...(status ? wrapTextWithAnsi(ansi.gray(plainGlyphs(status)), w).map(row) : []), ...help];
    const body = this.content.render(w);
    const budget = Math.max(1, this.options.rows() - header.length - foot.length - 4);
    const rendered = [edge(glyph.top, glyph.right), ...header, row(""), ...body.slice(0, budget).map(row), row(""), ...foot, edge(glyph.bottom, glyph.lower)];
    return colorDepth() === "none" ? rendered.map(line => line.replace(/\x1b\[[0-9;]*m/g, "")) : rendered;
  }
  handleInput(data: string): void { (this.content as Component & { handleInput?: (data: string) => void }).handleInput?.(data); }
  invalidate(): void { this.content.invalidate(); }
}
