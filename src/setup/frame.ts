import { visibleWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import { isAscii, asciiText } from "../render/chars.js";
import { paint, onBg, colorDepth } from "../ui/palette.js";
import { ansi } from "../ui/theme.js";
import { Box } from "../ui/box.js";
import { paintRainRow, rainGrid, type RainInk } from "../ui/rain.js";

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

export interface CenteredPanelOptions {
  /** The widest the panel gets; a wider terminal gains margins instead of a longer panel. */
  maxWidth: number;
  /** True while a screen owns the whole terminal (the welcome mark), which is never framed. */
  fullscreen: () => boolean;
  /**
   * A light rain in the margins around the panel, never over it. It only exists where the
   * panel leaves room (a wide or a tall terminal), and only while `allowed` says motion is on.
   */
  rain?: { allowed: () => boolean; time: () => number };
}

/** The margin rain is the quietest the rain gets: it must never pull the eye off the panel. */
const MARGIN_INK: RainInk = { far: (t) => ansi.faint(t), mid: (t) => ansi.faint(t), near: (t) => ansi.gray(t) };
const MARGIN_DENSITY = 0.12;

/**
 * Puts the setup panel in the middle of the console.
 *
 * The frame used to take the whole width and sit on the first row, so on a big terminal it
 * hugged the top-left corner with the rest of the screen empty. The panel is now capped in
 * width and centered across; down, it is centered on the tallest it has been during the
 * current step, so choosing among rows or filtering a list does not make it jump.
 */
export class CenteredPanel implements Component {
  #tallest = 0;

  constructor(
    private readonly inner: Component,
    private readonly rows: () => number,
    private readonly options: CenteredPanelOptions,
  ) {}

  /** A new step starts from its own height. */
  reset(): void {
    this.#tallest = 0;
  }

  /** True when the last frame had margins to rain in: the owner uses it to decide whether to keep repainting. */
  get hasMargins(): boolean {
    return this.#margins;
  }
  #margins = false;

  render(width: number): string[] {
    if (this.options.fullscreen() || width <= 0) return this.inner.render(width);
    const panelWidth = Math.max(1, Math.min(width, this.options.maxWidth));
    const leftWidth = Math.max(0, Math.floor((width - panelWidth) / 2));
    const panel = this.inner.render(panelWidth);
    this.#tallest = Math.max(this.#tallest, panel.length);
    const rows = this.rows();
    const top = Math.max(0, Math.floor((rows - this.#tallest) / 2));
    const rain = this.options.rain;
    this.#margins = leftWidth > 0 || top > 0;
    if (rain === undefined || !rain.allowed() || !this.#margins) {
      const left = " ".repeat(leftWidth);
      return [...Array<string>(top).fill(""), ...panel.map((line) => (line === "" ? line : `${left}${line}`))];
    }
    // Rain around the panel: whole rows above and below it, and the columns either side of it.
    const total = Math.max(rows - 1, top + panel.length);
    const grid = rainGrid({ width, height: total, time: rain.time(), density: MARGIN_DENSITY, seed: 11 });
    const out: string[] = [];
    for (let y = 0; y < total; y += 1) {
      const cells = grid[y]!;
      const line = panel[y - top];
      if (line === undefined) {
        out.push(paintRainRow(cells, MARGIN_INK));
        continue;
      }
      const slack = Math.max(0, panelWidth - visibleWidth(line));
      out.push(`${paintRainRow(cells.slice(0, leftWidth), MARGIN_INK)}${line}${" ".repeat(slack)}${paintRainRow(cells.slice(leftWidth + panelWidth), MARGIN_INK)}`);
    }
    return out;
  }

  invalidate(): void {
    this.inner.invalidate();
  }
}
