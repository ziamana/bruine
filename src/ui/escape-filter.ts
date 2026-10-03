import { isKeyRelease, isKeyRepeat, matchesKey, type Terminal } from "@earendil-works/pi-tui";

/** Escapes closer together than this, after a pause, are a key being held, not tapped. */
const HELD_GAP_MS = 200;
/** An Escape this soon after the last one might be a held key's first repeat or a second tap. */
const REPEAT_WINDOW_MS = 1500;
/** How long a possible repeat waits for the next one before it counts as a second tap. */
const CONFIRM_MS = 120;

export interface EscapeTimers {
  now(): number;
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const REAL_TIMERS: EscapeTimers = {
  now: () => Date.now(),
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Holding Escape must be one Escape.
 *
 * A held key arrives as one press, a pause for the keyboard's repeat delay, then a
 * stream of repeats a few dozen milliseconds apart. Each one was an Escape to the
 * screens: in the setup every repeat went back one more step, and at the prompt every
 * one cancelled again. The terminals most people use do not say which presses are
 * repeats, so the filter works it out from the timing:
 *
 * - The first Escape acts at once, so a tap is never slower.
 * - An Escape that follows another within a second and a half might be the first
 *   repeat of a held key or a deliberate second tap. It waits a moment: if another
 *   arrives while it waits the key is held, and all of them are dropped until the key
 *   is let go; if none does it was a tap and goes through, a moment late.
 * - A terminal that reports repeats (the kitty keyboard protocol) is believed.
 */
export class EscapeFilter {
  #lastAt = Number.NEGATIVE_INFINITY;
  #held = false;
  #pending: unknown;

  constructor(
    private readonly deliver: (data: string) => void,
    private readonly timers: EscapeTimers = REAL_TIMERS,
  ) {}

  press(data: string): void {
    const at = this.timers.now();
    const gap = at - this.#lastAt;
    this.#lastAt = at;
    if (isKeyRepeat(data)) return;
    if (this.#held) {
      if (gap <= HELD_GAP_MS) return;
      this.#held = false;
    }
    if (this.#pending !== undefined) {
      // A second Escape while the first one waits: neither was a tap.
      this.timers.clear(this.#pending);
      this.#pending = undefined;
      this.#held = true;
      return;
    }
    if (gap > REPEAT_WINDOW_MS) {
      this.deliver(data);
      return;
    }
    this.#pending = this.timers.set(() => {
      this.#pending = undefined;
      this.deliver(data);
    }, CONFIRM_MS);
  }

  dispose(): void {
    if (this.#pending !== undefined) this.timers.clear(this.#pending);
    this.#pending = undefined;
  }
}

/** True for the Escape key being pressed (not released), as the terminal spelled it. */
export function isEscapePress(data: string): boolean {
  return matchesKey(data, "escape") && !isKeyRelease(data);
}

/**
 * A terminal whose Escape is filtered before any screen sees it.
 *
 * Wrapping the terminal, rather than listening on the screen, is what lets a held key be
 * dropped and a tap be delivered a moment late: the screens only ever see what comes out.
 */
export function withEscapeFilter(inner: Terminal, timers?: EscapeTimers): Terminal {
  let filter: EscapeFilter | undefined;
  return {
    start(onInput, onResize) {
      filter?.dispose();
      filter = new EscapeFilter(onInput, timers);
      inner.start((data) => (isEscapePress(data) ? filter!.press(data) : onInput(data)), onResize);
    },
    stop() {
      filter?.dispose();
      inner.stop();
    },
    drainInput: (maxMs, idleMs) => inner.drainInput(maxMs, idleMs),
    write: (data) => inner.write(data),
    get columns() { return inner.columns; },
    get rows() { return inner.rows; },
    get kittyProtocolActive() { return inner.kittyProtocolActive; },
    moveBy: (lines) => inner.moveBy(lines),
    hideCursor: () => inner.hideCursor(),
    showCursor: () => inner.showCursor(),
    clearLine: () => inner.clearLine(),
    clearFromCursor: () => inner.clearFromCursor(),
    clearScreen: () => inner.clearScreen(),
    setTitle: (title) => inner.setTitle(title),
    setProgress: (active) => inner.setProgress(active),
  };
}
