import { appEnv } from "../compat.js";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * OSC 8 hyperlinks for the paths a tool touched.
 *
 * A path in a tool line is the one thing in a coding session worth clicking: it
 * opens the file, it survives a copy (the text stays plain), and it costs one
 * escape sequence. pi-tui's `truncateToWidth` and `string-width` both count an
 * OSC 8 sequence as zero cells and never split one, so a link cannot break the
 * transcript's width budget the way a stray SGR can.
 */

/** True when a display string may carry an OSC 8 link without being counted wrong. */
export function canLink(): boolean {
  // A link is invisible on a terminal that ignores OSC 8 and a liability on one
  // that mis-parses it, so the ASCII fallback stays plain.
  return appEnv("NO_LINKS") !== "1";
}

/**
 * Wrap `text` in an OSC 8 link to an absolute path. Returns `text` untouched
 * when there is nothing safe to link: a relative path has no target, and
 * `pathToFileURL` throws on a path with a NUL in it.
 */
export function fileLink(text: string, absolutePath: string): string {
  if (!canLink() || text === "" || absolutePath === "" || !isAbsolute(absolutePath)) return text;
  let url: string;
  try {
    url = pathToFileURL(absolutePath).href;
  } catch {
    return text;
  }
  return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
}

/** The argument keys whose value is a filesystem path. */
const PATH_KEYS = ["path", "file_path"];

/**
 * Link a tool summary when it *is* a path. The summary is displayed relative to
 * the cwd and linked to the absolute path, so the line stays short and the link
 * still opens the right file. A summary that was clipped, or an argument that is
 * not a path, comes back unchanged.
 */
export function linkToolSummary(summary: string, rawArgs: string): string {
  if (!canLink() || summary === "" || rawArgs === "") return summary;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArgs);
  } catch {
    return summary; // still streaming: not JSON yet
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return summary;
  const obj = parsed as Record<string, unknown>;
  const key = PATH_KEYS.find((k) => typeof obj[k] === "string");
  if (key === undefined) return summary;
  const absolute = String(obj[key]);
  // Only link a summary that still shows the path in full: a clipped path is a
  // prefix, and a link whose label lies about its target is worse than no link.
  if (summary.includes("…") || summary.includes("...")) return summary;
  if (!summary.includes(absolute.replace(/^\.\//, "")) && summary !== absolute) {
    // The summary was made relative to the cwd, so match on the basename too.
    if (!summary.endsWith(absolute.split("/").pop() ?? absolute)) return summary;
  }
  return fileLink(summary, absolute);
}
