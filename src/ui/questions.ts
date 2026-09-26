import { isKeyRelease, matchesKey, truncateToWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import stringWidth from "string-width";
import { kumoIcons, type KumoIcons } from "../render/chars.js";
import { ansi } from "./theme.js";
import { bgEnabled, fillLine } from "./palette.js";
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
    const painted = bgEnabled();
    const marks = checkMarks(this.icons);
    // T55: the chrome recedes and the question is the bright thing. The header was
    // cyan and the question plain, so the decoration read louder than the ask.
    const head = total > 1 ? `? ${q.header ?? "Question"}  ${String(this.#index + 1)}/${String(total)}` : `? ${q.header ?? "Question"}`;
    const body: Array<{ text: string; selected: boolean }> = [];
    const opts = this.opts();
    const labelW = Math.max(...opts.map((o) => stringWidth(o.label)));
    opts.forEach((o, i) => {
      const selected = i === this.#cursor[this.#index]!;
      const cursor = selected ? "› " : "  ";
      const desc = o.description !== undefined ? `   ${ansi.faint(o.description)}` : "";
      if (q.multiSelect === true && o.label !== OTHER_LABEL) {
        const mark = this.#checked[this.#index]!.has(i) ? `${marks.on} ` : `${marks.off} `;
        body.push({ text: `${cursor}${mark}${padCells(o.label, labelW)}${desc}`, selected });
      } else if (o.label === OTHER_LABEL && this.#otherMode[this.#index] === true) {
        body.push({ text: `${cursor}${o.label} ${this.#otherText[this.#index]!}_`, selected });
      } else {
        body.push({ text: `${cursor}${padCells(o.label, labelW)}${desc}`, selected });
      }
    });

    // The hint only offers the keys that do something right now: Space toggles in
    // a multi-select question and does nothing at all in a single-select one, and
    // advertising a dead key is how a form ends up looking broken.
    const hint =
      this.#otherMode[this.#index] === true
        ? "Enter confirm · Esc skip"
        : [
            "↑↓ move",
            "Enter choose",
            ...(q.multiSelect === true ? ["Space toggle"] : []),
            // Short enough to survive a 72-column window: the hint used to be cut
            // just before "Esc skip", which is the one key you need when stuck.
            "type to answer",
            "Esc skip",
          ].join(" · ");

    // Every line carries whether it is a selected option, because the question
    // wraps to a variable number of lines and no fixed offset can find them.
    const lines: Array<{ text: string; selected: boolean }> = [
      { text: ansi.faint(head), selected: false },
      // Wrapped, not truncated: the truncation ate the end of the question, which
      // is where the actual ask usually is.
      ...wrapTextWithAnsi(ansi.text(q.question), Math.max(1, width - 2)).map((t) => ({ text: t, selected: false })),
      { text: "", selected: false },
      ...body,
      { text: "", selected: false },
      { text: ansi.faint(hint), selected: false },
    ];

    // Same 2-column left padding as the chat transcript (T28b.5), and the
    // selected row spends its first column on the accent, so every label stays in
    // the same column whether it is selected or not.
    //
    // The clip has to be cell- and ANSI-aware. A raw `slice(0, width)` counts
    // UTF-16 units and cuts escape sequences in half, and the dangling `\x1b[36m`
    // it leaves behind bleeds into every line below: a long question, or a narrow
    // terminal, turned the form into unreadable overlapping text.
    // `truncateToWidth` re-closes what it cuts, which is why this is not the
    // plain-text `clipCells` the task panel uses.
    return lines.map(({ text: l, selected }) => {
      if (!selected) return truncateToWidth(`  ${l}`, width);
      const inner = Math.max(1, width - 2);
      const cut = truncateToWidth(l, inner);
      return painted
        ? fillLine("surface", `${ansi.edge(" ")} ${cut}${" ".repeat(Math.max(0, inner - stringWidth(cut)))}`)
        : truncateToWidth(`  ${cut}`, width);
    });
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
    // T60: a kitty terminal sends a press *and* a release for every key, and
    // matchesKey answers yes to both. Without this, one backspace erases two
    // characters and one arrow walks two rows.
    if (isKeyRelease(data)) return;
    // Escape: skip all (tool gets clear skipped answer, never hangs).
    if (matchesKey(data, "escape")) {
      finish(
        this.questions.map((q) => ({ id: q.id, selected: [], custom: "skipped by the user" })),
      );
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
      this.#cursor[this.#index] = Math.max(0, this.#cursor[this.#index]! - 1);
      return;
    }
    if (matchesKey(data, "down") || matchesKey(data, "ctrl+n")) {
      this.#cursor[this.#index] = Math.min(opts.length - 1, this.#cursor[this.#index]! + 1);
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
      }
      return;
    }
    // Typing is an answer. Before this, a letter did nothing at all unless you
    // had already walked to "Other…" and pressed Enter, so the form looked
    // broken: you typed and nothing happened, with nothing on screen to say why.
    const typed = typedText(data);
    if (typed !== "") {
      this.#otherMode[this.#index] = true;
      this.#otherText[this.#index] = typed;
      // Put the cursor on "Other…" so the marker matches what is being typed.
      this.#cursor[this.#index] = opts.length - 1;
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
