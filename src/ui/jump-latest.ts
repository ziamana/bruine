/**
 * D5 — `↓ Jump to latest message · End`, the one control that says the view is not
 * at the bottom.
 *
 * T56 (29f1bf1) built the window: the transcript can be held above its live end
 * without scrolling the composer off the screen, the wheel moves it, PageUp and
 * PageDown move it, and End already returns to the live edge. What it could not
 * have is a target: the user who scrolled back has to guess the key, and the hint
 * that says how far back they are (`12 lines below · PageDown follows`) says
 * nothing about how to get back. This is that, and it is also the only control in
 * the transcript, which is why the mouse needs to know about it at all.
 *
 * One row, centred, on the `chip` surface with the text in `sky`. It is drawn only
 * while the window is away from the live edge (`visible`), so at rest the frame is
 * byte for byte what it was before D5 — a pill that is always there is a pill the
 * user has learned to ignore.
 *
 * The label shortens rather than wraps: `↓ Latest · End`, then `↓ End`, and at fewer
 * than seven columns the pill is not drawn at all. A control that cannot be read is
 * not a control.
 *
 * Pure: no terminal, no window, no state beyond what the caller sets. The shell
 * owns the frame, so `span` and `hitTest` read the pill back out of the frame the
 * caller composed rather than guessing a row of their own.
 */

import { stripTerminalSequences, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { kumoIcons, type KumoIcons } from "../render/chars.js";
import { ansi } from "./theme.js";
import { paint } from "./palette.js";

/** The pill, as one row of the frame. */
export class JumpToLatest implements Component {
  #icons: KumoIcons;
  /** True while the transcript window is away from the live edge. */
  visible = false;

  constructor(icons: KumoIcons = kumoIcons()) {
    this.#icons = icons;
  }

  /** The three forms, longest first. The ASCII set has no arrow and no middot. */
  #labels(): string[] {
    const ascii = this.#icons.think === "*";
    const down = ascii ? "v" : "\u2193";
    const dot = ascii ? "-" : "\u00b7";
    return [`${down} Jump to latest message ${dot} End`, `${down} Latest ${dot} End`, `${down} End`];
  }

  /**
   * The label this terminal shows at `width`, or undefined when none of the three
   * fits. The chip spends one cell of padding on each side, which counts.
   */
  label(width = 80): string | undefined {
    return this.#labels().find((text) => visibleWidth(text) + 2 <= width);
  }

  /** Zero rows when there is nothing to jump to, one centred pill when there is. */
  render(width: number): string[] {
    if (!this.visible) return [];
    const text = this.label(width);
    if (text === undefined) return [];
    const pill = ` ${text} `;
    const from = Math.max(0, Math.floor((width - visibleWidth(pill)) / 2));
    return [" ".repeat(from) + ansi.chipBg(paint("sky", pill))];
  }

  /**
   * Where the pill landed on screen: its row and the columns of its chip, padding
   * included. `top` is the viewport's first row (the same `viewportTop` the
   * selection reads the frame with), because the frame is taller than the screen
   * and the pill's row in it is not the row it occupies on it.
   */
  span(lines: readonly string[], top: number): { row: number; from: number; to: number } | undefined {
    for (const [i, line] of lines.entries()) {
      const plain = stripTerminalSequences(line);
      const label = this.#labels().find((text) => plain.trim() === text);
      if (label === undefined) continue;
      const at = plain.length - plain.trimStart().length - 1; // the chip's own pad
      return { row: i + top, from: at, to: at + visibleWidth(label) + 1 };
    }
    return undefined;
  }

  /** Is this screen point on the pill? The frame says where it is; the label says what it is. */
  hitTest(lines: readonly string[], top: number, row: number, col: number): boolean {
    const at = this.span(lines, top);
    return at !== undefined && at.row === row && col >= at.from && col <= at.to;
  }

  invalidate(): void {
    // Stateless render.
  }
}