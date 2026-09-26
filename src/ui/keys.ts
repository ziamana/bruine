/**
 * T60 — what a keystroke means, whichever encoding it arrived in.
 *
 * pi-tui turns the kitty keyboard protocol on when the terminal advertises it,
 * and that changes the bytes on the wire: an arrow arrives as `CSI 1;1 A` rather
 * than `CSI A`, and a typed letter as `CSI 97 u` rather than "a". Every
 * component that compared raw bytes was therefore correct only on a terminal
 * without the protocol, which is the opposite of the terminals people use.
 *
 * `matchesKey` already reads both encodings, so keys go through it. Printable
 * text is the one thing it does not answer, because the answer differs by
 * protocol, and that is what this module is for.
 */

import { decodeKittyPrintable } from "@earendil-works/pi-tui";

/**
 * The printable text a chunk carries, or "" when it carries none.
 *
 * `decodeKittyPrintable` reads `CSI u`, and it returns nothing for a plain
 * character, so a plain chunk still has to be read by hand. Escape sequences
 * that are not text (a function key, a cursor move) yield "" rather than being
 * guessed at.
 */
export function typedText(data: string): string {
  const kitty = decodeKittyPrintable(data);
  if (kitty !== undefined) return kitty;
  if (data.startsWith("\x1b")) return "";
  let out = "";
  for (const ch of data) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 32 && code !== 127) out += ch;
  }
  return out;
}

/** Drop the last character without splitting a surrogate pair or a combining mark. */
export function dropLastChar(text: string): string {
  return [...text].slice(0, -1).join("");
}
