import stringWidth from "string-width";
import { kumoIcons, type KumoIcons } from "./chars.js";

export interface Screen {
  write(s: string): void;
  columns: number;
}

export function dim(s: string): string {
  return `\x1b[2m${s}\x1b[22m`;
}

/** Replace every control char except "\n" (the line delimiter) with a space. */
export function sanitize(s: string): string {
  return s.replace(/[\x00-\x09\x0b-\x1f\x7f\x80-\x9f]/g, " ");
}

const CLEAR = "\r\x1b[2K";
const NOWRAP = "\x1b[?7l";
const WRAP = "\x1b[?7h";

/** Truncate `s` to at most `budget` DISPLAY cells, keeping the tail. */
function truncateCells(s: string, budget: number): string {
  if (budget <= 1) return "…";
  if (stringWidth(s) <= budget) return s;
  const chars = [...s];
  let width = 1; // "…"
  const kept: string[] = [];
  for (let i = chars.length - 1; i >= 0; i--) {
    const w = stringWidth(chars[i]);
    if (width + w > budget) break;
    kept.unshift(chars[i]);
    width += w;
  }
  return `…${kept.join("")}`;
}

/** The visible part of the reasoning line, within `columns - 1` cells total. */
export function visible(s: string, columns: number, icons: KumoIcons = kumoIcons()): string {
  const text = s.replace(/^ +/, "");
  const budget = columns - 1 - stringWidth(`${icons.think} `);
  return truncateCells(text, budget);
}

export class ReasoningLine {
  #screen: Screen;
  #now: () => number;
  #icons: KumoIcons;
  #active = false;
  #current = "";
  #lastFinished = "";
  #startTime = 0;

  constructor(screen: Screen, now: () => number = Date.now, icons: KumoIcons = kumoIcons()) {
    this.#screen = screen;
    this.#now = now;
    this.#icons = icons;
  }

  get active(): boolean {
    return this.#active;
  }

  push(delta: string): void {
    if (delta === "") return;

    if (!this.#active) {
      this.#active = true;
      this.#startTime = this.#now();
      this.#current = "";
      this.#lastFinished = "";
    }

    // Every "\n" in the delta finishes a line; only the last segment
    // continues the current one.
    const segments = delta.split("\n");
    for (const finished of segments.slice(0, -1)) {
      const trimmed = sanitize(finished).replace(/^ +/, "");
      if (trimmed !== "") this.#lastFinished = trimmed;
    }
    this.#current += sanitize(segments[segments.length - 1]);

    // Right after a "\n" the next line has not started yet: keep showing the
    // finished line (no blank flicker) until new text arrives.
    const show = this.#current !== "" ? this.#current : this.#lastFinished;
    if (show === "") return;

    this.#draw(`${this.#icons.think} ${visible(show, this.#screen.columns, this.#icons)}`);
  }

  end(): void {
    if (!this.#active) return;
    const seconds = (this.#now() - this.#startTime) / 1000;
    this.#screen.write(
      CLEAR + NOWRAP + dim(`${this.#icons.think} thought for ${seconds.toFixed(1)}s`) + WRAP + "\n",
    );
    this.#active = false;
    this.#current = "";
    this.#lastFinished = "";
  }

  #draw(line: string): void {
    // Autowrap is switched off around the write so the line can never
    // spill onto a second row even if the width was miscounted.
    this.#screen.write(CLEAR + NOWRAP + dim(line) + WRAP);
  }
}
