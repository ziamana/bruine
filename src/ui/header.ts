import { visibleWidth } from "@earendil-works/pi-tui";
import { clipCells } from "../render/reasoning.js";
import { LOGO, LOGO_STOPS } from "./logo-motion.js";
import { gradientStops } from "./palette.js";

/** The mark's width and the gap before what sits beside it. */
export const LOGO_CELLS = LOGO[0].length;
const LOGO_GAP = 3;

/** Under this width the mark has no room beside the key line and the header is text. */
export const LOGO_MIN_WIDTH = LOGO_CELLS + LOGO_GAP + 28;

/** The most a resource line spreads: past it the names would be too far from their label. */
const RESOURCE_MAX_WIDTH = 100;
/** Two columns of indent, then the label padded to its longest ("plugins") and two spaces. */
const RESOURCE_PREFIX = 2 + 9;

/** The three rows of the mark in the palette's gradient (one accent on terminals without 24-bit color). */
export function logoRows(): [string, string, string] {
  return [gradientStops(LOGO[0], [...LOGO_STOPS]), gradientStops(LOGO[1], [...LOGO_STOPS]), gradientStops(LOGO[2], [...LOGO_STOPS])];
}

/** Cells left for what sits beside the mark. */
export function besideLogo(width: number): number {
  return Math.max(0, width - LOGO_CELLS - LOGO_GAP);
}

export const LOGO_BESIDE_GAP = " ".repeat(LOGO_GAP);

/** One loaded kind of resource, as much of it as fits one line. */
export interface ResourceLine {
  label: string;
  /** The names shown, in order. */
  names: string[];
  /** How many more exist than are shown, so the line never claims to be complete. */
  hidden: number;
  /** A command that opens the full list, when the line has room to say so. */
  hint?: string;
}

/**
 * One line for a kind of loaded resource: `skills   apex · brixhub · browser +8`.
 *
 * The line is a label, the names that fit, and how many did not, never a wrapped
 * list: the header is the first thing on screen and a list that grows to three rows
 * per kind is a banner nobody reads. The full list is one command away, and the hint
 * says which. Pure, and it returns nothing for an empty list: a session that loaded
 * no skills must not be told so.
 */
export function planResourceLine(
  label: string,
  names: readonly string[],
  width: number,
  opts: { hint?: string; sep?: string; ellipsis?: string } = {},
): ResourceLine | undefined {
  const clean = names.map((n) => n.trim()).filter((n) => n !== "");
  if (clean.length === 0) return undefined;
  const sep = opts.sep ?? " · ";
  const ellipsis = opts.ellipsis ?? "…";
  const span = Math.min(width, RESOURCE_MAX_WIDTH);
  const withHint = opts.hint !== undefined && span >= 72;
  const hintCells = withHint ? visibleWidth(opts.hint!) + 3 : 0;
  const room = Math.max(6, span - RESOURCE_PREFIX - hintCells);
  const line = (shown: string[]): ResourceLine => ({
    label,
    names: shown,
    hidden: clean.length - shown.length,
    ...(withHint ? { hint: opts.hint! } : {}),
  });
  for (let k = clean.length; k >= 1; k -= 1) {
    const shown = clean.slice(0, k);
    const more = clean.length - k > 0 ? ` +${String(clean.length - k)}` : "";
    if (visibleWidth(shown.join(sep) + more) <= room) return line(shown);
  }
  // A single name longer than the room is the one case a count cannot save: it is
  // clipped, with a mark, rather than allowed to wrap the header.
  const more = clean.length > 1 ? ` +${String(clean.length - 1)}` : "";
  return line([clipCells(clean[0]!, Math.max(1, room - visibleWidth(more)), ellipsis)]);
}

/** The painters a resource line needs, so the layout stays pure and the palette stays in one place. */
export interface ResourceInk {
  label(s: string): string;
  name(s: string): string;
  chrome(s: string): string;
}

/** A planned line, painted and padded: the hint sits at the right edge of the line's span. */
export function paintResourceLine(plan: ResourceLine, width: number, ink: ResourceInk, sep = " · "): string {
  const names = plan.names.map((n) => ink.name(n)).join(ink.chrome(sep));
  const more = plan.hidden > 0 ? ` ${ink.chrome(`+${String(plan.hidden)}`)}` : "";
  const body = `  ${ink.label(plan.label.padEnd(RESOURCE_PREFIX - 2))}${names}${more}`;
  if (plan.hint === undefined) return body;
  const span = Math.min(width, RESOURCE_MAX_WIDTH);
  const gap = Math.max(3, span - visibleWidth(body) - visibleWidth(plan.hint));
  return `${body}${" ".repeat(gap)}${ink.chrome(plan.hint)}`;
}
