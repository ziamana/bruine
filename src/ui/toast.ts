/**
 * T56 — the corner notice.
 *
 * A confirmation is not a notice: `showNotice` (the line above the editor) says
 * what mode bruine is in and stays 3 s, because a mode is a state you may need to
 * read twice. This one says what just happened, once, in the corner, and gets
 * out of the way. Mixing the two would either bury the mode or spam the corner.
 *
 * An overlay rather than a row in the tree, for two reasons: the main screen
 * has no free row to give (every row is transcript or console band, and taking
 * one moves the editor under the pointer), and `nonCapturing` keeps the editor's
 * focus, so a notice can never eat a keystroke.
 */

import { visibleWidth, type Component, type OverlayHandle, type TUI } from "@earendil-works/pi-tui";
import { ansi } from "./theme.js";
import { onBg } from "./palette.js";

export type ToastTone = "info" | "good" | "bad";

/** Long enough to read a path, short enough not to sit over the transcript. */
export const TOAST_MS = 2500;

/** One line, painted like a chip, sized to its text. */
class ToastComponent implements Component {
  constructor(
    private readonly text: string,
    private readonly tone: ToastTone,
  ) {}

  /** The width the overlay should ask for: the text, and nothing else. */
  get width(): number {
    return Math.max(4, visibleWidth(this.text) + 2);
  }

  render(width: number): string[] {
    const body = this.tone === "good" ? ansi.green(this.text) : this.tone === "bad" ? ansi.red(this.text) : this.text;
    // Padded to the width the host was given, which is what closes the chip on
    // the right. On a terminal with no background, onBg drops the padding again.
    const pad = " ".repeat(Math.max(0, width - visibleWidth(this.text)));
    return [onBg("chip", `${ansi.text(body)}${pad}`)];
  }

  invalidate(): void {
    // Nothing cached: every render paints from the text it was built with.
  }
}

export interface ToastHostOptions {
  durationMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * Owns the one overlay slot a toast may use.
 *
 * A second notice replaces the first instead of stacking: two corners fighting
 * over the same pixels is how a user misses both.
 */
export class ToastHost {
  #handle: OverlayHandle | undefined;
  #timer: unknown;
  readonly #tui: TUI;
  readonly #opts: ToastHostOptions;

  constructor(tui: TUI, opts: ToastHostOptions = {}) {
    this.#tui = tui;
    this.#opts = opts;
  }

  get visible(): boolean {
    return this.#handle !== undefined;
  }

  show(text: string, tone: ToastTone = "info"): void {
    this.hide();
    if (text.trim() === "") return;
    const toast = new ToastComponent(text, tone);
    const available = Math.max(4, this.#tui.terminal.columns - 2);
    this.#handle = this.#tui.showOverlay(toast, {
      anchor: "top-right",
      // Without this the overlay takes keyboard focus, and a notice about a
      // copy would eat the next character the user typed.
      nonCapturing: true,
      margin: 1,
      width: Math.min(toast.width, available),
      maxHeight: 1,
    });
    const setTimer = this.#opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    const clearTimer = this.#opts.clearTimer ?? ((handle: unknown) => clearTimeout(handle as NodeJS.Timeout));
    this.#timer = setTimer(() => {
      this.#timer = undefined;
      this.hide();
    }, this.#opts.durationMs ?? TOAST_MS);
    // A pending notice must never be the reason the process stays alive.
    (this.#timer as { unref?: () => void }).unref?.();
    this.#tui.requestRender();
  }

  hide(): void {
    if (this.#timer !== undefined) {
      const clearTimer = this.#opts.clearTimer ?? ((handle: unknown) => clearTimeout(handle as NodeJS.Timeout));
      clearTimer(this.#timer);
      this.#timer = undefined;
    }
    this.#handle?.hide();
    this.#handle = undefined;
  }
}
