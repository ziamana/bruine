/**
 * T56 — the mouse, as one thing with one owner.
 *
 * This used to be eight fields and seven methods threaded through `KumoUi`, in a
 * file that was already over a thousand lines, for a feature that is entirely
 * separable from the shell: read the reports, hold the gesture, copy on release,
 * say so in the corner, and own the one terminal sequence nobody else writes. All
 * of that lives here, and `KumoUi` keeps two lines: a field, and the input hook.
 *
 * It owns:
 *
 * - **the wanted/on state**, so the terminal sequences are written from one place
 *   and a form can outrank the preference without a second source of truth;
 * - **the gesture**, including the invariant that a drag without a press is not
 *   a selection, which belongs next to the thing that counts;
 * - **the copy**, injected, because a test must never spawn `wl-copy`;
 * - **the controls**, asked before any gesture starts, because a press on a pill is
 *   a command and not the first half of a selection (D5);
 * - **the notices**, both of which name what the choice costs.
 *
 * It does not own the frame. The shell composes the layout and hands over the
 * visible text of a span, because layout is the shell's job and the selection is
 * only paint on top of it.
 */

import { appendFileSync } from "node:fs";
import type { TUI, Terminal } from "@earendil-works/pi-tui";
import { copyFailureNotice, copyNotice, copyTextToClipboard, osc52Sequence, type CopyOutcome } from "./clipboard-write.js";
import {
  DISABLE_MOUSE,
  ENABLE_MOUSE,
  MouseScanner,
  TextSelection,
  type MouseSample,
  type ParsedChunk,
  type SelectionSpan,
} from "./selection.js";
import { ToastHost } from "./toast.js";

/** Where a selection goes. Injected so a test never spawns a clipboard tool. */
export type CopyClipboard = (text: string) => Promise<CopyOutcome>;

/** T56: what `/mouse` says, and the cost it names rather than hides. */
export const MOUSE_ON_NOTICE =
  "Mouse selection on: drag to select, release to copy. The wheel scrolls kumo's transcript window, so the input bar stays put.";
export const MOUSE_OFF_NOTICE =
  "Mouse selection off: the wheel scrolls the terminal's scrollback again, input bar and all, and dragging selects nothing.";

/**
 * T56: the wheel notice. It names the cost and the way out, because a transcript
 * that will not scroll with no word is indistinguishable from a broken app.
 */
export const WHEEL_NOTICE =
  "The wheel needs the app's transcript window and this session has none. /mouse off gives the wheel back to the terminal.";

/**
 * What the input hook needs to know about one chunk.
 */
export interface MouseRead extends ParsedChunk {
  /** True when the chunk was for the mouse, so it must not reach the editor. */
  handled: boolean;
}

/**
 * A control the mouse owns instead of the selection.
 *
 * D5: a press on the jump-to-latest pill is a command, not the first half of a
 * drag. The gesture must not begin there, and nothing must be copied when it ends:
 * a pill is not text anybody meant to select, and a selection that starts on it and
 * drags across a paragraph is the one gesture that copies by accident.
 *
 * The control answers for itself (`hit`) and says what the press means (`activate`),
 * because the frame it lives in is the shell's to compose — the same reason
 * `readText` is injected rather than guessed here.
 */
export interface MouseControl {
  hit(row: number, col: number): boolean;
  /** The point that was pressed, so one control can serve several targets. */
  activate(row: number, col: number): void;
}

export interface MouseFeatureOptions {
  tui: TUI;
  terminal: Terminal;
  /** Repaint hook. The feature never draws anything itself. */
  repaint: () => void;
  /** One line above the editor, for the notice a user has to act on. */
  notify: (text: string, opts?: { red?: boolean }) => void;
  /**
   * The visible text of a span, read out of the frame the shell composes. The
   * shell owns the frame; the mapping from a screen row to a line is its answer
   * and not this module's guess.
   */
  readText: (span: SelectionSpan) => string;
  /**
   * Move the app's transcript window, negative up. The wheel's only way to scroll
   * now that kumo owns the window rather than the terminal.
   */
  scroll?: (rows: number) => void;
  /** A press on a control rather than on text (D5: the jump-to-latest pill). */
  control?: MouseControl;
  copy?: CopyClipboard;
  env?: NodeJS.ProcessEnv;
}

export class MouseFeature {
  readonly #scanner = new MouseScanner();
  readonly #selection = new TextSelection();
  readonly #toast: ToastHost;
  readonly #terminal: Terminal;
  readonly #repaint: () => void;
  readonly #notify: (text: string, opts?: { red?: boolean }) => void;
  readonly #readText: (span: SelectionSpan) => string;
  readonly #scroll: ((rows: number) => void) | undefined;
  readonly #control: MouseControl | undefined;
  readonly #copy: CopyClipboard;
  readonly #trace: string | undefined;
  #wanted: boolean;
  #on = false;
  #formsUp = false;
  /** The wheel has already been explained, so it is not explained twice. */
  #wheelExplained = false;
  #closed = false;

  constructor(opts: MouseFeatureOptions) {
    this.#terminal = opts.terminal;
    this.#repaint = opts.repaint;
    this.#notify = opts.notify;
    this.#readText = opts.readText;
    this.#scroll = opts.scroll;
    this.#control = opts.control;
    this.#toast = new ToastHost(opts.tui);
    const env = opts.env ?? process.env;
    this.#wanted = mouseSelectionAllowed(env);
    this.#trace = mouseTracePath(env);
    this.#copy =
      opts.copy ??
      // The escape is the last resort, and only the owner of the terminal can
      // write it, so the default lives here and not in the writer module.
      ((text) => copyTextToClipboard(text, { osc52: (value) => this.#terminal.write(osc52Sequence(value)) }));
  }

  /** Whether the session wants the mouse. A form can still say no. */
  get wanted(): boolean {
    return this.#wanted;
  }

  /** The live selection, for the shell to paint. */
  get span(): SelectionSpan | undefined {
    return this.#selection.span;
  }

  /** Ask for the mouse. Called once, at startup. */
  start(): void {
    this.#apply();
  }

  /** Give it back, whatever was in flight. Called at shutdown. */
  stop(): void {
    this.#closed = true;
    this.#toast.hide();
    this.#set(false);
  }

  /**
   * One input chunk, and what is left of it for the shell to route as keys.
   *
   * `handled` covers a chunk carrying half a report as well: those bytes are
   * held for the next read, so forwarding them would put escape noise in the
   * prompt and dropping them would lose the gesture.
   */
  read(chunk: string): MouseRead {
    mouseTrace(this.#trace, chunk);
    const parsed = this.#scanner.read(chunk);
    if (parsed.samples.length === 0 && !parsed.held) return { ...parsed, handled: false };
    // The state is authoritative: a report is only ours to act on when the
    // terminal was asked for one. A terminal that sends them unbidden, or an
    // enable left over from a previous run, must not steer the transcript.
    if (this.#on) this.#act(parsed.samples);
    return { ...parsed, handled: true };
  }

  /**
   * A form owns the screen, so the terminal gets its mouse back.
   *
   * The wheel and the native selection belong to the terminal, and a form is
   * exactly the moment the user wants them: they are reading what came before in
   * order to answer it. A press inside a form cannot select anything either, so
   * the gesture there was dead weight that made the mouse feel frozen.
   */
  setFormsUp(up: boolean): void {
    if (up === this.#formsUp) return;
    this.#formsUp = up;
    this.#apply();
  }

  /**
   * `/mouse`. Copies by dragging, or the wheel back: the two cannot both have
   * the mouse on a main-screen TUI, and pretending otherwise would be a promise
   * the code cannot keep.
   */
  toggle(want?: boolean): string {
    this.#wanted = want ?? !this.#wanted;
    this.#apply();
    if (!this.#wanted) return MOUSE_OFF_NOTICE;
    return this.#on ? MOUSE_ON_NOTICE : `${MOUSE_ON_NOTICE} (a form is up, so the terminal keeps it for now)`;
  }

  #act(samples: readonly MouseSample[]): void {
    for (const sample of samples) {
      if (sample.phase === "wheel") {
        this.#onWheel(sample.wheelDelta ?? 0);
        continue;
      }
      if (sample.phase === "press") {
        // D5: a control owns its own press. No gesture starts on it, so no
        // selection is painted, and a release that follows the press finds nothing
        // to copy — the press was a command, and it has already been run.
        if (this.#control?.hit(sample.row, sample.col) === true) {
          this.#control.activate(sample.row, sample.col);
          this.#repaint();
          continue;
        }
        this.#selection.press(sample.row, sample.col);
        this.#repaint();
        continue;
      }
      if (sample.phase === "drag") {
        this.#selection.drag(sample.row, sample.col);
        this.#repaint();
        continue;
      }
      const span = this.#selection.release();
      this.#repaint();
      if (span !== undefined) this.#copySelection(span);
    }
  }

  /** T56: the text under the selection, then the clipboard, then the corner. */
  async #copySelection(span: SelectionSpan): Promise<void> {
    if (this.#closed) return;
    const text = this.#readText(span);
    // A selection of nothing but spaces is not worth a notice.
    if (text === "") return;
    const outcome = await this.#copy(text);
    if (outcome.ok) this.#toast.show(copyNotice(text, outcome.via), "good");
    else this.#toast.show(copyFailureNotice(outcome.reason, outcome.install), "bad");
  }

  /**
   * T56: the wheel, and what it moves.
   *
   * It could not scroll, and the reason was never a missing feature in kumo: on the
   * main screen the scrollback belongs to the terminal, holding the mouse takes the
   * wheel away from it, and the app cannot move the terminal's cursor itself.
   * `TuiMainScreen` tracks the hardware cursor and repaints by relative movement,
   * so a cursor moved behind its back desyncs every later partial update, and the
   * only re-sync it offers (`renderNow(true)`) erases the scrollback it was meant
   * to preserve (`tui-main-screen.js:244`).
   *
   * What changed is the frame, not the terminal: the shell now owns a transcript
   * window (`shell.ts`), so a wheel notch scrolls a window kumo is painting and the
   * composer stays on the last row. A shell with no window behind it (an old one,
   * a form) still cannot scroll, and then the notice is the whole of it.
   */
  #onWheel(delta: number): void {
    if (this.#scroll !== undefined) {
      this.#scroll(delta);
      return;
    }
    if (this.#wheelExplained) return;
    this.#wheelExplained = true;
    this.#notify(WHEEL_NOTICE, { red: true });
  }

  #apply(): void {
    this.#set(this.#wanted && !this.#formsUp && !this.#closed);
  }

  /** The one place that writes the mouse sequences. */
  #set(on: boolean): void {
    if (on === this.#on) return;
    this.#on = on;
    this.#terminal.write(on ? ENABLE_MOUSE : DISABLE_MOUSE);
    if (on) return;
    // Only turning it off has something to repaint: a half-painted selection has
    // to go. Turning it on changes nothing that is on screen, and a repaint here
    // would be one more frame for every key the user presses.
    this.#scanner.reset();
    this.#selection.clear();
    this.#repaint();
  }
}

/**
 * T56: whether this session may take the mouse at all.
 *
 * Taking the mouse has one real cost: the wheel goes with it. So this is a
 * switch, not a constant, and the user can flip it mid-session.
 */
export function mouseSelectionAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env["KUMO_MOUSE_SELECT"] ?? "").trim().toLowerCase();
  return value !== "0" && value !== "off" && value !== "no" && value !== "false";
}

/**
 * T56: optional raw trace, for when "the mouse works one time in ten" comes back
 * and the only way to know why is what the terminal actually sent.
 *
 * `KUMO_MOUSE_DEBUG=/path/to/file` appends every chunk that looks like a mouse
 * report, JSON-escaped, one per line. Off unless the variable is set, and a
 * failure to write is swallowed: a diagnostic must never be the reason the UI
 * stops.
 */
export function mouseTrace(path: string | undefined, chunk: string): void {
  if (path === undefined || path === "") return;
  if (!chunk.includes("\x1b[<") && !chunk.includes("\x1b[M")) return;
  try {
    appendFileSync(path, `${JSON.stringify(chunk)}\n`, "utf8");
  } catch {
    // best effort, on purpose
  }
}

/** The trace path, if the user asked for one. */
export function mouseTracePath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env["KUMO_MOUSE_DEBUG"];
  return value === undefined || value.trim() === "" ? undefined : value;
}
