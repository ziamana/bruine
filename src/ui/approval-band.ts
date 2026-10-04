import { matchesKey, visibleWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import { isAscii, bruineIcons, type BruineIcons } from "../render/chars.js";
import { Box } from "./box.js";
import { ansi } from "./theme.js";

/** One answer: the letter that picks it directly, and what it does. */
export interface BandChoice {
  key: string;
  label: string;
}

/** How many rows of the request itself are shown before it is cut. */
const DETAIL_ROWS = 3;

/**
 * The approval, as the one framed, amber thing on screen while it is open.
 *
 * It used to be a line of amber text over a plain list, the quietest block on a screen
 * where everything else was still moving. Now the request has a frame of its own, every
 * answer has a letter (y, a, n), and Escape is spelled out on the frame because it is an
 * answer too: it rejects.
 */
export class ApprovalBand implements Component {
  #selected = 0;
  onSelect: (index: number) => void = () => {};
  onCancel: () => void = () => {};

  constructor(
    private readonly title: string,
    private readonly choices: readonly BandChoice[],
    private readonly icons: BruineIcons = bruineIcons(),
  ) {}

  get selected(): number {
    return this.#selected;
  }

  render(width: number): string[] {
    const ascii = isAscii(this.icons);
    const box = new Box(width, { ascii, ink: ansi.yellow });
    // "? Allow bash: npm test" → the frame says "Allow bash", the rows say "npm test".
    const bare = this.title.replace(/^\?\s*/, "");
    const at = bare.indexOf(": ");
    const head = at > 0 ? bare.slice(0, at) : bare;
    const detail = at > 0 ? bare.slice(at + 2) : "";
    const out = [box.edge(` ${ansi.bold(ansi.yellow(head))} `, false, 1)];
    if (detail !== "") {
      const rows = wrapTextWithAnsi(detail, box.innerWidth);
      const shown = rows.slice(0, DETAIL_ROWS);
      if (rows.length > DETAIL_ROWS) shown[DETAIL_ROWS - 1] = box.fit(`${shown[DETAIL_ROWS - 1]!}${ascii ? "..." : "…"}`);
      for (const row of shown) out.push(box.row(ansi.text(row)));
      out.push(box.row(""));
    }
    const pointer = ascii ? ">" : "›";
    this.choices.forEach((choice, i) => {
      const on = i === this.#selected;
      const mark = on ? ansi.yellow(pointer) : " ";
      const key = on ? ansi.bold(ansi.yellow(choice.key)) : ansi.yellow(choice.key);
      const label = on ? ansi.bold(ansi.text(choice.label)) : ansi.gray(choice.label);
      out.push(box.row(`${mark} ${key}  ${label}`));
    });
    const hint = ` ${ansi.gray(ascii ? "enter choose . esc rejects" : "⏎ choose · esc rejects")} `;
    out.push(visibleWidth(hint) + 6 <= width ? box.edge(hint, true, 2) : box.edge("", true));
    return out;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "up") || data === "k") {
      this.#selected = (this.#selected + this.choices.length - 1) % this.choices.length;
      return;
    }
    if (matchesKey(data, "down") || data === "j") {
      this.#selected = (this.#selected + 1) % this.choices.length;
      return;
    }
    if (matchesKey(data, "enter") || matchesKey(data, "return")) {
      this.onSelect(this.#selected);
      return;
    }
    if (matchesKey(data, "escape")) {
      this.onCancel();
      return;
    }
    const letter = data.toLowerCase();
    const direct = this.choices.findIndex((choice) => choice.key === letter);
    if (direct >= 0) {
      this.#selected = direct;
      this.onSelect(direct);
    }
  }

  invalidate(): void {}
}
