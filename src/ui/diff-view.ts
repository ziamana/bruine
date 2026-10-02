/**
 * A compact diff for file changes (edit / write), inside the tool call itself.
 *
 * The block is neutral and the diff is the only thing coloured in it: an added line
 * on a green band and a removed one on a red band, of the same weight, because they
 * are the same kind of fact. It used to be the other way round — the whole card was
 * green, so the addition had nothing of its own and only the deletion read as a
 * band, which is a diff that argues for itself.
 *
 * The `+`/`-` sits in its own column, one gutter cell away from the text, so the
 * sign can never be read as content: a markdown bullet and a `-` used to meet as
 * `-- **Pression**` (and `+-` where a bullet followed an addition).
 *
 * jsdiff (BSD-3) computes the line diff.
 */
import { diffLines } from "diff";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import stringWidth from "string-width";
import { visibleWidth } from "@earendil-works/pi-tui";
import { bgEnabled, onBg, paint } from "./palette.js";
import { clipCells } from "../render/reasoning.js";

export interface DiffLine {
  kind: "add" | "del" | "ctx";
  text: string;
  /** Line number in the file after the change (added and context lines). */
  n?: number;
  /** Line number in the file before the change (removed and context lines). */
  old?: number;
}

export interface FileDiff {
  lines: DiffLine[];
  added: number;
  removed: number;
}

const MAX_DIFF_LINES = 12;

function splitKeep(s: string): string[] {
  const parts = s.split("\n");
  if (parts.at(-1) === "") parts.pop();
  return parts;
}

/** First line (1-based) where `needle` starts in `hay`, or undefined. */
function lineOf(hay: string, needle: string): number | undefined {
  if (needle === "") return undefined;
  const at = hay.indexOf(needle);
  if (at < 0) return undefined;
  return hay.slice(0, at).split("\n").length;
}

function readAfter(path: string | undefined): string | undefined {
  if (path === undefined || path === "") return undefined;
  try {
    return readFileSync(resolve(process.cwd(), path), "utf8");
  } catch {
    return undefined;
  }
}

/**
 * One old → new replacement as diff lines, numbered from `start` when known.
 * Common leading and trailing lines are peeled off first, so "}" → "}\n\nfn b() {\n}"
 * reads as four added lines after the brace (what a person expects), not as an added
 * brace plus an unchanged one further down (jsdiff's equally valid alignment).
 */
function replacement(oldText: string, newText: string, start: number | undefined): FileDiff {
  const a = splitKeep(oldText);
  const b = splitKeep(newText);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  // Two numberings, because a diff is read against both files: an added line has a
  // line in the new file only, a removed one a line in the old file only. They start
  // at the same place: every line before the hunk is identical in both files, so the
  // line the new string starts at is the line the old one started at.
  let nNew = start;
  let nOld = start;
  const ctx = (text: string): void => {
    lines.push({
      kind: "ctx",
      text,
      ...(nNew !== undefined ? { n: nNew } : {}),
      ...(nOld !== undefined ? { old: nOld } : {}),
    });
    if (nNew !== undefined) nNew += 1;
    if (nOld !== undefined) nOld += 1;
  };
  for (const text of b.slice(0, head)) ctx(text);
  const midOld = a.slice(head, a.length - tail).join("\n");
  const midNew = b.slice(head, b.length - tail).join("\n");
  for (const part of diffLines(midOld === "" ? "" : `${midOld}\n`, midNew === "" ? "" : `${midNew}\n`)) {
    for (const text of splitKeep(part.value)) {
      if (part.added === true) {
        lines.push({ kind: "add", text, ...(nNew !== undefined ? { n: nNew } : {}) });
        added += 1;
        if (nNew !== undefined) nNew += 1;
      } else if (part.removed === true) {
        lines.push({ kind: "del", text, ...(nOld !== undefined ? { old: nOld } : {}) });
        removed += 1;
        if (nOld !== undefined) nOld += 1;
      } else {
        ctx(text);
      }
    }
  }
  for (const text of b.slice(b.length - tail)) ctx(text);
  return { lines, added, removed };
}

/** The diff a finished write/edit call made, from its arguments (pure except one file read). */
export function diffForCall(tool: string, rawArgs: string): FileDiff | undefined {
  let args: Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(rawArgs);
    if (v === null || typeof v !== "object" || Array.isArray(v)) return undefined;
    args = v as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const path = typeof args.path === "string" ? args.path : typeof args.file_path === "string" ? args.file_path : undefined;
  if (tool === "write" && typeof args.content === "string") {
    // A write has no old file to number: every line is an addition and the `old`
    // column is left out of the render entirely rather than filled with zeros.
    const lines = splitKeep(args.content).map((text, i) => ({ kind: "add" as const, text, n: i + 1 }));
    return { lines, added: lines.length, removed: 0 };
  }
  if (tool === "edit" && typeof args.old_string === "string" && typeof args.new_string === "string") {
    const after = readAfter(path);
    const start = after === undefined ? undefined : lineOf(after, args.new_string);
    return replacement(args.old_string, args.new_string, start);
  }
  if (tool === "multi_edit" && Array.isArray(args.edits)) {
    const after = readAfter(path);
    const all: FileDiff = { lines: [], added: 0, removed: 0 };
    for (const e of args.edits as Array<Record<string, unknown>>) {
      if (typeof e.old_string !== "string" || typeof e.new_string !== "string") continue;
      const d = replacement(e.old_string, e.new_string, after === undefined ? undefined : lineOf(after, e.new_string));
      all.lines.push(...d.lines);
      all.added += d.added;
      all.removed += d.removed;
    }
    return all.lines.length > 0 ? all : undefined;
  }
  return undefined;
}

/** `+3 -1` for the tool header. */
export function diffCounter(d: FileDiff): string {
  return `${paint("mint", `+${String(d.added)}`)} ${paint("rose", `-${String(d.removed)}`)}`;
}

/**
 * The diff under the header: numbers, a sign in its own column, then the text.
 *
 * The columns are sized from what the lines actually carry and are given up in a
 * fixed order when the terminal is too narrow for them: the old file's numbering
 * goes first (it is context a reader can reconstruct), the new one next, and the
 * text is clipped last, because it is the diff.
 *
 * The block paints no band where the terminal cannot hold one (`KUMO_BG=0`, 16
 * colors): there the sign carries the meaning and the text is coloured, which is a
 * diff that still says which side is which without a background.
 */
export function renderDiff(d: FileDiff, width: number, ascii = false): string[] {
  const shown = d.lines.slice(0, MAX_DIFF_LINES);
  const digits = (n: number): number => (n > 0 ? String(n).length : 0);
  let oldW = Math.max(0, ...shown.map((l) => digits(l.old ?? 0)));
  const newW = Math.max(0, ...shown.map((l) => digits(l.n ?? 0)));
  // Under this width the old numbering costs more characters than it explains.
  if (oldW + newW + 3 > Math.max(0, width - 8)) oldW = 0;
  const gutter = " ";
  // One cell for the sign, one for the gutter, the numbers, and what is left is text.
  const head = (l: DiffLine): string => {
    const parts = [oldW > 0 ? String(l.old ?? "").padStart(oldW) : "", newW > 0 ? String(l.n ?? "").padStart(newW) : ""];
    const numbers = parts.filter((c) => c !== "").join(" ");
    return numbers === "" ? "" : `${numbers} `;
  };
  const ellipsis = ascii ? "..." : "\u2026";
  const row = (l: DiffLine): string => {
    const prefix = head(l);
    const sign = l.kind === "add" ? "+" : l.kind === "del" ? "-" : " ";
    const room = Math.max(1, width - visibleWidth(prefix) - sign.length - gutter.length);
    const body = clipCells(l.text.replace(/\t/g, "  "), room, ellipsis);
    const pad = " ".repeat(Math.max(0, room - stringWidth(body)));
    if (l.kind === "ctx") return `${paint("faint", prefix)}${paint("faint", sign)}${paint("muted", `${gutter}${body}${pad}`)}`;
    const role = l.kind === "add" ? "mint" : "rose";
    const ink = l.kind === "add" ? "addFg" : "delFg";
    const band = `${gutter}${body}${pad}`;
    const painted = bgEnabled() ? onBg(l.kind === "add" ? "addBg" : "delBg", paint(ink, band)) : paint(ink, band);
    return `${paint("faint", prefix)}${paint(role, sign)}${painted}`;
  };
  const out = shown.map(row);
  const rest = d.lines.length - shown.length;
  if (rest > 0) out.push(paint("faint", `${" ".repeat(Math.min(width, 4))}${ellipsis} ${String(rest)} more lines`));
  return out;
}
