import { truncateToWidth, type Component } from "@earendil-works/pi-tui";
import type { BruineIcons } from "../render/chars.js";
import { ansi } from "./theme.js";

/** How many queued prompts are listed before the rest is counted. */
const SHOWN = 3;

/**
 * The prompts typed while the agent works, waiting for the turn to end, shown just above the
 * input box: each on one line, oldest first, then how to take one back. Nothing at all when the
 * queue is empty, so the layout does not move for a user who never queues.
 */
export class QueuedPrompts implements Component {
  #items: string[] = [];

  constructor(private readonly icons: BruineIcons) {}

  set(items: readonly string[]): void {
    this.#items = [...items];
  }

  get items(): readonly string[] {
    return this.#items;
  }

  render(width: number): string[] {
    if (this.#items.length === 0) return [];
    const ascii = this.icons.think === "*";
    const mark = ascii ? ">" : "↳";
    const out = this.#items.slice(0, SHOWN).map((text, i) => {
      const label = i === 0 ? "next" : "then";
      const oneLine = text.replace(/\s+/g, " ").trim();
      return truncateToWidth(`${ansi.violet(mark)} ${ansi.faint(label)}  ${ansi.gray(oneLine)}`, width, ascii ? "..." : "…");
    });
    const more = this.#items.length - SHOWN;
    if (more > 0) out.push(ansi.faint(`  + ${String(more)} more queued`));
    const keys = ascii ? "up: edit the last  .  esc: stop, and take them back" : "↑ edit the last  ·  esc stop, and take them back";
    out.push(truncateToWidth(ansi.faint(`  ${keys}`), width, ""));
    return out;
  }

  invalidate(): void {}
}
