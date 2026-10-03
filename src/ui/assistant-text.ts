import { Markdown, Text, type Component } from "@earendil-works/pi-tui";
import { bruineIcons, withoutEmoji, type BruineIcons } from "../render/chars.js";
import { oneBlankBetween, shapeAnswer } from "../render/markdown.js";
import { ansi, markdownThemeFor } from "./theme.js";
import { pasteChip } from "./chat-layout.js";
import { revealAllowed, Typewriter, type TypewriterOptions } from "./typewriter.js";

export interface AssistantTextOptions {
  /** Repaint hook. Left out, the text is never held back. */
  onTick?: () => void;
  icons?: BruineIcons;
  /** Overrides the motion gate (no tty, CI, BRUINE_ASCII, BRUINE_NO_ANIMATION). */
  animate?: boolean;
  typewriter?: TypewriterOptions;
}

/**
 * Streaming assistant answer rendered through pi-tui's Markdown component
 * (T13c).
 *
 * T57: the markdown is re-parsed on a timer instead of on every token. A local
 * model delivers tokens far faster than the layout can settle, so parsing per
 * token made the paragraph flicker instead of stream. When animation is off
 * (`BRUINE_NO_ANIMATION=1`, CI, no tty, BRUINE_ASCII) the typewriter shows every
 * delta at once and this component behaves exactly as it did before.
 */
export class AssistantTextComponent implements Component {
  #md: Markdown;
  #tw: Typewriter;

  constructor(opts: AssistantTextOptions = {}) {
    const icons = opts.icons ?? bruineIcons();
    this.#md = new Markdown("", 0, 0, markdownThemeFor(icons), undefined, {
      // Prose is read at a fixed measure and code keeps the width it needs, so a
      // wide terminal gains air around the answer instead of lines through it.
      transform: shapeAnswer,
    });
    const animate = opts.animate ?? revealAllowed(icons);
    const repaint = opts.onTick;
    this.#tw = new Typewriter({
      ...opts.typewriter,
      // The repaint hook is the switch: without one there is nothing to animate
      // for, so the text lands whole. With one, the reveal owns the painting:
      // the component has to re-set the markdown on every step, not only when a
      // delta arrives, or the screen keeps showing the text as it was.
      onTick: animate && repaint !== undefined ? () => { this.#paint(); repaint(); } : undefined,
    });
  }

  push(delta: string): void {
    this.#tw.push(delta);
    this.#paint();
  }

  finish(): void {
    // Nothing may stay hidden at the end of a block: a turn that ends with text
    // still in the buffer is a turn that looks truncated.
    this.#tw.flush();
    this.#paint();
  }

  #paint(): void {
    this.#md.setText(withoutEmoji(this.#tw.text));
  }

  /** The shaped lines of the last markdown render: while the renderer hands back the same lines, so do we. */
  #shaped: { from: string[]; lines: string[] } | undefined;

  render(width: number): string[] {
    // One blank line between two blocks: the renderer leaves three around a
    // fence, and a screen where every block is floating has no rhythm at all.
    const rendered = this.#md.render(width);
    if (this.#shaped?.from !== rendered) this.#shaped = { from: rendered, lines: oneBlankBetween(rendered) };
    return this.#shaped.lines;
  }

  invalidate(): void {
    this.#md.invalidate();
  }
}

/** A finished user message: a tinted band in the transcript (Nuage). */
export function userMessageComponent(text: string): Component {
  const chip = pasteChip(text);
  const prompt = ansi.cyan(bruineIcons().prompt);
  const body = chip ?? ansi.text(withoutEmoji(text));
  const t = new Text(`${prompt} ${body}`, 0, 0) as Text & { surface?: boolean };
  t.surface = true;
  return t;
}
