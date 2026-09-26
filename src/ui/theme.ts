import type { EditorTheme, MarkdownTheme, SelectListTheme } from "@earendil-works/pi-tui";

import { bgEnabled, onBg, paint } from "./palette.js";
import { highlightCode } from "./highlight.js";

/**
 * Color helpers for the kumo pi-tui theme, backed by the Nuage palette
 * (palette.ts): 24-bit when the terminal supports it, the classic 16 ANSI
 * codes otherwise (same codes as before, so basic terminals and tests see no
 * change). No chalk dependency.
 *
 * The three background helpers fall back to plain foreground text when the
 * terminal cannot paint a background (16 colors, NO_COLOR, KUMO_BG=0), so no
 * caller has to gate them.
 */
export const ansi = {
  dim: (s: string): string => `\x1b[2m${s}\x1b[22m`,
  gray: (s: string): string => paint("muted", s),
  faint: (s: string): string => paint("faint", s),
  cyan: (s: string): string => paint("sky", s),
  blue: (s: string): string => paint("skyDeep", s),
  violet: (s: string): string => paint("lavender", s),
  pink: (s: string): string => paint("pink", s),
  green: (s: string): string => paint("mint", s),
  red: (s: string): string => paint("rose", s),
  yellow: (s: string): string => paint("amber", s),
  text: (s: string): string => paint("text", s),
  bold: (s: string): string => `\x1b[1m${s}\x1b[22m`,
  italic: (s: string): string => `\x1b[3m${s}\x1b[23m`,
  chip: (s: string): string => (bgEnabled() ? onBg("sky", paint("onSky", s)) : paint("sky", s)),
  surface: (s: string): string => onBg("surface", s),
  chipBg: (s: string): string => onBg("chip", s),
  /** The 1-column accent that opens every painted surface. */
  edge: (s: string): string => onBg("edge", s),
};


export const selectListTheme: SelectListTheme = {
  selectedPrefix: (s) => ansi.cyan(s),
  selectedText: (s) => ansi.bold(s),
  description: (s) => ansi.gray(s),
  scrollInfo: (s) => ansi.gray(s),
  noMatch: (s) => ansi.gray(s),
};

export const editorTheme: EditorTheme = {
  borderColor: (s) => ansi.faint(s),
  selectList: selectListTheme,
};

export const markdownTheme: MarkdownTheme = {
  heading: (s) => ansi.bold(ansi.cyan(s)),
  link: (s) => ansi.cyan(s),
  linkUrl: (s) => ansi.gray(s),
  code: (s) => ansi.yellow(s),
  codeBlock: (s) => s,
  // Fences are not shown as "```": the opening one becomes the language label, the
  // closing one a blank line. Code lines sit behind a faint bar, highlighted.
  codeBlockBorder: (s) => {
    const lang = s.replace(/^```/, "").trim();
    return lang === "" ? "" : ansi.faint(lang);
  },
  codeBlockIndent: ansi.faint("▏") + " ",
  highlightCode,
  quote: (s) => ansi.gray(s),
  quoteBorder: (s) => ansi.gray(s),
  hr: (s) => ansi.gray(s),
  listBullet: (s) => ansi.violet(s),
  bold: (s) => ansi.bold(ansi.text(s)),
  italic: (s) => ansi.italic(s),
  strikethrough: (s) => ansi.gray(s),
  underline: (s) => ansi.cyan(s),
};
