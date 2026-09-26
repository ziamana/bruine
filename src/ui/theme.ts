import type { EditorTheme, MarkdownTheme, SelectListTheme } from "@earendil-works/pi-tui";

import { onBg, paint } from "./palette.js";

/**
 * Color helpers for the kumo pi-tui theme, backed by the Nuage palette
 * (palette.ts): 24-bit when the terminal supports it, the classic 16 ANSI
 * codes otherwise (same codes as before, so basic terminals and tests see no
 * change). No chalk dependency.
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
  chip: (s: string): string => onBg("sky", paint("onSky", s)),
  surface: (s: string): string => onBg("surface", s),
  chipBg: (s: string): string => onBg("chip", s),
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
  codeBlockBorder: (s) => ansi.gray(s),
  quote: (s) => ansi.gray(s),
  quoteBorder: (s) => ansi.gray(s),
  hr: (s) => ansi.gray(s),
  listBullet: (s) => ansi.violet(s),
  bold: (s) => ansi.bold(ansi.text(s)),
  italic: (s) => ansi.italic(s),
  strikethrough: (s) => ansi.gray(s),
  underline: (s) => ansi.cyan(s),
};
