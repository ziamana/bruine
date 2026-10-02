import stringWidth from "string-width";

/**
 * How an assistant answer is read on screen: how wide prose is allowed to get,
 * and how much air sits between two blocks.
 *
 * The defect this answers: on a wide terminal the renderer lays prose out in
 * every cell it is given, so a paragraph became a 180-column line with a
 * comfortable 75-column measure somewhere inside it, and the eye had nowhere to
 * rest. Code fences and tables are a different thing: a block of code is as
 * wide as its longest line and a table is laid out in the space it needs, so
 * neither is capped here.
 */

/** Past this a paragraph is a wall of words, whatever the terminal is wide. */
export const READ_WIDTH = 110;

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}#{1,6}\s/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(.*)$/;
const QUOTE = /^(\s*)(>\s?)/;
const TABLE_RULE = /^ {0,3}\|?[\s:|-]*-[\s:|-]*\|/;
/** A title underlined with `===` or `---` instead of prefixed with `#`. */
const SETEXT = /^ {0,3}(?:=+|-+)\s*$/;
/** An indented block is code to a markdown parser, whatever it holds. */
const INDENTED = /^(?: {4}|\t)/;
/**
 * A word that opens a line only when the text already said so. Wrapping must
 * never invent structure, so these are glued to the word before them and can
 * never be the first thing on a line.
 */
const OPENS_BLOCK = /^[-*+>#|]|\d{1,9}[.)]/;
/**
 * A construct a line break would break: an inline link, an image, an autolink,
 * a bare URL. A paragraph holding one is left exactly as the model wrote it.
 */
const UNBREAKABLE = /[[<]|:\/\//;

const plain = (line: string): string => line.replace(/\x1b\[[0-9;]*m/g, "");
const blank = (line: string): boolean => stringWidth(plain(line).trim()) === 0;

/**
 * The reading shape of an answer: prose wrapped to the reading width, and a
 * blank line above every heading.
 *
 * The heading blank is here because a markdown parser starts a heading on the
 * line after a paragraph whether or not the source left a blank, so without it
 * a title and the paragraph under it read as one dense block.
 */
export function shapeAnswer(source: string, availableWidth: number): string {
  const lines = source.split("\n");
  // Nothing to gain by re-wrapping prose the renderer already fits.
  const width = Math.max(1, Math.min(availableWidth, READ_WIDTH));
  const cap = width < availableWidth;
  const out: string[] = [];
  let fence: { char: string; len: number } | undefined;
  let table = false;
  /** The prose block being filled, and the marks its lines carry. */
  let words: string[] = [];
  let kind: "" | "para" | "list" | "quote" = "";
  let first = "";
  let next = "";
  /** The block being filled holds something a line break would break. */
  let verbatim = false;

  const flush = (): void => {
    if (words.length > 0) {
      out.push(...(cap && !verbatim ? fill(words, first, next, width) : [`${first}${words.join(" ")}`]));
      words = [];
    }
    kind = "";
    verbatim = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (fence !== undefined) {
      out.push(line);
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line)?.[1];
      if (close !== undefined && close[0] === fence.char && close.length >= fence.len) fence = undefined;
      continue;
    }
    const open = FENCE.exec(line)?.[1];
    if (open !== undefined) {
      flush();
      fence = { char: open[0]!, len: open.length };
      table = false;
      out.push(line);
      continue;
    }
    if (blank(line)) {
      flush();
      table = false;
      out.push(line);
      continue;
    }
    // A table is a header row and a rule under it; either may drop its edges.
    if (line.includes("|") && (table || TABLE_RULE.test(lines[i + 1] ?? ""))) {
      flush();
      table = true;
      out.push(line);
      continue;
    }
    table = false;
    if (INDENTED.test(line)) {
      flush();
      out.push(line);
      continue;
    }
    if (words.length > 0 && SETEXT.test(line)) {
      // A title underlined with `===` or `---`: the words above it are the
      // title, and the rule has to stay under them or the title stops being one.
      flush();
      out.push(line);
      continue;
    }
    if (HEADING.test(line)) {
      flush();
      if (out.length > 0 && !blank(out[out.length - 1]!)) out.push("");
      out.push(...(cap && !UNBREAKABLE.test(line) ? fill(line.trim().split(/\s+/), "", "", width) : [line]));
      continue;
    }
    const quote = QUOTE.exec(line);
    const item = LIST_ITEM.exec(line);
    if (item !== null) {
      // A marker always opens a block: two items are two items, never one
      // paragraph that happens to start with a dash.
      flush();
      kind = "list";
      const [, indent = "", marker = "", gap = ""] = item;
      first = `${indent}${marker}${gap}`;
      next = `${indent}${" ".repeat(marker.length + gap.length)}`;
    } else if (quote !== null) {
      if (kind !== "quote") {
        flush();
        kind = "quote";
        first = quote[0];
      }
      next = quote[0];
    } else if (kind === "") {
      kind = "para";
      first = next = "";
    }
    // Anything else continues the block that is open, hanging indent included.
    if (UNBREAKABLE.test(line)) verbatim = true;
    if (verbatim) {
      out.push(line);
      continue;
    }
    const body = item !== null ? item[4]! : quote !== null ? line.slice(quote[0].length) : line;
    words.push(...body.trim().split(/\s+/).filter((word) => word !== ""));
  }
  flush();
  return out.join("\n");
}

/**
 * Greedy fill of one prose block. `first` opens the block and `next` carries
 * every line after it, so a list item's continuations line up under its text
 * and not under its marker.
 */
function fill(words: string[], first: string, next: string, width: number): string[] {
  // A word that would open a line as markdown is glued to the word before it.
  const tokens: string[] = [];
  for (const [i, word] of words.entries()) {
    if (i > 0 && OPENS_BLOCK.test(word)) tokens[tokens.length - 1] = `${tokens[tokens.length - 1]} ${word}`;
    else tokens.push(word);
  }
  const out: string[] = [];
  let start = 0;
  while (start < tokens.length) {
    const prefix = start === 0 ? first : next;
    let cells = stringWidth(prefix);
    let end = start;
    while (end < tokens.length) {
      // A single word longer than the measure stays whole: a broken identifier
      // is worse than a long line.
      const add = stringWidth(tokens[end]!) + (end === start ? 0 : 1);
      if (cells + add > width && end > start) break;
      cells += add;
      end += 1;
    }
    out.push(`${prefix}${tokens.slice(start, end).join(" ")}`);
    start = end;
  }
  return out;
}

/**
 * One blank line between two blocks.
 *
 * pi-tui leaves three around a fence: the closing fence line, the blank it adds
 * after the block, and the blank the source asked for. A blank line inside a
 * fence is not blank at all, it carries the gutter, so this never eats the air a
 * piece of code asked for.
 */
export function oneBlankBetween(lines: string[]): string[] {
  const out: string[] = [];
  let previousBlank = false;
  for (const line of lines) {
    const empty = blank(line);
    if (empty && previousBlank) continue;
    out.push(line);
    previousBlank = empty;
  }
  return out;
}