/**
 * "!command": run a shell command yourself, right from the prompt, without the model.
 * The output is shown in the chat and is NOT sent to the model (no tokens, no cache
 * change). The user typed it, so the permission gate does not apply.
 */
import { spawn } from "node:child_process";

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

export function runShell(command: string, cwd: string = process.cwd(), timeoutMs = TIMEOUT_MS): Promise<ShellResult> {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
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
