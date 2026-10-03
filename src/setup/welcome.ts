import { isKeyRelease, matchesKey, visibleWidth, wrapTextWithAnsi, type Component, type SelectItem } from "@earendil-works/pi-tui";
import { Box } from "../ui/box.js";
import { isAscii } from "../render/chars.js";
import { fillLine, gradientStops } from "../ui/palette.js";
import { ansi } from "../ui/theme.js";
import { LOGO, LOGO_STOPS, terminalMotionAllowed, wordmarkFrame } from "../ui/logo-motion.js";
import { paintRainRow, rainGrid, type RainCell, type RainInk } from "../ui/rain.js";
import { typedText } from "../ui/keys.js";

const MOTION_MS = 1600;
const HOLD_MS = 400;
const FRAME_MS = 45;

const WORD = "BRUINE";

/** The drops in three depths of the palette: the far ones are barely there. */
const RAIN_INK: RainInk = { far: (t) => ansi.faint(t), mid: (t) => ansi.gray(t), near: (t) => ansi.cyan(t) };

/** The rain thickens as it starts, holds, and thins out as the mark is finished. */
function rainDensity(phase: number): number {
  if (phase < 0.18) return (phase / 0.18) * 0.22;
  if (phase < 0.7) return 0.22;
  return Math.max(0, 0.22 * (1 - (phase - 0.7) / 0.3));
}

/** Full-screen, centered brand animation before the first setup choice. */
export class SetupWelcome implements Component {
  onContinue?: () => void;
  #startedAt = Date.now();
  #timer: ReturnType<typeof setInterval> | undefined;
  #animated = terminalMotionAllowed();

  constructor(private readonly rows: () => number) {}

  start(onFrame: () => void): void {
    this.#startedAt = Date.now();
    if (this.#timer !== undefined) return;
    this.#timer = setInterval(() => {
      onFrame();
      if (Date.now() - this.#startedAt >= MOTION_MS + HOLD_MS) {
        this.stop();
        this.onContinue?.();
      }
    }, FRAME_MS);
    this.#timer.unref?.();
  }

  stop(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  render(width: number): string[] {
    const elapsed = Date.now() - this.#startedAt;
    const phase = this.#animated ? Math.min(1, elapsed / MOTION_MS) : 1;
    const ascii = isAscii();
    const markWidth = LOGO[0].length;
    const narrow = width < markWidth + 4;
    const frame = ascii || narrow ? [WORD] : wordmarkFrame(phase);
    // Keep the full canvas (the mark plus a row of streaks above and splash below) after the
    // mark settles into its permanent rows, so it remains still and centered for the brief final hold.
    const canvasHeight = ascii || narrow ? 1 : LOGO.length + 2;
    const canvas = Array<string>(canvasHeight).fill("");
    const frameTop = Math.floor((canvasHeight - frame.length) / 2);
    frame.forEach((line, index) => { canvas[frameTop + index] = line; });
    const rows = Math.max(1, this.rows());
    const top = Math.max(0, Math.floor((rows - canvasHeight) / 2));

    // The rain falls over the whole screen while the mark forms, and stops as it is done. It is
    // left out where there is no motion, in ASCII and on a narrow screen: the word is enough.
    const raining = this.#animated && !ascii && !narrow && phase < 1;
    const grid: Array<Array<RainCell | undefined>> | undefined = raining
      ? rainGrid({ width, height: rows, time: elapsed, density: rainDensity(phase), seed: 7 })
      : undefined;
    const left = Math.max(0, Math.floor((width - (frame[0] === undefined ? 0 : visibleWidth(frame[0]))) / 2));
    if (grid !== undefined) {
      // Nothing falls on the mark's own cells or one row and a few columns around them: the
      // drops reach it through the streaks drawn above its letters.
      for (let y = Math.max(0, top - 1); y < Math.min(rows, top + canvasHeight + 1); y += 1) {
        for (let x = Math.max(0, left - 3); x < Math.min(width, left + markWidth + 3); x += 1) grid[y]![x] = undefined;
      }
    }

    const screen: string[] = [];
    for (let y = 0; y < rows; y += 1) {
      const row = grid?.[y];
      const mark = y >= top && y < top + canvasHeight ? canvas[y - top] : undefined;
      if (mark !== undefined && mark !== "") {
        const styled = ascii || narrow ? ansi.cyan(mark) : gradientStops(mark, [...LOGO_STOPS]);
        const at = Math.max(0, Math.floor((width - visibleWidth(mark)) / 2));
        const before = row === undefined ? " ".repeat(at) : paintRainRow(row.slice(0, at), RAIN_INK);
        const after = row === undefined ? "" : paintRainRow(row.slice(at + visibleWidth(mark)), RAIN_INK);
        screen.push(`${before}${styled}${after}`);
      } else {
        screen.push(row === undefined ? "" : paintRainRow(row, RAIN_INK));
      }
    }
    return screen.slice(0, rows).map((line) => fillLine("surface", line));
  }

  invalidate(): void {}

  handleInput(data: string): void {
    if (!isKeyRelease(data) && matchesKey(data, "enter")) this.onContinue?.();
  }
}

/**
 * How hard it rains while a card is under the cursor: the option that goes on is a downpour, the
 * one that puts it off is a drizzle. A card that says nothing about it leaves the rain as it was.
 */
export function cardWeather(value: string): number | undefined {
  switch (value) {
    case "simple": // Quick setup
    case "settings": // Review your setup
      return 0.95;
    case "full": // Customize setup
      return 0.62;
    case "later": // Set up later
      return 0.12;
    default:
      return undefined;
  }
}

export interface SetupCardOption extends SelectItem {
  recommended?: boolean;
}

/** Framed onboarding choices, following the Mistral Vibe setup rhythm. */
export class SetupCardPicker implements Component {
  onSelect?: (index: number) => void;
  onChange?: (index: number) => void;
  #selected = 0;
  #top = 0;

  #height: number | undefined;
  setHeight(rows: number): void { this.#height = Math.max(1, rows); }
  setSelectedIndex(index: number): void { this.#selected = Math.max(0, Math.min(this.items.length - 1, index)); }
  getSelectedIndex(): number { return this.#selected; }

  constructor(private readonly items: SetupCardOption[], private readonly rows: () => number) {}

  render(width: number): string[] {
    const ascii = isAscii();
    const glyph = new Box(width, { ascii }).glyphs;
    if (width < 40) {
      const limit = Math.max(1, Math.min(this.items.length, Math.floor((this.#height ?? this.rows() - 8) / 3)));
      if (this.#selected < this.#top) this.#top = this.#selected;
      if (this.#selected >= this.#top + limit) this.#top = this.#selected - limit + 1;
      return this.items.slice(this.#top, this.#top + limit).flatMap((item, offset) => {
        const selected = this.#top + offset === this.#selected;
        const label = `${selected ? (ascii ? "> " : "› ") : "  "}${fitPlain(item.label, width - 2)}`;
        return [selected ? ansi.cyan(label) : label, `  ${ansi.gray(fitPlain(item.description ?? "", width - 2))}`, ""];
      });
    }
    const cardWidth = Math.min(68, width - 8);
    const pad = Math.max(0, Math.floor((width - cardWidth - 2) / 2));
    const contentWidth = Math.max(1, cardWidth - 4);
    const chrome = (text: string, selected: boolean): string =>
      selected ? ansi.cyan(text) : ansi.faint(text);
    const lines: string[] = [];
    const usable = Math.max(1, this.#height ?? this.rows() - 8);
    const perCard = 6;
    const visible = Math.max(1, Math.floor((usable - (this.items.length * perCard > usable ? 1 : 0)) / perCard));
    if (this.#selected < this.#top) this.#top = this.#selected;
    if (this.#selected >= this.#top + visible) this.#top = this.#selected - visible + 1;
    const end = Math.min(this.items.length, this.#top + visible);

    for (let i = this.#top; i < end; i += 1) {
      const item = this.items[i]!;
      const selected = i === this.#selected;
      const marker = selected ? `${ansi.cyan(glyph.arrow)} ` : "  ";
      const badge = item.recommended === true ? " Recommended " : "";
      const box = new Box(cardWidth, { ascii, ink: text => chrome(text, selected) });
      const top = box.edge(badge, false, 1);
      const bottom = box.edge("", true);
      const title = fitPlain(item.label, contentWidth);
      const description = wrapTextWithAnsi(item.description ?? "", contentWidth).slice(0, 2);
      lines.push(`${" ".repeat(pad)}${marker}${top}`);
      lines.push(`${" ".repeat(pad)}  ${box.row(selected ? ansi.bold(ansi.text(title)) : title)}`);
      // A card with nothing to say (the Skip card) is just its title, not two empty rows.
      for (let row = 0; row < (description.length === 0 ? 0 : 2); row++) {
        const text = description[row] ?? "";
        lines.push(`${" ".repeat(pad)}  ${box.row(ansi.gray(text))}`);
      }
      lines.push(`${" ".repeat(pad)}  ${bottom}`);
      lines.push("");
    }
    if (this.items.length > visible) {
      lines.push(center(ansi.gray(`${String(this.#selected + 1)} of ${String(this.items.length)}`), `${String(this.#selected + 1)} of ${String(this.items.length)}`, width));
    }
    return lines;
  }

  invalidate(): void {}

  handleInput(data: string): void {
    if (isKeyRelease(data) || this.items.length === 0) return;
    if (matchesKey(data, "up") || matchesKey(data, "down")) {
      const next = matchesKey(data, "up")
        ? (this.#selected - 1 + this.items.length) % this.items.length
        : (this.#selected + 1) % this.items.length;
      this.#selected = next;
      this.onChange?.(next);
      return;
    }
    if (matchesKey(data, "enter")) this.onSelect?.(this.#selected);
  }
}

/** Live theme carousel and preview, inspired by the Vibe theme onboarding. */
export class SetupThemePicker implements Component {
  onSelect?: (theme: "dark" | "light" | "high-contrast") => void;
  onSkip?: () => void;
  #selected: number;
  readonly themes = ["dark", "light", "high-contrast"] as const;

  constructor(initial: "dark" | "light" | "high-contrast") {
    this.#selected = this.themes.indexOf(initial);
  }

  render(width: number): string[] {
    const ascii = isAscii();
    const title = fitPlain("Select your preferred theme", width);
    const names = this.themes.map((theme, index) => {
      const text = index === this.#selected ? `${ascii ? "> " : "› "}${theme}${ascii ? " <" : " ‹"}` : theme;
      return center(index === this.#selected ? ansi.bold(ansi.violet(text)) : ansi.faint(text), text, width);
    });
    const hintsText = ascii ? "Navigate up/down     Enter continue     S keep current" : "Navigate ↑/↓     Enter continue     S keep current";
    const visibleHints = fitPlain(hintsText, width);
    const hints = center(ansi.gray(visibleHints), visibleHints, width);
    const cardWidth = Math.max(4, Math.min(72, width - 4));
    const cardPad = Math.max(0, Math.floor((width - cardWidth) / 2));
    const box = new Box(cardWidth, { ascii });
    const line = (s: string): string => fitPlain(s, Math.max(1, cardWidth - 4));
    const frame = (s: string): string => `${" ".repeat(cardPad)}${box.row(s)}`;
    const border = box.edge();
    const lower = box.edge("", true);
    const preview = this.#previewLines();
    const middle = Math.floor((width - cardWidth) / 2);
    return [
      "",
      center(ansi.bold(ansi.text(title)), title, width),
      "",
      ...names,
      "",
      center(ansi.faint("Preview"), "Preview", width),
      `${" ".repeat(Math.max(0, middle))}${ansi.faint(border)}`,
      ...preview.map((s) => frame(line(s))),
      `${" ".repeat(Math.max(0, middle))}${ansi.faint(lower)}`,
      "",
      hints,
    ];
  }

  invalidate(): void {}

  handleInput(data: string): void {
    if (isKeyRelease(data)) return;
    if (matchesKey(data, "up") || matchesKey(data, "down")) {
      const delta = matchesKey(data, "up") ? -1 : 1;
      this.#selected = (this.#selected + delta + this.themes.length) % this.themes.length;
      return;
    }
    if (matchesKey(data, "enter")) this.onSelect?.(this.themes[this.#selected]!);
    else if (typedText(data).toLowerCase() === "s") this.onSkip?.();
  }

  #previewLines(): string[] {
    const theme = this.themes[this.#selected];
    if (theme === "light") {
      const ascii = isAscii();
      return [
        ansi.bold("Heading"),
        "Bold, italic, and inline code.",
        ascii ? "+ Project ready     OK Tests passed" : "• Project ready     ✓ Tests passed",
        "  pnpm test  ·  local model",
        "The preview updates as you browse themes.",
      ];
    }
    if (theme === "high-contrast") {
      const ascii = isAscii();
      return [
        ansi.bold(ansi.text("HEADING")),
        ansi.bold("Bold text  ·  inline code"),
        ansi.green(ascii ? "+ Project ready" : "+ Project ready") + "    " + ansi.yellow("! Review changes"),
        "  pnpm test  ·  local model",
        ansi.bold("The preview updates as you browse themes."),
      ];
    }
    const ascii = isAscii();
    return [
      ansi.bold(ansi.cyan("Heading")),
      `${ansi.bold("Bold")}, ${ansi.italic("italic")}, and ${ansi.yellow("inline code")}.`,
      `${ansi.green(ascii ? "+ Project ready" : "• Project ready")}     ${ansi.violet(ascii ? "OK Tests passed" : "✓ Tests passed")}`,
      `  ${ansi.text("pnpm test")}  ·  ${ansi.gray("local model")}`,
      ansi.gray("The preview updates as you browse themes."),
    ];
  }
}

function center(styled: string, plain: string, width: number): string {
  return `${" ".repeat(Math.max(0, Math.floor((width - visibleWidth(plain)) / 2)))}${styled}`;
}

function fitPlain(value: string, width: number): string {
  if (width <= 0) return "";
  return new Box(width).fit(value, width);
}
