/**
 * Terminal glyphs with an ASCII fallback (T14). Non-UTF-8 terminals (legacy
 * Windows consoles, LANG without UTF-8) must never receive emoji.
 */
export interface KumoIcons {
  think: string;
  prompt: string;
  ok: string;
  fail: string;
  bullet: string;
  spark: string;
}

export const UNICODE_ICONS: KumoIcons = {
  think: "∴",
  prompt: "›",
  ok: "✓",
  fail: "✗",
  bullet: "●",
  spark: "",
};

export const ASCII_ICONS: KumoIcons = {
  think: "*",
  prompt: ">",
  ok: "v",
  fail: "x",
  bullet: ">",
  spark: "",
};

const UTF8_RE = /utf-?8/i;

export function iconsFor(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): KumoIcons {
  if (env.KUMO_ASCII === "1") return ASCII_ICONS;
  const utf8 = UTF8_RE.test(`${env.LC_ALL ?? ""}${env.LC_CTYPE ?? ""}${env.LANG ?? ""}`);
  if (utf8) return UNICODE_ICONS;
  if (platform === "win32") {
    // Windows Terminal exports WT_SESSION and is UTF-8 capable.
    return env.WT_SESSION !== undefined ? UNICODE_ICONS : ASCII_ICONS;
  }
  return ASCII_ICONS;
}

let cached: KumoIcons | undefined;

/** Icons for the current process, computed once. */
export function kumoIcons(): KumoIcons {
  if (cached === undefined) cached = iconsFor();
  return cached;
}

/** Display policy only: never mutate messages sent to the model. */
export function withoutEmoji(text: string): string {
  return text.replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F\u200D]/gu, "");
}
