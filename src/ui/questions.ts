import { isKeyRelease, matchesKey, truncateToWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import pkg from "../../package.json" with { type: "json" };
import stringWidth from "string-width";
import { kumoIcons, type KumoIcons } from "../render/chars.js";
import { ansi } from "./theme.js";
import { boxLine } from "./palette.js";
import { dropLastChar, typedText } from "./keys.js";

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

/**
 * Checkbox marks taken from the icon set (T55). The form used to hardcode `[x]`
 * / `[ ]` in a UI that speaks ✓ ✗ ▍ █ everywhere else, so the one control with a
 * selection state was the only one not drawn in the product's own vocabulary.
 */
export function checkMarks(icons: KumoIcons): { on: string; off: string } {
  return icons.think === "*" ? { on: "[x]", off: "[ ]" } : { on: "◉", off: "○" };
}

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
  #filters: string[];
  #promptOffset = 0;
  #promptMax = 0;
  #cursor: number[];
  #checked: Array<Set<number>>;
  #otherMode: boolean[];
  #otherText: string[];
  #optionsWithOther: QuestionOption[][];
  onDone?: (answers: QuestionAnswer[] | undefined) => void;
  #done = false;

  constructor(
    readonly questions: QuestionInput[],
    private icons: KumoIcons = kumoIcons(),
  ) {
    this.#filters = questions.map(() => "");
    this.#cursor = questions.map(() => 0);
    this.#checked = questions.map(() => new Set<number>());
    this.#otherMode = questions.map((q) => !q.options?.length);
    this.#otherText = questions.map(() => "");
    this.#optionsWithOther = questions.map((q) => [...(q.options ?? []), { label: this.icons.think === "*" ? "Other..." : OTHER_LABEL }]);
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

  private filtered(): number[] {
    const filter = this.#filters[this.#index]!.toLocaleLowerCase();
    return this.opts().flatMap((o, i) => i === this.opts().length - 1 || `${o.label} ${o.description ?? ""}`.toLocaleLowerCase().includes(filter) ? [i] : []);
  }

  private filterChanged(): void {
    const visible = this.filtered();
    if (!visible.includes(this.#cursor[this.#index]!)) this.#cursor[this.#index] = visible[0]!;
  }

  render(width: number): string[] {
    if (!this.questions.length || width <= 0) return [];
    const q = this.questions[this.#index]!;
    const ascii = this.icons.think === "*";
    const inner = Math.max(1, width - 4);
    const border = ascii ? "|" : "│";
    const rule = ascii ? "-" : "─";
    const fit = (text: string, cells = inner): string => stringWidth(text) > cells ? truncateToWidth(text, cells, ascii ? "..." : "…") : text;
    const row = (text: string): string => fit(`${ansi.violet(border)} ${padCells(fit(text), inner)} ${ansi.violet(border)}`, width);
    const edge = (label: string, bottom = false): string => {
      const shown = fit(` ${label} `, Math.max(1, width - 2));
      const line = bottom ? rule.repeat(Math.max(0, width - 2 - stringWidth(shown))) + shown : shown + rule.repeat(Math.max(0, width - 2 - stringWidth(shown)));
      return fit(ansi.violet(`${ascii ? "+" : bottom ? "╰" : "╭"}${line}${ascii ? "+" : bottom ? "╯" : "╮"}`), width);
    };
    const rows = [edge(`${q.header ?? "Question"}  ${this.#index + 1}/${this.questions.length}`)];
    if (this.questions.length > 1) {
      rows.push(row(this.questions.map((question, i) => {
        const label = fit(`${i + 1}. ${question.header ?? "Question"}`, Math.max(8, Math.floor(inner / this.questions.length) - 2));
        return i === this.#index ? ansi.violet(`[${label}]`) : ansi.gray(label);
      }).join("  ")));
    }
    const prompt = wrapTextWithAnsi(ansi.bold(ansi.text(q.question)), inner);
    this.#promptMax = Math.max(0, prompt.length - 6);
    this.#promptOffset = Math.min(this.#promptOffset, this.#promptMax);
    const offset = this.#promptOffset;
    rows.push(...prompt.slice(offset, offset + 6).map(row));
    if (prompt.length > 6) rows.push(row(ansi.gray(`Prompt ${offset + 1}-${Math.min(offset + 6, prompt.length)}/${prompt.length} · PgUp/PgDn`)));
    rows.push(row(""));
    rows.push(row(ansi.gray(this.#otherMode[this.#index] ? "Answer: type to answer" : `Filter: ${this.#filters[this.#index] || "type to filter"}`)));
    if (this.#otherMode[this.#index]) rows.push(...wrapTextWithAnsi(ansi.text(`${this.#otherText[this.#index]}_`), inner).slice(-4).map(row));
    const visible = this.filtered();
    const cursor = this.#cursor[this.#index]!;
    const opts = this.opts();
    const marks = checkMarks(this.icons);
    const selected = opts[cursor]!;
    const description = this.isOtherSelected() ? "Type something. Enter a custom response." : selected.description ?? "Press Enter to select this option.";
    const wide = width >= 60;
    const leftW = wide ? Math.max(20, Math.floor((inner - 3) * 0.48)) : inner;
    const rightW = Math.max(1, inner - leftW - 3);
    const details = wide ? [ansi.yellow(fit(selected.label, rightW)), "", ...wrapTextWithAnsi(ansi.gray(description), rightW)] : [];
    const choices: string[] = [];
    if (visible.length === 1 && this.#filters[this.#index]) choices.push(ansi.gray("No matching options"));
    for (const i of visible) {
      const other = i === opts.length - 1;
      const prefix = i === cursor ? ascii ? "> " : "→ " : "  ";
      const mark = q.multiSelect && !other ? `${this.#checked[this.#index]!.has(i) ? marks.on : marks.off} ` : "";
      const label = other && this.#otherMode[this.#index] ? `${opts[i]!.label} ${this.#otherText[this.#index]}_` : opts[i]!.label;
      const text = fit(`${prefix}${i + 1}. ${mark}${label}`, leftW);
      choices.push(i === cursor ? boxLine("surface", ansi.bold(ansi.violet(text)), leftW) : text);
    }
    for (let i = 0; i < Math.max(choices.length, details.length); i++) {
      rows.push(row(wide ? `${padCells(choices[i] ?? "", leftW)} ${ansi.faint(border)} ${details[i] ?? ""}` : choices[i] ?? ""));
    }
    if (!wide) rows.push(row(""), ...wrapTextWithAnsi(ansi.gray(description), inner).map(row));
    rows.push(row(""));
    const hints = [
      ...(this.questions.length > 1 ? ["tab/shift+tab questions"] : []),
      this.#otherMode[this.#index] ? "type to answer" : "type filter",
      ...(prompt.length > 6 ? ["PgUp/PgDn prompt"] : []), "backspace erase",
      ascii ? "up/down navigate" : "↑↓ navigate", "enter select",
      ...(q.multiSelect ? ["Space toggle"] : []), "esc clear/cancel",
    ].join(ascii ? " / " : " • ");
    rows.push(...wrapTextWithAnsi(ansi.gray(hints), inner).map(row));
    rows.push(edge(`kumo v${pkg.version}`, true));
    return rows;
  }

  invalidate(): void {}

  private allAnswers(): QuestionAnswer[] {
    return this.questions.map((q, i) => {
      const opts = this.#optionsWithOther[i]!;
      if (this.#otherMode[i] === true && this.#otherText[i]!.trim() !== "") {
        return { id: q.id, selected: [], custom: this.#otherText[i]!.trim() };
      }
      if (q.multiSelect === true) {
        const labels = [...this.#checked[i]!]
          .sort((a, b) => a - b)
          .map((k) => opts[k]!.label);
        return { id: q.id, selected: labels };
      }
      const c = this.#cursor[i]!;
      const chosen = opts[c]!;
      if (c === opts.length - 1) return { id: q.id, selected: [], custom: "" };
      return { id: q.id, selected: [chosen.label] };
    });
  }

  handleInput(data: string): void {
    if (this.#done || !this.questions.length) return;
    const finish = (answers: QuestionAnswer[] | undefined): void => {
      if (this.#done) return;
      this.#done = true;
      this.onDone?.(answers);
    };
    // T60: a kitty terminal sends a press *and* a release for every key, and
    // matchesKey answers yes to both. Without this, one backspace erases two
    // characters and one arrow walks two rows.
    if (isKeyRelease(data)) return;
    if (matchesKey(data, "escape")) {
      if (this.#otherMode[this.#index] && this.questions[this.#index]?.options?.length) this.#otherMode[this.#index] = false;
      else if (this.#filters[this.#index]) { this.#filters[this.#index] = ""; this.filterChanged(); }
      else finish(this.questions.map((q) => ({ id: q.id, selected: [], custom: "skipped by the user" })));
      return;
    }
    if (matchesKey(data, "tab") || matchesKey(data, "shift+tab")) {
      this.#index = (this.#index + (matchesKey(data, "shift+tab") ? this.questions.length - 1 : 1)) % this.questions.length;
      this.#promptOffset = 0;
      return;
    }
    if (matchesKey(data, "pageUp") || matchesKey(data, "pageDown")) {
      this.#promptOffset = Math.min(this.#promptMax, Math.max(0, this.#promptOffset + (matchesKey(data, "pageUp") ? -6 : 6)));
      return;
    }
    const q = this.questions[this.#index]!;
    const opts = this.opts();
    // Other… free-text input mode.
    if (this.#otherMode[this.#index] === true) {
      if (matchesKey(data, "enter")) {
        if (this.#index < this.questions.length - 1) {
          this.#index += 1;
        } else {
          finish(this.allAnswers());
        }
        return;
      }
      if (matchesKey(data, "backspace")) {
        this.#otherText[this.#index] = dropLastChar(this.#otherText[this.#index]!);
        return;
      }
      this.#otherText[this.#index] += typedText(data);
      return;
    }
    // ctrl+p and ctrl+n stay as the emacs aliases they always were, read through
    // the same matcher so they survive the protocol too.
    if (matchesKey(data, "up") || matchesKey(data, "ctrl+p")) {
      const visible = this.filtered();
      this.#cursor[this.#index] = visible[Math.max(0, visible.indexOf(this.#cursor[this.#index]!) - 1)]!;
      return;
    }
    if (matchesKey(data, "down") || matchesKey(data, "ctrl+n")) {
      const visible = this.filtered();
      this.#cursor[this.#index] = visible[Math.min(visible.length - 1, visible.indexOf(this.#cursor[this.#index]!) + 1)]!;
      return;
    }
    if (matchesKey(data, "right")) {
      if (this.#index < this.questions.length - 1) this.#index += 1;
      return;
    }
    if (matchesKey(data, "left")) {
      if (this.#index > 0) this.#index -= 1;
      return;
    }
    if (matchesKey(data, "space")) {
      if (q.multiSelect === true && !this.isOtherSelected()) {
        const c = this.#cursor[this.#index]!;
        if (this.#checked[this.#index]!.has(c)) this.#checked[this.#index]!.delete(c);
        else this.#checked[this.#index]!.add(c);
      } else {
        this.#filters[this.#index] += " ";
        this.filterChanged();
      }
      return;
    }
    if (matchesKey(data, "backspace")) {
      this.#filters[this.#index] = dropLastChar(this.#filters[this.#index]!);
      this.filterChanged();
      return;
    }
    const typed = typedText(data);
    if (typed !== "") {
      this.#filters[this.#index] += typed;
      this.filterChanged();
      return;
    }
    if (matchesKey(data, "enter")) {
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
