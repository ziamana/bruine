import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { isAscii } from "../render/chars.js";

const UNICODE_BOX = { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│", arrow: "›" };
const ASCII_BOX = { tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|", arrow: ">" };

export interface BoxOptions {
  ascii?: boolean;
  ink?: (text: string) => string;
}

/** Cell-aware rounded borders and rows; callers own labels, colors and layout. */
export class Box {
  readonly ascii: boolean;
  readonly glyphs: typeof UNICODE_BOX;
  readonly innerWidth: number;
  private ink: (text: string) => string;
  constructor(readonly width: number, options: BoxOptions = {}) {
    this.ascii = options.ascii ?? isAscii();
    this.glyphs = this.ascii ? ASCII_BOX : UNICODE_BOX;
    this.innerWidth = Math.max(1, width - 4);
    this.ink = options.ink ?? (text => text);
  }
  fit(text: string, cells = this.innerWidth): string {
    return visibleWidth(text) > cells ? truncateToWidth(text, cells, this.ascii ? "..." : "…") : text;
  }
  row(text: string): string {
    const body = this.fit(text);
    const bar = this.ink(this.glyphs.v);
    return this.fit(`${bar} ${body}${" ".repeat(Math.max(0, this.innerWidth - visibleWidth(body)))} ${bar}`, this.width);
  }
  edge(label = "", bottom = false, inset = 0): string {
    const { tl, tr, bl, br, h } = this.glyphs;
    const shown = label ? this.fit(label, Math.max(1, this.width - 2 - inset)) : "";
    const rule = h.repeat(Math.max(0, this.width - 2 - visibleWidth(shown) - inset));
    const line = bottom ? rule + shown + h.repeat(inset) : h.repeat(inset) + shown + rule;
    return this.ink(this.fit(`${bottom ? bl : tl}${line}${bottom ? br : tr}`, this.width));
  }
}
