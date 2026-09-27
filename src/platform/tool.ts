/**
 * Running an external tool, in one place.
 *
 * kumo shells out for the clipboard on both sides (read an image in T29, write
 * a selection in T56) and for the model probe in T35. Each of those grew its own
 * `execFile` wrapper and its own PATH walk, and two of them were byte-identical
 * copies of the same eighteen lines. This is the canonical version, so the next
 * one is a caller instead of a clone.
 *
 * Nothing here knows what a clipboard is.
 */

import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";

export interface ToolResult {
  /** Exit code, or 1 when the process could not be run at all. */
  code: number;
  stdout: Buffer;
  stderr: string;
}

export interface RunToolOptions {
  /** Written to the tool's stdin, then closed. argv has limits; stdin does not. */
  input?: string;
  /** Tools that fork on purpose never exit inside the timeout, and that is fine. */
  daemon?: boolean;
  timeoutMs?: number;
  maxBuffer?: number;
}

export type RunTool = (cmd: string, args: readonly string[], opts?: RunToolOptions) => Promise<ToolResult>;

function exitCode(error: unknown): number {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "number" ? code : 1;
}

export const DEFAULT_TIMEOUT_MS = 5000;

export const runTool: RunTool = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    const child = execFile(
      cmd,
      [...args],
      {
        encoding: "buffer",
        timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        ...(opts.maxBuffer === undefined ? {} : { maxBuffer: opts.maxBuffer }),
        ...(opts.daemon === true ? { killSignal: "SIGKILL" as const } : {}),
      },
      (error, stdout, stderr) => {
        // A tool killed at the timeout exited on its own terms: `xclip` and
        // `wl-copy` fork so they can go on owning the clipboard. That is the copy
        // working, not a copy that failed.
        const forked = opts.daemon === true && (error as { killed?: boolean } | null)?.killed === true;
        resolve({
          code: error === null || forked ? 0 : exitCode(error),
          stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.alloc(0),
          stderr: forked ? "" : typeof stderr === "string" ? stderr : String(stderr ?? ""),
        });
      },
    );
    if (opts.input !== undefined) child.stdin?.end(opts.input);
    // A spawn failure also reaches the callback, but an unhandled "error" event
    // on a ChildProcess takes the whole process down.
    child.on("error", () => resolve({ code: 1, stdout: Buffer.alloc(0), stderr: "" }));
  });

/** True when the binary exists on PATH, or is an absolute path that does. */
export async function hasTool(cmd: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const names = executableNames(cmd, env);
  if (isAbsolute(cmd) || cmd.includes("/") || cmd.includes("\\")) {
    for (const name of names) if (await exists(name)) return true;
    return false;
  }
  for (const dir of (env["PATH"] ?? "").split(delimiter)) {
    if (dir === "") continue;
    for (const name of names) if (await exists(join(dir, name))) return true;
  }
  return false;
}

/**
 * The command to look for, plus the suffixes Windows appends to a bare name:
 * `clip` on PATH is `clip.exe`, and every caller here asks for the bare name.
 * Read from PATHEXT so a machine that only resolves `.BAT` still works.
 */
function executableNames(cmd: string, env: NodeJS.ProcessEnv): string[] {
  if (process.platform !== "win32") return [cmd];
  const exts = (env["PATHEXT"] ?? ".COM;.EXE;.BAT;.CMD").split(";");
  return [cmd, ...exts.filter((ext) => ext !== "").map((ext) => cmd + ext.toLowerCase())];
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
