import { appEnv } from "../compat.js";
/**
 * Terminal glyphs with an ASCII fallback (T14). Non-UTF-8 terminals (legacy
 * Windows consoles, LANG without UTF-8) must never receive emoji.
 */
export interface BruineIcons {
  think: string;
  prompt: string;
  ok: string;
  fail: string;
  bullet: string;
  spark: string;
  folder: string;
}

export const UNICODE_ICONS: BruineIcons = {
  think: "∴",
  prompt: "›",
  ok: "✓",
  fail: "✗",
  bullet: "●",
  spark: "",
  folder: "▸",
};

export const ASCII_ICONS: BruineIcons = {
  think: "*",
  prompt: ">",
  ok: "v",
  fail: "x",
  bullet: ">",
  spark: "",
  folder: ">",
};

const UTF8_RE = /utf-?8/i;
/** TERM_PROGRAM values of terminals that always render UTF-8. */
const UNICODE_TERMINALS: ReadonlySet<string> = new Set(["vscode", "WezTerm", "ghostty", "iTerm.app", "Apple_Terminal", "Hyper", "Tabby"]);

export function iconsFor(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): BruineIcons {
  if (appEnv("ASCII", env) === "1") return ASCII_ICONS;
  const locale = `${env.LC_ALL ?? ""}${env.LC_CTYPE ?? ""}${env.LANG ?? ""}`;
  if (UTF8_RE.test(locale)) return UNICODE_ICONS;
  // Terminals that are UTF-8 whatever the locale says: Windows Terminal, VS Code's, WezTerm.
  if (env.WT_SESSION !== undefined || UNICODE_TERMINALS.has(env.TERM_PROGRAM ?? "")) return UNICODE_ICONS;
  // macOS terminals are UTF-8 out of the box; a shell that never exported LANG (iTerm2 with
  // "Set locale variables automatically" off) is still one. Only an explicit non-UTF-8 locale
  // (LANG=C) says otherwise.
  if (platform === "darwin") return locale === "" ? UNICODE_ICONS : ASCII_ICONS;
  // The classic Windows console's fonts have no braille or box-drawing cells to count on.
  return ASCII_ICONS;
}

/** Canonical ASCII policy, using the caller's icon set or the current environment. */
export function isAscii(icons: BruineIcons = iconsFor()): boolean {
  return icons.think === "*";
}

/** Display-only substitutions, preserving the editor's compact scroll arrows. */
export function asciiText(text: string, ascii = isAscii(), style: "labels" | "editor" = "labels"): string {
  if (!ascii) return text;
  const replacements: Record<string, string> = style === "editor"
    ? { "─": "-", "↑": "^", "↓": "v" }
    : { "↑": "up", "↓": "down", "←": "<", "→": ">", "…": "...", "·": "/", "★": "*" };
  return text.replace(/[─↑↓←→…·★]/g, glyph => replacements[glyph] ?? glyph);
}

let cached: BruineIcons | undefined;

/** Icons for the current process, computed once. */
export function bruineIcons(): BruineIcons {
  if (cached === undefined) cached = iconsFor();
  return cached;
}

/** Display policy only: never mutate messages sent to the model. */
export function withoutEmoji(text: string): string {
  return text
    .replace(
      /[\p{Extended_Pictographic}\p{Emoji_Modifier}][\uFE0F\u200D]*(?:[\p{Extended_Pictographic}\p{Emoji_Modifier}][\uFE0F\u200D]*)* ?|[\uFE0F\u200D]/gu,
      "",
    );
}
