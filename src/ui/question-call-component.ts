import type { Component } from "@earendil-works/pi-tui";
import { kumoIcons, type KumoIcons } from "../render/chars.js";
import { clipCells, sanitize, spinnerFrame } from "../render/reasoning.js";
import type { RailState } from "./chat-layout.js";
import { parsePartialJson } from "./partial-json.js";
import type { QuestionAnswer, QuestionInput, QuestionOption } from "./questions.js";
import { ansi } from "./theme.js";
import type { ChatToolCall } from "./tool-call-component.js";

/**
 * The model's `ask_user_question` call, drawn in the chat from the first byte.
 *
 * The arguments stream in, and a question is usually the longest thing a model
 * writes in one go, so the call used to be silent for seconds and then a form
 * appeared from nowhere. Here the question and its options are read out of the
 * partial JSON as they arrive, the call says it is waiting once they are complete,
 * and the user's answers settle it into the record of what was asked and chosen.
 */
export class QuestionCallComponent implements ChatToolCall, Component {
  readonly tool = "ask_user_question";
  #raw = "";
  #start: number;
  #answers: QuestionAnswer[] | undefined;
  #ended: { ok: boolean; note?: string } | undefined;
  constructor(
    private now: () => number = Date.now,
    private icons: KumoIcons = kumoIcons(),
  ) {
    this.#start = now();
  }

  get active(): boolean { return this.#ended === undefined; }
  get rail(): RailState { return this.#ended === undefined ? "active" : this.#ended.ok ? "blue" : "red"; }
  get doneOk(): boolean | undefined { return this.#ended?.ok; }
  get seconds(): number | undefined { return this.#ended === undefined ? undefined : (this.now() - this.#start) / 1000; }
  args(delta: string): void { this.#raw += delta; }
  /** The durable event replaces streamed JSON, it must never be appended twice. */
  setArgs(json: string): void { this.#raw = json; }
  touchedPath(): string | undefined { return undefined; }
  summary(width = 60): string {
    const first = this.#questions()[0]?.question ?? "";
    return clipCells(sanitize(first).replace(/\n/g, " "), Math.max(1, width), this.icons.think === "*" ? "..." : "…");
  }

  /** What the user picked in the form shown for these questions. */
  answer(answers: QuestionAnswer[]): void {
    if (this.#ended !== undefined) return;
    this.#answers = answers;
    this.#ended = { ok: true };
  }
  /** The tool's own result: it only settles a call nobody answered through the form. */
  result(ok: boolean, output: string): void {
    if (this.#ended !== undefined) return;
    this.#ended = ok ? { ok } : { ok, note: sanitize(output).split("\n")[0] ?? "" };
  }
  cancel(): void {
    if (this.#ended === undefined) this.#ended = { ok: false, note: "Cancelled" };
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
      return [{
        id: typeof q.id === "string" ? q.id : String(index),
        question: typeof q.question === "string" ? q.question : "",
        ...(options.length > 0 ? { options } : {}),
        ...(q.multiSelect === true ? { multiSelect: true } : {}),
      }];
    });
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

    const bullets = ascii ? { on: "(*)", off: "( )" } : { on: "●", off: "○" };
    const lines: string[] = [];
    questions.forEach((q, i) => {
      const prefix = i === 0 ? `${lead} ${ansi.text(label)}  ` : " ".repeat(headCells);
      lines.push(`${prefix}${ansi.gray(fit(q.question === "" ? ellipsis : q.question, width - headCells))}`);
      const options = q.options ?? [];
      if (options.length > 0) {
        lines.push(ansi.gray(fit(`  ${String(options.length)} option(s): ${options.map((o) => o.label).join(", ")}`)));
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
