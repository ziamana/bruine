import { Markdown, Text, type Component } from "@earendil-works/pi-tui";
import { kumoIcons, withoutEmoji } from "../render/chars.js";
import { ansi, markdownTheme } from "./theme.js";
import { pasteChip } from "./chat-layout.js";

/**
 * Streaming assistant answer rendered through pi-tui's Markdown component
 * (T13c): the whole accumulated text is set on each delta; pi-tui coalesces
 * repaints.
 */
export class AssistantTextComponent implements Component {
  #md: Markdown;
  #text = "";

  constructor() {
    this.#md = new Markdown("", 0, 0, markdownTheme);
  }

  push(delta: string): void {
    this.#text += delta;
    this.#md.setText(withoutEmoji(this.#text));
  }

  finish(): void {
    // Markdown holds the full text already; kept explicit for readability.
    this.#md.setText(withoutEmoji(this.#text));
  }

  render(width: number): string[] {
    return this.#md.render(width);
  }

  invalidate(): void {
    this.#md.invalidate();
  }
}

/** A finished user message: a tinted band in the transcript (Nuage). */
export function userMessageComponent(text: string): Component {
  const chip = pasteChip(text);
  const prompt = ansi.cyan(kumoIcons().prompt);
  const body = chip ?? ansi.text(withoutEmoji(text));
  const t = new Text(`${prompt} ${body}`, 0, 0) as Text & { surface?: boolean };
  t.surface = true;
  return t;
}
