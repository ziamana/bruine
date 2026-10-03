/**
 * T56 — write text to the system clipboard.
 *
 * The mirror of `src/image/clipboard.ts`: T29 reads images out, this writes
 * text back. Same platform split, same "first tool that is actually installed
 * wins", same refusal to crash when nothing is there.
 *
 * Two rules the read path does not have to care about:
 *
 * - The text goes on **stdin**, never in argv. A selection can be a megabyte of
 *   scrollback, and argv has limits the shell enforces before we do.
 * - The tools daemonize. `xclip` and `wl-copy` fork so they can go on owning
 *   the selection after bruine hands it over, which means the parent exits at
 *   once and, on some builds, not at all within our timeout. A writer that is
 *   still alive after `DAEMON_GRACE_MS` did its job.
 */

import { platform } from "node:os";
import { installHint } from "../image/clipboard.js";
import { hasTool, runTool } from "../platform/tool.js";

/** One way of getting text into the clipboard on this machine. */
export interface ClipboardWriter {
  cmd: string;
  args: string[];
  /** What to tell the user when this is the tool that is missing. */
  install: string;
}

/** How long a writer gets to exit before it is assumed to have forked. */
export const DAEMON_GRACE_MS = 1500;

export interface WriterRun {
  code: number;
  stderr: string;
}


export type RunWriter = (writer: ClipboardWriter, text: string) => Promise<WriterRun>;
export type HasBinary = (cmd: string) => Promise<boolean>;

export type CopyOutcome =
  | { ok: true; via: string }
  | { ok: false; reason: string; install?: string };

/**
 * Writers for this session, most reliable first.
 *
 * A Wayland login is checked before X11 on purpose: a Wayland session with only
 * `xclip` installed would otherwise look ready and then write to the X11
 * clipboard of a display that is not there. Same reasoning as the read path.
 */
export function clipboardWriters(
  os: NodeJS.Platform = platform(),
  env: NodeJS.ProcessEnv = process.env,
): ClipboardWriter[] {
  if (os === "darwin") {
    return [{ cmd: "pbcopy", args: [], install: "macOS ships pbcopy" }];
  }
  if (os === "win32") {
    return [{ cmd: "clip", args: [], install: "Windows ships clip" }];
  }
  if (env["WAYLAND_DISPLAY"] !== undefined) {
    return [{ cmd: "wl-copy", args: [], install: installHint("wl-copy") }];
  }
  return [
    { cmd: "xclip", args: ["-selection", "clipboard", "-i"], install: installHint("xclip") },
    { cmd: "xsel", args: ["--clipboard", "--input"], install: installHint("xsel") },
  ];
}

const runWriter: RunWriter = (writer, text) =>
  runTool(writer.cmd, writer.args, {
    input: text,
    // The tool forks so it can go on owning the selection; a writer still alive
    // at the timeout did its job.
    daemon: true,
    timeoutMs: DAEMON_GRACE_MS,
  });

export interface CopyDeps {
  writers?: ClipboardWriter[];
  run?: RunWriter;
  has?: HasBinary;
  /**
   * OSC 52 escape, already encoded by the caller. Supplied by the UI because
   * this module must not touch the terminal itself, and omitted in tests that
   * only care about the writer order.
   */
  osc52?: (text: string) => void;
}

/** `ESC ] 52 ; c ; <base64> BEL`, the escape a terminal turns into a clipboard write. */
export function osc52Sequence(text: string): string {
  return `\x1b]52;c;${Buffer.from(text, "utf8").toString("base64")}\x07`;
}

/**
 * What the corner says after a successful copy.
 *
 * "Sent" and not "Copied" for OSC 52, on purpose: the escape is a request, and
 * a terminal that accepts it and writes nothing is common enough (Konsole with
 * clipboard access off, tmux without the passthrough) that claiming the copy
 * would be a lie the user finds out about at paste time.
 */
export function copyNotice(text: string, via: string): string {
  const size = `${text.length} char${text.length === 1 ? "" : "s"}`;
  return via === "OSC 52" ? `Sent ${size} to the terminal` : `Copied ${size} with ${via}`;
}

/** What the corner says when nothing was copied, with the way out when there is one. */
export function copyFailureNotice(reason: string, install?: string): string {
  return install === undefined ? `Not copied: ${reason}` : `Not copied: ${reason}. ${install}`;
}

/**
 * Put `text` on the clipboard, and say honestly how it went.
 *
 * OSC 52 is the last resort, never the first: a terminal can accept the escape
 * and still leave the clipboard alone, so a native writer that is present is
 * always preferred over an escape that cannot be verified.
 */
export async function copyTextToClipboard(text: string, deps: CopyDeps = {}): Promise<CopyOutcome> {
  const writers = deps.writers ?? clipboardWriters();
  const run = deps.run ?? runWriter;
  const has = deps.has ?? hasTool;

  for (const writer of writers) {
    if (!(await has(writer.cmd))) continue;
    let result: WriterRun;
    try {
      result = await run(writer, text);
    } catch {
      return { ok: false, reason: `${writer.cmd} failed` };
    }
    if (result.code !== 0) {
      const detail = result.stderr.split("\n")[0]?.trim();
      return { ok: false, reason: detail === undefined || detail === "" ? `${writer.cmd} failed` : detail };
    }
    return { ok: true, via: writer.cmd };
  }

  if (deps.osc52 !== undefined) {
    deps.osc52(text);
    // Reported as what it is: the terminal may or may not have honoured it.
    return { ok: true, via: "OSC 52" };
  }

  const first = writers[0];
  return {
    ok: false,
    reason: "No clipboard tool on this machine",
    ...(first === undefined ? {} : { install: first.install }),
  };
}
