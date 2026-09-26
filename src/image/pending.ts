/**
 * T29 — the images waiting to be sent, and the `[Image N]` chips that stand for
 * them in the editor.
 *
 * A chip is the only thing the editor ever holds: bytes never go through the
 * input stream and never sit in the buffer as base64. The chip text is what the
 * user sees, what history stores, and what the transcript shows; the bytes live
 * here until the message is sent, then go to the dsh attachment store and are
 * dropped from this registry.
 */
import type { ClipboardImage } from "./clipboard.js";

/** The chip the user sees, e.g. `[Image 2]`. */
export function imageChip(id: number): string {
  return `[Image ${String(id)}]`;
}

/** Every chip in a text, in the order they appear. */
export function parseImageChips(text: string): number[] {
  const out: number[] = [];
  for (const match of text.matchAll(/\[Image (\d+)\]/g)) {
    const id = Number(match[1]);
    if (Number.isSafeInteger(id) && id > 0) out.push(id);
  }
  return out;
}

/** The text with every chip removed, trimmed of the gap they leave behind. */
export function stripImageChips(text: string): string {
  return text.replace(/\[Image \d+\]/g, " ").replace(/[ \t]{2,}/g, " ").trim();
}

/**
 * Session-scoped pending images. Numbering never restarts, so `[Image 3]` in
 * the transcript always means the third image of the session even after the
 * first two have been sent.
 */
export class PendingImages {
  #next = 1;
  readonly #items = new Map<number, ClipboardImage>();

  /** Store one image and return the chip that represents it. */
  add(image: ClipboardImage): string {
    const id = this.#next++;
    this.#items.set(id, image);
    return imageChip(id);
  }

  get(id: number): ClipboardImage | undefined {
    return this.#items.get(id);
  }

  get size(): number {
    return this.#items.size;
  }

  /** Remove one image without sending it (the user deleted its chip). */
  drop(id: number): void {
    this.#items.delete(id);
  }

  /**
   * The images a submitted text refers to, in the order the chips appear.
   * Unknown ids are ignored: the buffer is user-editable, so `[Image 99]` is
   * text, not a reference to anything.
   */
  resolve(text: string): ClipboardImage[] {
    const out: ClipboardImage[] = [];
    const seen = new Set<number>();
    for (const id of parseImageChips(text)) {
      if (seen.has(id)) continue;
      const image = this.#items.get(id);
      if (image === undefined) continue;
      seen.add(id);
      out.push(image);
    }
    return out;
  }

  /** Send-time cleanup: the bytes now live in the attachment store. */
  release(images: readonly ClipboardImage[]): void {
    for (const image of images) {
      for (const [id, item] of this.#items) {
        if (item === image) this.#items.delete(id);
      }
    }
  }

  /** A new conversation forgets every pending image. */
  clear(): void {
    this.#items.clear();
  }

  /** Drop images whose chips the user deleted before sending. */
  prune(text: string): void {
    const kept = new Set(parseImageChips(text));
    for (const id of [...this.#items.keys()]) {
      if (!kept.has(id)) this.#items.delete(id);
    }
  }
}
