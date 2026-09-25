import { Markdown, type Component } from "@earendil-works/pi-tui";
import { markdownTheme } from "./theme.js";

/**
 * Streaming assistant answer rendered through pi-tui's Markdown component
 * (T13c): the whole accumulated text is set on each delta; pi-tui coalesces
 * repaints.
 */
export class AssistantTextComponent implements Component {
  #md: Markdown;
  #text = "";

  constructor() {
    this.#md = new Markdown("", 1, 0, markdownTheme);
  }

  push(delta: string): void {
    this.#text += delta;
    this.#md.setText(this.#text);
  }

  finish(): void {
    // Markdown holds the full text already; kept explicit for readability.
    this.#md.setText(this.#text);
  }

  render(width: number): string[] {
    return this.#md.render(width);
  }

  invalidate(): void {
    this.#md.invalidate();
  }
}

/** A finished user message, echoed dimmed into the transcript. */
export function userMessageComponent(text: string): Component {
  return new Markdown(`> ${text}`, 1, 0, markdownTheme);
}
