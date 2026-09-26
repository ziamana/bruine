/**
 * T57 — the reveal: text that arrives faster than anybody can read it.
 *
 * A local model on a 3070 pushes 60 to 200 tokens a second. Rendering each
 * delta as it lands is not streaming, it is a seizure: the paragraph restarts
 * its markdown layout dozens of times a second and the eye never catches the
 * line it is on. The text is already all here. This keeps the arrival and the
 * display apart, and hands out the characters at a rate a person can follow.
 *
 * Four rules, each one a bug this had before:
 *
 * - **Catch up, do not crawl.** A fixed characters-per-tick rate would make a
 *   fast model feel broken, because the backlog would grow without bound. The
 *   step is a fraction of the backlog, so the lag settles around a fifth of a
 *   second whatever the speed, and a slow model still moves.
 * - **A grapheme is atomic.** A split surrogate pair or a lone combining mark
 *   is a replacement character on screen for one frame, so a step that lands
 *   inside a character takes the whole character with it.
 * - **Never show half a markdown marker for long.** `**bo` with the closing
 *   `**` still in the buffer paints two literal asterisks, and the reader sees
 *   a typo nobody typed. The reveal waits, for a bounded number of ticks.
 * - **Never stop.** Every guard here has a budget, because a guard that can
 *   wait forever is a freeze: a marker sitting exactly at the frontier can only
 *   be held by not moving.
 */

import { terminalMotionAllowed } from "./logo-motion.js";
import type { KumoIcons } from "../render/chars.js";

/** 25 frames a second: smooth to the eye, well above pi-tui's 16 ms repaint floor. */
const REVEAL_INTERVAL_MS = 40;
/** Fraction of the backlog handed out per tick. Sets the steady-state lag. */
const REVEAL_CATCH_UP = 0.18;
/** A slow model still gets movement, one grapheme at a time. */
const REVEAL_FLOOR = 1;
/**
 * How far past a dangling marker the frontier may get before the guard gives up
 * on it. A lone "*" in prose is never closed by anything, and the window is
 * what lets the text go anyway.
 */
const DELIMITER_WINDOW = 48;
/**
 * Ticks the guard may spend on one marker, about 160 ms at the default
 * interval. After that the marker goes out as the literal characters it is,
 * which is what every other streaming CLI shows, and the answer keeps moving.
 */
const MARKER_HOLD_TICKS = 4;
/** Cluster lookahead, so the segmenter is never handed half a character. */
const CLUSTER_LOOKAHEAD = 8;

const SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Markers that change meaning when they are only half written. */
const DELIMITERS = ["```", "**", "__", "~~", "*", "_", "`", "[", "("] as const;

/**
 * Where a step of at most `limit` code units really ends.
 *
 * The cluster the limit landed inside is taken whole rather than refused:
 * refusing it parks the frontier, and a parked frontier in the middle of a
 * two-code-unit emoji is the half character this exists to prevent.
 */
function graphemeCut(text: string, from: number, limit: number): number {
  if (limit >= text.length) return text.length;
  const slice = text.slice(from, limit + CLUSTER_LOOKAHEAD);
  let cut = from;
  for (const segment of SEGMENTER.segment(slice)) {
    const end = from + segment.index + segment.segment.length;
    if (end > limit) return Math.min(end, text.length);
    cut = end;
  }
  // A cluster longer than the lookahead: a ZWJ chain, a long combining run.
  // One code unit of progress beats none.
  return cut > from ? cut : Math.min(text.length, from + 1);
}

/** How many times `needle` appears in `head`, ignoring escaped ones. */
function countUnescaped(head: string, needle: string): number {
  let count = 0;
  for (let at = head.indexOf(needle); at !== -1; at = head.indexOf(needle, at + needle.length)) {
    if (head.at(at - 1) === "\\") continue;
    count += 1;
  }
  return count;
}

export interface TypewriterOptions {
  /**
   * Called after every step that changed the visible text. Left out, nothing is
   * held back: that is the disabled path, and the one CI takes.
   */
  onTick?: () => void;
  /**
   * The two clock seams, so a test can drive time instead of waiting for it. The
   * cadence and the share of the backlog are policy, not configuration: a knob
   * nobody turns is a knob nobody tests.
   */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export class Typewriter {
  #buffer = "";
  /** Code units of the buffer already on screen. Always a grapheme boundary. */
  #shown = 0;
  #timer: unknown;
  /** The marker the reveal is waiting on, and how many ticks it has cost. */
  #heldAt: number | undefined;
  #heldTicks = 0;
  #onTick: (() => void) | undefined;
  readonly #intervalMs: number;
  readonly #catchUp: number;
  readonly #floor: number;
  readonly #setTimer: (fn: () => void, ms: number) => unknown;
  readonly #clearTimer: (handle: unknown) => void;

  constructor(opts: TypewriterOptions = {}) {
    this.#onTick = opts.onTick;
    this.#intervalMs = REVEAL_INTERVAL_MS;
    this.#catchUp = REVEAL_CATCH_UP;
    this.#floor = REVEAL_FLOOR;
    this.#setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.#clearTimer = opts.clearTimer ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
  }

  /** True when text is being held back, so a repaint is worth asking for. */
  get animating(): boolean {
    return this.#shown < this.#buffer.length;
  }

  /** How much is waiting. */
  get pending(): number {
    return this.#buffer.length - this.#shown;
  }

  /** What to paint: the whole answer when nothing is held back. */
  get text(): string {
    return this.#buffer.slice(0, this.#shown);
  }

  push(delta: string): void {
    if (delta === "") return;
    this.#buffer += delta;
    // No repaint hook means nobody is watching: this is the disabled path, and
    // it has to behave exactly like the unbuffered renderer it replaces.
    if (this.#onTick === undefined) {
      this.#shown = this.#buffer.length;
      return;
    }
    this.#arm();
  }

  /** One step. Exposed so a test can drive time instead of waiting for it. */
  tick(): void {
    if (!this.animating) {
      this.#disarm();
      return;
    }
    const step = Math.max(this.#floor, Math.ceil(this.pending * this.#catchUp));
    const limit = Math.min(this.#buffer.length, this.#shown + step);
    const wait = this.#holdAt(limit);
    const next = wait ?? graphemeCut(this.#buffer, this.#shown, limit);
    if (next <= this.#shown) {
      // Waiting on a marker, or the step landed on nothing new. Sleeping is the
      // right answer: the next delta either frees the reveal or the budget runs
      // out. Spinning here would burn a frame 25 times a second to find nothing.
      this.#disarm();
      return;
    }
    this.#shown = next;
    this.#onTick?.();
    if (this.animating) this.#arm();
    else this.#disarm();
  }

  /** Everything, now. Called on finish, on abort and before a re-render. */
  flush(): void {
    this.#shown = this.#buffer.length;
    this.#heldAt = undefined;
    this.#heldTicks = 0;
    this.#disarm();
  }

  dispose(): void {
    this.#disarm();
    this.#onTick = undefined;
  }

  /**
   * Where to wait instead of advancing, or undefined to go ahead.
   *
   * The pairing is judged on the revealed prefix, because the prefix is what
   * the reader sees: "**b" whose pair is two characters further along the buffer
   * still paints two literal asterisks.
   */
  #holdAt(limit: number): number | undefined {
    const cut = graphemeCut(this.#buffer, this.#shown, limit);
    const head = this.#buffer.slice(0, cut);
    let waiting: number | undefined;
    for (const needle of DELIMITERS) {
      if (countUnescaped(head, needle) % 2 !== 1) continue;
      const at = head.lastIndexOf(needle);
      // Already on screen, or too old to be the one being typed.
      if (at < this.#shown) continue;
      if (cut - at > DELIMITER_WINDOW) continue;
      if (this.#heldAt === at) {
        if (this.#heldTicks < MARKER_HOLD_TICKS) {
          this.#heldTicks += 1;
          waiting = at;
        }
        // Budget spent: fall through and let the marker out as typed.
      } else {
        this.#heldAt = at;
        this.#heldTicks = 0;
        waiting = at;
      }
      break;
    }
    if (waiting === undefined) {
      this.#heldAt = undefined;
      this.#heldTicks = 0;
    }
    return waiting;
  }

  #arm(): void {
    if (this.#timer !== undefined || this.#onTick === undefined) return;
    this.#timer = this.#setTimer(() => {
      this.#timer = undefined;
      this.tick();
    }, this.#intervalMs);
    // A half-revealed answer must never be the reason the process stays alive.
    (this.#timer as { unref?: () => void }).unref?.();
  }

  #disarm(): void {
    if (this.#timer === undefined) return;
    this.#clearTimer(this.#timer);
    this.#timer = undefined;
  }
}

/**
 * T57: whether this session may animate at all.
 *
 * The same gate as the wordmark and the Working dots, so one switch turns off
 * every moving thing in kumo: `KUMO_NO_ANIMATION=1`, plus CI, a dumb terminal,
 * a non-tty stdout and KUMO_ASCII, which all mean the same thing.
 */
export function revealAllowed(icons: KumoIcons, env: NodeJS.ProcessEnv = process.env): boolean {
  return terminalMotionAllowed({ ascii: icons.think === "*", env });
}
