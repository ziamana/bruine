import type { Component } from "@earendil-works/pi-tui";
import stringWidth from "string-width";
import { ansi } from "./theme.js";

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionInput {
  id: string;
  question: string;
  header?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
}

export interface QuestionAnswer {
  id: string;
  selected: string[];
  custom?: string;
}

const OTHER_LABEL = "Other…";

/** Chat echo line: `? Which database should I use? → SQLite` (chat clips to width). */
export function echoLine(question: string, answer: string): string {
  return `? ${question} → ${answer}`;
}

function padCells(text: string, width: number): string {
  const w = stringWidth(text);
  if (w >= width) return text;
  return text + " ".repeat(width - w);
}

/**
 * Multi-question form above the editor (T28A). Handles Up/Down/Left/Right,
 * Space (multi), Enter, Esc, and Other… free-text input. Purely keyboard
 * driven; rendered by KumoUi in the notice box (never over chat).
 */
export class QuestionForm implements Component {
  #index = 0;
  #cursor: number[];
  #checked: Array<Set<number>>;
  #otherMode: boolean[];
  #otherText: string[];
  #optionsWithOther: QuestionOption[][];
  onDone?: (answers: QuestionAnswer[] | undefined) => void;
  #done = false;

  constructor(readonly questions: QuestionInput[]) {
    this.#cursor = questions.map(() => 0);
    this.#checked = questions.map(() => new Set<number>());
    this.#otherMode = questions.map(() => false);
    this.#otherText = questions.map(() => "");
    this.#optionsWithOther = questions.map((q) => [...(q.options ?? []), { label: OTHER_LABEL }]);
  }

  get index(): number {
    return this.#index;
  }

  private opts(): QuestionOption[] {
    return this.#optionsWithOther[this.#index]!;
  }

  private isOtherSelected(): boolean {
    return this.#cursor[this.#index] === this.opts().length - 1;
  }

  render(width: number): string[] {
    const q = this.questions[this.#index]!;
    const total = this.questions.length;
    const head = total > 1 ? `? ${q.header ?? "Question"}  ${String(this.#index + 1)}/${String(total)}` : `? ${q.header ?? "Question"}`;
    const lines = [ansi.cyan(head), q.question, ""];
    const opts = this.opts();
    const labelW = Math.max(...opts.map((o) => stringWidth(o.label)));
    opts.forEach((o, i) => {
      const cursor = i === this.#cursor[this.#index] ? "› " : "  ";
      if (q.multiSelect === true && o.label !== OTHER_LABEL) {
        const mark = this.#checked[this.#index]!.has(i) ? "[x] " : "[ ] ";
        const desc = o.description !== undefined ? `   ${ansi.dim(o.description)}` : "";
        lines.push(`${cursor}${mark}${padCells(o.label, labelW)}${desc}`);
      } else if (o.label === OTHER_LABEL && this.#otherMode[this.#index] === true) {
        lines.push(`${cursor}${o.label} ${this.#otherText[this.#index]!}_`);
      } else {
        const desc = o.description !== undefined ? `   ${ansi.dim(o.description)}` : "";
        lines.push(`${cursor}${padCells(o.label, labelW)}${desc}`);
      }
    });
    lines.push("", ansi.dim("↑↓ move · Enter choose · Space toggle (multi) · Esc skip"));
    // Same 2-column left padding as the chat transcript (T28b.5).
    return lines.map((l) => `  ${l}`.slice(0, Math.max(3, width)));
  }

  invalidate(): void {}

  private currentAnswer(): QuestionAnswer {
    const q = this.questions[this.#index]!;
    const opts = this.#optionsWithOther[this.#index]!;
    if (this.#otherMode[this.#index] === true && this.#otherText[this.#index]!.trim() !== "") {
      return { id: q.id, selected: [], custom: this.#otherText[this.#index]!.trim() };
    }
    if (q.multiSelect === true) {
      const labels = [...this.#checked[this.#index]!]
        .sort((a, b) => a - b)
        .map((i) => opts[i]!.label)
        .filter((l) => l !== OTHER_LABEL);
      return { id: q.id, selected: labels };
    }
    const chosen = opts[this.#cursor[this.#index]!]!;
    if (chosen.label === OTHER_LABEL) return { id: q.id, selected: [], custom: "" };
    return { id: q.id, selected: [chosen.label] };
  }

  private allAnswers(): QuestionAnswer[] {
    return this.questions.map((q, i) => {
      const opts = this.#optionsWithOther[i]!;
      if (this.#otherMode[i] === true && this.#otherText[i]!.trim() !== "") {
        return { id: q.id, selected: [], custom: this.#otherText[i]!.trim() };
      }
      if (q.multiSelect === true) {
        const labels = [...this.#checked[i]!]
          .sort((a, b) => a - b)
          .map((k) => opts[k]!.label)
          .filter((l) => l !== OTHER_LABEL);
        return { id: q.id, selected: labels };
      }
      const c = this.#cursor[i]!;
      const chosen = opts[c]!;
      if (chosen.label === OTHER_LABEL) return { id: q.id, selected: [], custom: "" };
      return { id: q.id, selected: [chosen.label] };
    });
  }

  handleInput(data: string): void {
    if (this.#done) return;
    const finish = (answers: QuestionAnswer[] | undefined): void => {
      if (this.#done) return;
      this.#done = true;
      this.onDone?.(answers);
    };
    // Escape: skip all (tool gets clear skipped answer, never hangs).
    if (data === "\x1b") {
      finish(
        this.questions.map((q) => ({ id: q.id, selected: [], custom: "skipped by the user" })),
      );
      return;
    }
    const q = this.questions[this.#index]!;
    const opts = this.opts();
    // Other… free-text input mode.
    if (this.#otherMode[this.#index] === true) {
      if (data === "\r" || data === "\n") {
        if (this.#index < this.questions.length - 1) {
          this.#index += 1;
        } else {
          finish(this.allAnswers());
        }
        return;
      }
      if (data === "\x7f" || data === "\b") {
        this.#otherText[this.#index] = this.#otherText[this.#index]!.slice(0, -1);
        return;
      }
      if (data.startsWith("\x1b")) return;
      for (const ch of data) {
        if ((ch.codePointAt(0) ?? 0) >= 32) this.#otherText[this.#index] += ch;
      }
      return;
    }
    if (data === "\x1b[A" || data === "\x10") {
      this.#cursor[this.#index] = Math.max(0, this.#cursor[this.#index]! - 1);
      return;
    }
    if (data === "\x1b[B" || data === "\x0e") {
      this.#cursor[this.#index] = Math.min(opts.length - 1, this.#cursor[this.#index]! + 1);
      return;
    }
    if (data === "\x1b[C") {
      if (this.#index < this.questions.length - 1) this.#index += 1;
      return;
    }
    if (data === "\x1b[D") {
      if (this.#index > 0) this.#index -= 1;
      return;
    }
    if (data === " ") {
      if (q.multiSelect === true && !this.isOtherSelected()) {
        const c = this.#cursor[this.#index]!;
        if (this.#checked[this.#index]!.has(c)) this.#checked[this.#index]!.delete(c);
        else this.#checked[this.#index]!.add(c);
      }
      return;
    }
    if (data === "\r" || data === "\n") {
      if (this.isOtherSelected()) {
        this.#otherMode[this.#index] = true;
        return;
      }
      if (this.#index < this.questions.length - 1) {
        this.#index += 1;
      } else {
        finish(this.allAnswers());
      }
    }
  }
}
