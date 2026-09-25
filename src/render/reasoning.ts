import stringWidth from "string-width";
import { kumoIcons, withoutEmoji, type KumoIcons } from "./chars.js";

export interface Screen { write(s: string): void; columns: number; }
export function dim(s: string): string { return `\x1b[2m${s}\x1b[22m`; }
export function sanitize(s: string): string {
  return withoutEmoji(s).replace(/[\x00-\x09\x0b-\x1f\x7f\x80-\x9f]/g, " ");
}

/** Keep the incomplete suffix private; publish only the last complete sentence. */
export function splitReasoningSegments(current: string, lastFinished: string, delta: string): {
  current: string; lastFinished: string; finishedAny: boolean;
} {
  const input = current + sanitize(delta);
  let start = 0;
  let finished = lastFinished;
  let finishedAny = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const newline = ch === "\n";
    const punctuation = /[.!?…]/.test(ch!) && /\s/.test(input[i + 1] ?? "");
    if (!newline && !punctuation) continue;
    const candidate = input.slice(start, newline ? i : i + 1).trim();
    if (!newline && /\b(?:e\.g|i\.e)\.$/i.test(candidate)) continue;
    if (candidate !== "") { finished = candidate; finishedAny = true; }
    start = i + 1;
  }
  return { current: input.slice(start).trimStart(), lastFinished: finished, finishedAny };
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
/** Keep the beginning, truncating on a grapheme boundary and counting cells. */
export function clipCells(text: string, width: number, ellipsis = "…"): string {
  if (width <= 0) return "";
  if (stringWidth(text) <= width) return text;
  const suffix = width >= stringWidth(ellipsis) ? ellipsis : ".".repeat(width);
  let out = "";
  let used = 0;
  for (const { segment } of segmenter.segment(text)) {
    const cells = stringWidth(segment);
    if (used + cells > width - stringWidth(suffix)) break;
    out += segment;
    used += cells;
  }
  return out + suffix;
}

export const SPINNER_FRAMES = ["·", "✢", "✺", "✶", "✻", "✽", "✻", "✶", "✺", "✢"];
export const ASCII_SPINNER_FRAMES = ["-", "\\", "|", "/"];
export function spinnerFrame(elapsed: number, icons: KumoIcons): string {
  const frames = icons.think === "*" ? ASCII_SPINNER_FRAMES : SPINNER_FRAMES;
  return frames[Math.floor(Math.max(0, elapsed) / 100) % frames.length]!;
}
export function thinkingText(sentence: string, columns: number, elapsed: number, icons: KumoIcons): string {
  return clipCells(`${spinnerFrame(elapsed, icons)} Thinking${sentence ? `  ${sentence}` : ""}`, columns, icons.think === "*" ? "..." : "…");
}
/** Compatibility helper for callers needing a clipped reasoning sentence. */
export function visible(s: string, columns: number, icons: KumoIcons = kumoIcons()): string {
  return clipCells(s.trimStart(), Math.max(0, columns - 1 - stringWidth(`${icons.think} `)));
}

const CLEAR = "\r\x1b[2K";
const NOWRAP = "\x1b[?7l";
const WRAP = "\x1b[?7h";
export class ReasoningLine {
  #active = false;
  #current = "";
  #lastFinished = "";
  #startTime = 0;
  constructor(private screen: Screen, private now: () => number = Date.now, private icons: KumoIcons = kumoIcons()) {}
  get active(): boolean { return this.#active; }
  push(delta: string): void {
    if (delta === "") return;
    if (!this.#active) { this.#active = true; this.#startTime = this.now(); }
    const split = splitReasoningSegments(this.#current, this.#lastFinished, delta);
    this.#current = split.current;
    this.#lastFinished = split.lastFinished;
    this.screen.write(CLEAR + NOWRAP + dim(thinkingText(this.#lastFinished, this.screen.columns - 1, this.now() - this.#startTime, this.icons)) + WRAP);
  }
  end(): void {
    if (!this.#active) return;
    const seconds = (this.now() - this.#startTime) / 1000;
    this.screen.write(CLEAR + NOWRAP + dim(clipCells(`${this.icons.think} Thought for ${seconds.toFixed(1)}s`, this.screen.columns - 1)) + WRAP + "\n");
    this.#active = false;
    this.#current = "";
    this.#lastFinished = "";
  }
}
