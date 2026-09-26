/**
 * T36 — running one measurement. `runKumo` spawns the kumo command headless
 * (piped, no TTY) with the bench home and the task prompt, and stops it at the
 * wall-clock limit; `runCheck` runs the task's `check.sh` and reads its verdict.
 * Both are small enough to test with a fake kumo and a shell stub.
 */
import { spawn, spawnSync } from "node:child_process";
import { open, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface RunKumoOptions {
  /** argv[0] + any leading args (e.g. [node, dist/bin.js]). */
  command: string[];
  /** The prompt (task.md) as one argument — kumo sends it before its loop. */
  prompt: string;
  cwd: string;
  env: Record<string, string>;
  /** Wall-clock limit in milliseconds. */
  timeoutMs: number;
  /** kumo's own stdout lands here for post-mortem reading. */
  logPath: string;
  /** Its stderr goes here, and only here: this is what the row calls errors. */
  errLogPath?: string;
}

export interface KumoRun {
  exitCode: number | null;
  signal: string | null;
  wallSec: number;
  timedOut: boolean;
  /**
   * Ctrl+C or a TERM took this run down. The caller must NOT record a verdict:
   * an interrupted run is an unfinished run, and `--resume` has to redo it.
   */
  interrupted: boolean;
  /** First error-ish lines, for the run row. */
  errors: string[];
  logPath: string;
}

/** Spawn kumo once, kill it at the limit, never let it inherit a TTY. */
export function runKumo(opts: RunKumoOptions): Promise<KumoRun> {
  const started = Date.now();
  const errPath = opts.errLogPath ?? `${opts.logPath}.err`;
  return new Promise<KumoRun>((resolveRun) => {
    void Promise.all([open(opts.logPath, "w"), open(errPath, "w")])
      .then(async ([handle, errHandle]) => {
        const child = spawn(opts.command[0] as string, [...opts.command.slice(1), opts.prompt], {
          cwd: opts.cwd,
          env: opts.env,
          stdio: ["ignore", handle.fd, errHandle.fd],
        });
        let timedOut = false;
        let interrupted = false;
        // Ctrl+C (or a TERM from a supervisor) takes the kumo child with it and
        // marks the run unfinished, so the caller skips the verdict.
        const forward = (signal: NodeJS.Signals) => (): void => {
          interrupted = true;
          child.kill(signal);
        };
        const onInt = forward("SIGINT");
        const onTerm = forward("SIGTERM");
        process.on("SIGINT", onInt);
        process.on("SIGTERM", onTerm);
        const done = (run: KumoRun): void => {
          process.off("SIGINT", onInt);
          process.off("SIGTERM", onTerm);
          resolveRun(run);
        };
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
          setTimeout(() => child.kill("SIGKILL"), 3000).unref();
        }, opts.timeoutMs);
        timer.unref();
        child.on("error", (error) => {
          clearTimeout(timer);
          void Promise.all([handle.close(), errHandle.close()]);
          done({
            exitCode: null,
            signal: null,
            wallSec: (Date.now() - started) / 1000,
            timedOut,
            interrupted,
            errors: [`spawn failed: ${error.message}`],
            logPath: opts.logPath,
          });
        });
        child.on("close", (code, signal) => {
          clearTimeout(timer);
          void Promise.all([handle.close(), errHandle.close()]).then(() => {
            done({
              exitCode: code,
              signal: signal ?? null,
              wallSec: (Date.now() - started) / 1000,
              timedOut,
              interrupted,
              errors: [],
              logPath: opts.logPath,
            });
          });
        });
      })
      .catch((error: unknown) => {
        resolveRun({
          exitCode: null,
          signal: null,
          wallSec: 0,
          timedOut: false,
          interrupted: false,
          errors: [`cannot write the run log: ${String(error)}`],
          logPath: opts.logPath,
        });
      });
  });
}

/**
 * What kumo wrote on stderr: its own complaints. An informational line the
 * launcher prints on stdout ("kept your 8 skills…") is not an error.
 */
export async function logErrors(errLogPath: string, limit = 5): Promise<string[]> {
  let text: string;
  try {
    text = await readFile(errLogPath, "utf8");
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").trimEnd();
    if (line.trim() !== "" && !out.includes(line)) out.push(line.slice(0, 200));
    if (out.length >= limit) break;
  }
  return out;
}

export interface CheckResult {
  /** null = the check could not run here (exit 70, or no shell). */
  passed: boolean | null;
  exitCode: number | null;
  /** What check.sh says it checks (`kumo-bench-check-mode:` line). */
  mode: string;
  /** Last useful output line, for the run row / debugging. */
  detail: string;
  seconds: number;
}

const CHECK_MODE = /^kumo-bench-check-mode:\s*(.+)$/m;

/**
 * Run `<taskDir>/check.sh`: exit 0 = pass, 70 = this machine cannot run the
 * check (recorded as "no verdict", never as a failure), anything else = fail.
 */
export function runCheck(
  taskDir: string,
  opts: { timeoutMs?: number; env?: Record<string, string> } = {},
): CheckResult {
  const started = Date.now();
  const shell = process.platform === "win32" ? "bash" : "sh";
  const result = spawnSync(shell, [join(taskDir, "check.sh")], {
    cwd: taskDir,
    encoding: "utf8",
    timeout: opts.timeoutMs ?? 120_000,
    env: { ...process.env, ...opts.env, KUMO_BENCH_TASK_DIR: taskDir },
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const mode = CHECK_MODE.exec(output)?.[1]?.trim() ?? "unspecified";
  const detail = (output.split("\n").map((l) => l.trim()).filter((l) => l !== "").at(-1) ?? "").slice(0, 200);
  const seconds = (Date.now() - started) / 1000;
  const spawnError = result.error as (Error & { code?: string }) | undefined;
  if (spawnError !== undefined && spawnError.code === "ENOENT") {
    return { passed: null, exitCode: null, mode: "no-shell", detail: "no POSIX shell on this machine", seconds };
  }
  const code = result.status;
  if (code === 70) return { passed: null, exitCode: 70, mode, detail: detail || "check could not run here", seconds };
  return { passed: code === 0, exitCode: code, mode, detail, seconds };
}
