import type { EditorTheme, MarkdownTheme, SelectListTheme } from "@earendil-works/pi-tui";

/** ANSI color helpers for the kumo pi-tui theme (no chalk dependency). */
export const ansi = {
  dim: (s: string): string => `\x1b[2m${s}\x1b[22m`,
  gray: (s: string): string => `\x1b[90m${s}\x1b[39m`,
  cyan: (s: string): string => `\x1b[36m${s}\x1b[39m`,
  green: (s: string): string => `\x1b[32m${s}\x1b[39m`,
  red: (s: string): string => `\x1b[31m${s}\x1b[39m`,
  yellow: (s: string): string => `\x1b[33m${s}\x1b[39m`,
  bold: (s: string): string => `\x1b[1m${s}\x1b[22m`,
  italic: (s: string): string => `\x1b[3m${s}\x1b[23m`,
};


export const selectListTheme: SelectListTheme = {
  selectedPrefix: (s) => ansi.cyan(s),
  selectedText: (s) => ansi.bold(s),
  description: (s) => ansi.gray(s),
  scrollInfo: (s) => ansi.gray(s),
  noMatch: (s) => ansi.gray(s),
};

export const editorTheme: EditorTheme = {
  borderColor: (s) => ansi.gray(s),
  selectList: selectListTheme,
};

export const markdownTheme: MarkdownTheme = {
  heading: (s) => ansi.bold(s),
  link: (s) => ansi.cyan(s),
  linkUrl: (s) => ansi.gray(s),
  code: (s) => ansi.yellow(s),
  codeBlock: (s) => s,
  codeBlockBorder: (s) => ansi.gray(s),
  quote: (s) => ansi.gray(s),
  quoteBorder: (s) => ansi.gray(s),
  hr: (s) => ansi.gray(s),
  listBullet: (s) => ansi.cyan(s),
  bold: (s) => ansi.bold(s),
  italic: (s) => ansi.italic(s),
  strikethrough: (s) => ansi.gray(s),
  underline: (s) => ansi.cyan(s),
};
