/**
 * T29 — read an image out of the system clipboard.
 *
 * A terminal input stream never carries image bytes, so ctrl+v has to ask the
 * OS. Each platform gets its own reader; the first one that is actually
 * installed wins. A missing tool is a normal outcome with one line of advice,
 * never a crash and never a stack trace in the editor.
 */
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { platform } from "node:os";
import { extname } from "node:path";
import { hasTool, runTool } from "../platform/tool.js";

/** Raster formats the dsh attachment store accepts. */
export type ImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

/** The four media types above, from a file extension (never from content). */
const MEDIA_BY_EXT: Record<string, ImageMediaType> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** The dsh local store's own per-image byte ceiling (20 MiB). */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export interface ClipboardImage {
  data: Uint8Array;
  mediaType: ImageMediaType;
  /** Display name for the chip; a bare file name, never a path. */
  name: string;
}

export type ClipboardRead =
  /** An image is in the clipboard. */
  | { kind: "image"; image: ClipboardImage }
  /** The clipboard holds something else (text, nothing at all). */
  | { kind: "none" }
  /** No reader is installed on this machine. */
  | { kind: "no-tool"; install: string }
  /** A reader ran and failed (no display, denied, empty). */
  | { kind: "failed"; detail: string }
  /** An image was read but the store would refuse it. */
  | { kind: "rejected"; reason: string };

/** One platform reader: the binary to run, its args, and what to install. */
export interface ClipboardReader {
  cmd: string;
  args: string[];
  /** How to install it, shown once when the binary is absent. */
  install: string;
}

/** The package that provides each reader, whatever the distro calls it. */
const READER_PACKAGE: Record<string, string> = {
  "wl-paste": "wl-clipboard",
  xclip: "xclip",
  xsel: "xsel",
  pngpaste: "pngpaste",
};

/** The distros that ship pacman, CachyOS included. */
const PACMAN_IDS = new Set(["arch", "cachyos", "endeavouros", "manjaro", "garuda"]);

/** How this machine installs a package, as one line the user can paste. */
export function installHint(cmd: string, id = distroId()): string {
  const pkg = READER_PACKAGE[cmd] ?? cmd;
  if (id === "darwin") return `brew install ${pkg}`;
  if (id === "debian" || id === "ubuntu") return `sudo apt install ${pkg}`;
  if (id === "fedora" || id === "rhel" || id === "nobara") return `sudo dnf install ${pkg}`;
  if (PACMAN_IDS.has(id)) return `sudo pacman -S ${pkg}`;
  if (id === "nixos") return `nix profile install nixpkgs#${pkg}`;
  return `install ${pkg} with your package manager`;
}

/**
 * The distro id from /etc/os-release ("unknown" when it cannot be read). Not
 * memoized on purpose: it is a one-kilobyte file, read once per session when
 * the readers are built, and a cache here would only be global state to test.
 */
export function distroId(read: (p: string) => string = (file) => readFileSync(file, "utf8")): string {
  try {
    return /^ID\s*=\s*"?([a-z0-9_-]+)"?/m.exec(read("/etc/os-release"))?.[1] ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** PNG magic bytes: the clipboard has no filename, so the type comes from here. */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const GIF_MAGIC = [0x47, 0x49, 0x46, 0x38];
/** "RIFF" .... "WEBP" */
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46];
const WEBP_TAG = [0x57, 0x45, 0x42, 0x50];

/** The media type proven by the bytes themselves, not by a file name. */
export function sniffImageMediaType(data: Uint8Array): ImageMediaType | undefined {
  if (startsWith(data, PNG_MAGIC)) return "image/png";
  if (startsWith(data, JPEG_MAGIC)) return "image/jpeg";
  if (startsWith(data, GIF_MAGIC)) return "image/gif";
  if (startsWith(data, RIFF_MAGIC) && startsWith(data.subarray(8), WEBP_TAG)) return "image/webp";
  return undefined;
}

function startsWith(data: Uint8Array, magic: number[]): boolean {
  if (data.length < magic.length) return false;
  return magic.every((byte, i) => data[i] === byte);
}

/** The media type a file extension claims, when it is one we accept. */
export function mediaTypeForPath(file: string): ImageMediaType | undefined {
  return MEDIA_BY_EXT[extname(file).toLowerCase()];
}

/**
 * Readers per platform, most specific first. Linux needs the session type:
 * a Wayland login with only `xclip` installed would otherwise look ready and
 * then read the X11 clipboard of a display that is not there.
 */
export function clipboardReaders(os: NodeJS.Platform = platform()): ClipboardReader[] {
  if (os === "darwin") {
    return [
      { cmd: "pngpaste", args: [], install: installHint("pngpaste") },
      {
        cmd: "osascript",
        // `the clipboard as «class PNGf»` puts the raw PNG on stdout.
        args: ["-e", "the clipboard as «class PNGf»"],
        install: "macOS ships osascript; install pngpaste for a plain PNG",
      },
    ];
  }
  if (os === "win32") {
    return [
      {
        cmd: "powershell",
        args: ["-NoProfile", "-Command", "Get-Clipboard -Format Image"],
        install: "PowerShell 5.1+ (Windows 10/11) provides Get-Clipboard",
      },
    ];
  }
  const wayland = process.env["WAYLAND_DISPLAY"] !== undefined;
  return wayland
    ? [{ cmd: "wl-paste", args: ["--type", "image/png"], install: installHint("wl-paste") }]
    : [
      { cmd: "xclip", args: ["-selection", "clipboard", "-t", "image/png", "-o"], install: installHint("xclip") },
      { cmd: "xsel", args: ["--clipboard", "--output", "--mime-type", "image/png"], install: installHint("xsel") },
    ];
}

/** One reader's outcome, kept raw so the caller can tell "no image" from "no tool". */
export interface RunResult {
  code: number | null;
  stdout: Buffer;
  stderr: string;
}

/** Injectable process runner: tests never spawn a real clipboard tool. */
export type RunClipboard = (reader: ClipboardReader) => Promise<RunResult>;

const runNode: RunClipboard = (reader) =>
  runTool(reader.cmd, reader.args, { maxBuffer: MAX_IMAGE_BYTES * 2, timeoutMs: 5000 });

/** Human size for the chip and for the refusal line. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${String(bytes)} B`;
}

/** The dim line shown when a pasted image is refused. */
export function rejectionNotice(reason: string): string {
  return `Image not attached: ${reason}`;
}

/**
 * Read one image from the clipboard. Tries each installed reader in order; a
 * reader that returns bytes which are not a supported raster means the
 * clipboard simply holds text, so the paste falls through to the editor.
 */
export async function readClipboardImage(
  run: RunClipboard = runNode,
  readers: ClipboardReader[] = clipboardReaders(),
  has: (cmd: string) => Promise<boolean> = hasTool,
): Promise<ClipboardRead> {
  let missing: string | undefined;
  for (const reader of readers) {
    if (!(await has(reader.cmd))) {
      missing ??= reader.install;
      continue;
    }
    const result = await run(reader);
    if (result.code !== 0) {
      // xclip exits 1 on an empty or non-image selection: that is "no image",
      // not a failure worth telling the user about.
      if (result.code === 1 && result.stdout.length === 0) continue;
      return { kind: "failed", detail: firstLine(result.stderr) || `${reader.cmd} failed` };
    }
    if (result.stdout.length === 0) continue;
    const data = new Uint8Array(result.stdout);
    const mediaType = sniffImageMediaType(data);
    if (mediaType === undefined) return { kind: "none" };
    if (data.length > MAX_IMAGE_BYTES) {
      return { kind: "rejected", reason: `${formatBytes(data.length)} is over the ${formatBytes(MAX_IMAGE_BYTES)} limit` };
    }
    return { kind: "image", image: { data, mediaType, name: `clipboard.${extFor(mediaType)}` } };
  }
  if (missing !== undefined) return { kind: "no-tool", install: missing };
  return { kind: "none" };
}

function extFor(mediaType: ImageMediaType): string {
  switch (mediaType) {
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "png";
  }
}

function firstLine(text: string): string {
  return text.split("\n").find((l) => l.trim() !== "")?.trim() ?? "";
}

/**
 * A dragged image path (`/path/x.png`, or a quoted one) offered as an image.
 * The extension decides; the bytes are read and then sniffed, so a `.png` that
 * is really text is refused instead of attached.
 */
export async function readImageFile(file: string): Promise<ClipboardRead> {
  const claimed = mediaTypeForPath(file);
  if (claimed === undefined) return { kind: "none" };
  let data: Uint8Array;
  try {
    data = new Uint8Array(await readFile(file));
  } catch (error) {
    return { kind: "failed", detail: (error as Error).message };
  }
  if (data.length === 0) return { kind: "rejected", reason: "the file is empty" };
  if (data.length > MAX_IMAGE_BYTES) {
    return { kind: "rejected", reason: `${formatBytes(data.length)} is over the ${formatBytes(MAX_IMAGE_BYTES)} limit` };
  }
  const sniffed = sniffImageMediaType(data);
  if (sniffed === undefined) {
    return { kind: "rejected", reason: `${file.split(/[\\/]/).pop() ?? file} is not a PNG, JPEG, WebP or GIF` };
  }
  return {
    kind: "image",
    image: { data, mediaType: sniffed, name: file.split(/[\\/]/).pop() ?? file },
  };
}

/**
 * Does this pasted text look like one image path? Terminals send a drag and
 * drop as the path, sometimes quoted and sometimes with a `file://` prefix.
 */
export function draggedImagePath(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed === "" || /\s/.test(stripQuotes(trimmed))) return undefined;
  const unquoted = stripQuotes(trimmed);
  const file = unquoted.startsWith("file://") ? decodeURIComponent(unquoted.slice("file://".length)) : unquoted;
  return mediaTypeForPath(file) === undefined ? undefined : file;
}

function stripQuotes(text: string): string {
  return (text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"'))
    ? text.slice(1, -1)
    : text;
}
