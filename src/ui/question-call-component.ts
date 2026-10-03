import type { Component } from "@earendil-works/pi-tui";
import { kumoIcons, type KumoIcons } from "../render/chars.js";
import { clipCells, sanitize, spinnerFrame } from "../render/reasoning.js";
import type { RailState } from "./chat-layout.js";
import { parsePartialJson } from "./partial-json.js";
import type { QuestionAnswer, QuestionInput, QuestionOption } from "./questions.js";
import { ansi } from "./theme.js";
import { revealAllowed, Typewriter, type TypewriterOptions } from "./typewriter.js";
import type { ChatToolCall } from "./tool-call-component.js";

export interface QuestionCallOptions {
  /** Repaint hook. Left out, the call is never held back. */
  onTick?: () => void;
  /** Overrides the motion gate (no tty, CI, KUMO_ASCII, KUMO_NO_ANIMATION). */
  animate?: boolean;
  typewriter?: TypewriterOptions;
}

/**
 * The model's `ask_user_question` call, drawn in the chat from the first byte.
 *
 * The arguments stream in, and a question is usually the longest thing a model
 * writes in one go, so the call used to be silent for seconds and then a form
 * appeared from nowhere. Here the question and its options are read out of the
 * partial JSON as they arrive, the call says it is waiting once they are complete,
 * and the user's answers settle it into the record of what was asked and chosen.
 *
 * Two things were still missing from that, and both are about the wait:
 *
 * - The text arrives in model-sized pieces, so it used to jump on screen from one
 *   delta to the next — a question read in three jumps is three questions. It goes
 *   through the same reveal the answer does (T57), at reading speed, so the call is
 *   watched being written instead of being caught mid-sentence.
 * - The keys before the question (`{"questions":[{"id":…,"header":…`) are a third
 *   of the arguments and carry nothing to read, so the row said nothing at all
 *   through them. The header is short and lands first: it is what the row can say
 *   while the question itself is still being written.
 */
export class QuestionCallComponent implements ChatToolCall, Component {
  readonly tool = "ask_user_question";
  #raw = "";
  #start: number;
  #answers: QuestionAnswer[] | undefined;
  #ended: { ok: boolean; note?: string } | undefined;
  #tws: Typewriter[] = [];
  /** What each reveal was last handed: a live line only ever grows. */
  #fed: string[] = [];
  readonly #onTick: (() => void) | undefined;
  readonly #typewriter: TypewriterOptions;

  constructor(
    private now: () => number = Date.now,
    private icons: KumoIcons = kumoIcons(),
    opts: QuestionCallOptions = {},
  ) {
    this.#start = now();
    const animate = opts.animate ?? revealAllowed(icons);
    // The repaint hook is the switch: with one, the reveal owns the painting.
    this.#onTick = animate && opts.onTick !== undefined ? opts.onTick : undefined;
    this.#typewriter = opts.typewriter ?? {};
  }

  get active(): boolean { return this.#ended === undefined; }
  get rail(): RailState { return this.#ended === undefined ? "active" : this.#ended.ok ? "blue" : "red"; }
  get doneOk(): boolean | undefined { return this.#ended?.ok; }
  get seconds(): number | undefined { return this.#ended === undefined ? undefined : (this.now() - this.#start) / 1000; }
  args(delta: string): void {
    this.#raw += delta;
    this.#reveal();
  }
  /** The durable event replaces streamed JSON, it must never be appended twice. */
  setArgs(json: string): void {
    this.#raw = json;
    this.#reveal();
  }
  touchedPath(): string | undefined { return undefined; }
  summary(width = 60): string {
    const first = this.#questions()[0]?.question ?? "";
    return clipCells(sanitize(first).replace(/\n/g, " "), Math.max(1, width), this.icons.think === "*" ? "..." : "…");
  }

  /** What the user picked in the form shown for these questions. */
  answer(answers: QuestionAnswer[]): void {
    if (this.#ended !== undefined) return;
    this.#settle();
    this.#answers = answers;
    this.#ended = { ok: true };
  }
  /** The tool's own result: it only settles a call nobody answered through the form. */
  result(ok: boolean, output: string): void {
    if (this.#ended !== undefined) return;
    this.#settle();
    this.#ended = ok ? { ok } : { ok, note: sanitize(output).split("\n")[0] ?? "" };
  }
  cancel(): void {
    if (this.#ended === undefined) {
      this.#settle();
      this.#ended = { ok: false, note: "Cancelled" };
    }
  }

  /** Nothing may stay hidden once the call is over: a record that reads short is a lie. */
  #settle(): void {
    for (const tw of this.#tws) tw.flush();
  }

  /**
   * Hand every line's reveal what the partial JSON says now, and nothing twice.
   *
   * One reveal per line, because a line is what grows: the question text and the
   * option summary both arrive a piece at a time, and each one only ever extends
   * what is already on screen. A shared buffer would restart the question from its
   * first word every time the option count changed, which reads as a glitch.
   */
  #reveal(): void {
    const lines = this.#liveLines();
    while (this.#tws.length < lines.length) {
      this.#tws.push(new Typewriter({ ...this.#typewriter, onTick: this.#onTick }));
      this.#fed.push("");
    }
    lines.forEach((line, i) => {
      const tw = this.#tws[i]!;
      const fed = this.#fed[i] ?? "";
      if (line === fed) return;
      // A durable event can replace the streamed arguments with the whole JSON:
      // that text is not an extension of what is on screen, and the reveal of
      // this line starts again rather than continuing.
      if (line.startsWith(fed)) tw.push(line.slice(fed.length));
      else tw.reset(line);
      this.#fed[i] = line;
    });
    this.#tws.length = lines.length;
    this.#fed.length = lines.length;
    // Complete arguments mean nothing more is coming, and a reveal that is still
    // typing has nothing left to wait for: it shows what it has. The reveal parks
    // on an unbalanced `(` — `3 option(s)` has one — until another delta frees it,
    // and no delta comes once the call is whole.
    if (this.#complete()) this.#settle();
  }

  /** The questions the arguments describe so far; whatever has not arrived is absent. */
  #questions(): QuestionInput[] {
    const parsed = parsePartialJson(this.#raw);
    const list = (parsed as { questions?: unknown } | undefined)?.questions;
    if (!Array.isArray(list)) return [];
    return list.flatMap((item, index): QuestionInput[] => {
      if (item === null || typeof item !== "object") return [];
      const q = item as Record<string, unknown>;
      const options = Array.isArray(q.options)
        ? q.options.flatMap((o): QuestionOption[] => {
            const opt = o as Record<string, unknown> | null;
            if (opt === null || typeof opt !== "object" || typeof opt.label !== "string") return [];
            return [typeof opt.description === "string" ? { label: opt.label, description: opt.description } : { label: opt.label }];
          })
        : [];
      const header = typeof q.header === "string" && q.header.trim() !== "" ? q.header : undefined;
      return [{
        id: typeof q.id === "string" ? q.id : String(index),
        question: typeof q.question === "string" ? q.question : "",
        ...(header !== undefined ? { header } : {}),
        ...(options.length > 0 ? { options } : {}),
        ...(q.multiSelect === true ? { multiSelect: true } : {}),
      }];
    });
  }

  /**
   * The live call, one line at a time: the question (or its header, while the
   * question is still arriving), then the options it offers.
   *
   * The line count is the layout's own: `render` walks the same questions in the
   * same order, so a line sits at the same index on both sides even mid-stream.
   */
  #liveLines(): string[] {
    const lines: string[] = [];
    for (const q of this.#questions()) {
      const text = q.question.trim();
      lines.push(text === "" ? (q.header ?? "") : text);
      const options = q.options ?? [];
      if (options.length > 0) lines.push(`  ${String(options.length)} option(s): ${options.map((o) => o.label).join(", ")}`);
    }
    return lines;
  }

  #complete(): boolean {
    try {
      JSON.parse(this.#raw);
      return true;
    } catch {
      return false;
    }
  }

  render(width: number): string[] {
    const ascii = this.icons.think === "*";
    const ellipsis = ascii ? "..." : "…";
    const fit = (text: string, cells = width): string => clipCells(sanitize(text).replace(/\n/g, " "), Math.max(1, cells), ellipsis);
    const questions = this.#questions();
    const lead = this.#ended === undefined
      ? ansi.cyan(spinnerFrame(this.now() - this.#start, this.icons))
      : this.#ended.ok ? ansi.green(this.icons.ok) : ansi.red(this.icons.fail);
    const label = "ask_user";
    // The mark, a space, the tool name and two spaces come before the question.
    const headCells = 1 + 1 + label.length + 2;
    if (questions.length === 0) return [`${lead} ${ansi.text(label)}  ${ansi.gray(ellipsis)}`];

    // What each line's reveal has handed out so far, at the index the layout uses.
    const revealed = (i: number): string => this.#tws[i]?.text ?? "";
    const bullets = ascii ? { on: "(*)", off: "( )" } : { on: "●", off: "○" };
    const lines: string[] = [];
    let at = 0;
    questions.forEach((q, i) => {
      const prefix = i === 0 ? `${lead} ${ansi.text(label)}  ` : " ".repeat(headCells);
      const asked = revealed(at++);
      lines.push(`${prefix}${ansi.gray(fit(asked === "" ? ellipsis : asked, width - headCells))}`);
      const options = q.options ?? [];
      if (options.length > 0) {
        const summary = revealed(at++);
        lines.push(ansi.gray(fit(summary === "" ? ellipsis : summary)));
      }
      const answer = this.#answers?.find((a) => a.id === q.id) ?? this.#answers?.[i];
      if (this.#ended !== undefined && this.#answers !== undefined) {
        const text = answer === undefined ? "" : [...answer.selected, ...(answer.custom !== undefined && answer.custom !== "" ? [answer.custom] : [])].join(", ");
        lines.push(text === "" ? ansi.gray("skipped") : ansi.violet(fit(`${this.icons.ok} ${text}`)));
        lines.push(ansi.gray(fit(`Q: ${q.question}`)));
        if (options.length > 0) {
          lines.push(ansi.gray("Options:"));
          for (const o of options) {
            const chosen = answer?.selected.includes(o.label) === true;
            const rest = fit(`${o.label}${o.description !== undefined ? ` - ${o.description}` : ""}`, width - 6);
            lines.push(`  ${chosen ? ansi.green(bullets.on) : ansi.faint(bullets.off)} ${chosen ? ansi.text(rest) : ansi.gray(rest)}`);
          }
        }
      }
    });
    if (this.#ended === undefined && this.#complete()) {
      lines.push(ansi.gray(fit(ascii ? "Waiting for user input..." : "Waiting for user input…")));
    } else if (this.#ended?.ok === false && this.#ended.note !== undefined) {
      lines.push(ansi.red(fit(this.#ended.note)));
    }
    return lines;
  }
  invalidate(): void {}
}
