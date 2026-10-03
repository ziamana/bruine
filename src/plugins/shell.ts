/**
 * "!command": run a shell command yourself, right from the prompt, without the model.
 * The output is shown in the chat and is NOT sent to the model (no tokens, no cache
 * change). The user typed it, so the permission gate does not apply.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const MAX_OUTPUT = 64 * 1024;
const TIMEOUT_MS = 120_000;
const MAX_LINES_SHOWN = 40;

export function isShellLine(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith("!") && t.slice(1).trim() !== "";
}

export interface ShellResult {
  code: number | null;
  output: string;
  timedOut: boolean;
  truncated: boolean;
}

/** The first `name` on PATH (with Windows' executable suffixes), as a full path. */
function findOnPath(name: string, env: NodeJS.ProcessEnv, exists: (p: string) => boolean, platform: NodeJS.Platform): string | undefined {
  const mod = platform === "win32" ? path.win32 : path.posix;
  const dirs = (env.PATH ?? env.Path ?? "").split(mod.delimiter).filter((d) => d !== "");
  for (const dir of dirs) {
    for (const file of [`${name}.exe`, name]) {
      const full = mod.join(dir, file);
      if (exists(full)) return full;
    }
  }
  return undefined;
}

/**
 * How `!cmd` runs a line. On Windows it is PowerShell (pwsh, else Windows PowerShell), the shell
 * the agent's own commands use there, so `!ls` and `!git status` mean the same thing to the user
 * and to the model; cmd.exe only when neither is installed. The execution policy is bypassed for
 * that one process: the user typed the command, and `npm` on PATH is an `npm.ps1` script that a
 * default Restricted policy refuses to load. Elsewhere it is the user's own shell.
 */
export function shellInvocation(
  command: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = existsSync,
): { file: string; args: string[]; shell: boolean } {
  if (platform === "win32") {
    const powershell = findOnPath("pwsh", env, exists, platform) ?? findOnPath("powershell", env, exists, platform);
    if (powershell !== undefined) {
      return { file: powershell, args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command], shell: false };
    }
  }
  return { file: command, args: [], shell: true };
}

export function runShell(command: string, cwd: string = process.cwd(), timeoutMs = TIMEOUT_MS): Promise<ShellResult> {
  return new Promise((resolve) => {
    const how = shellInvocation(command);
    const child = spawn(how.file, how.args, { cwd, shell: how.shell, env: process.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let output = "";
    let truncated = false;
    let timedOut = false;
    const take = (d: Buffer): void => {
      if (output.length >= MAX_OUTPUT) {
        truncated = true;
        return;
      }
      output += d.toString("utf8");
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: null, output: String(e.message), timedOut, truncated });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output: output.slice(0, MAX_OUTPUT), timedOut, truncated });
    });
  });
}

/** The chat block for a finished command: header, output (capped), status line. */
export function formatShell(command: string, r: ShellResult): string {
  const lines = r.output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const shown = lines.slice(0, MAX_LINES_SHOWN);
  const more = lines.length - shown.length;
  const status = r.timedOut
    ? "stopped after 120 s"
    : r.code === 0
      ? "exit 0"
      : `exit ${r.code === null ? "?" : String(r.code)}`;
  return [
    `! ${command}`,
    ...shown.map((l) => `  ${l}`),
    ...(more > 0 || r.truncated ? [`  … ${String(Math.max(more, 0))} more lines`] : []),
    `  ${status} · not sent to the model`,
  ].join("\n");
}
