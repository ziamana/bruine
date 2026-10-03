import { appHome } from "./compat.js";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

export interface Launch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface LaunchOptions {
  /**
   * Pinned dsh entry script (from resolveDshEntry). When set, kumo launches
   * exactly that copy with the current Node binary; when absent it falls back
   * to whatever `dsh` is on the PATH.
   */
  dshEntry?: string;
  /** kumo.json `telemetry`. dsh telemetry is ON upstream, so kumo disables it
   * unless the user opted in. */
  telemetry?: boolean;
  /** Fixed at startup from kumo.json; never changed during a session. */
  tools?: "lean" | "full";
  /** Path implementation, injectable (path.win32) for cross-platform tests. */
  pathMod?: typeof path;
}

/**
 * Build the dsh launch — **pure, no side effects**.
 */
export function buildLaunch(
  argv: string[],
  env: NodeJS.ProcessEnv,
  home: string,
  opts: LaunchOptions = {},
): Launch {
  const pathMod = opts.pathMod ?? path;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) out[key] = value;
  }
  out.DSH_HOME = appHome(env, home, pathMod);
  out.KUMO_TOOLS = opts.tools === "full" ? "full" : "lean";
  if (opts.telemetry !== true) {
    out.DSH_TELEMETRY_DISABLED = "1";
  }
  const appArgs = ["--profile", "bruine", ...argv];
  if (opts.dshEntry !== undefined) {
    return { command: process.execPath, args: [opts.dshEntry, ...appArgs], env: out };
  }
  return { command: "dsh", args: appArgs, env: out };
}

/**
 * Resolve the exact dsh copy installed as a dependency of kumo (the product
 * pins its version; upgrades are a deliberate ticket, never PATH drift).
 */
export function resolveDshEntry(): string | undefined {
  try {
    const pkgJson = require.resolve("@deepseek-ai/dsh/package.json");
    const manifest = JSON.parse(readFileSync(pkgJson, "utf8")) as {
      bin?: string | Record<string, string>;
    };
    const rel = typeof manifest.bin === "object" ? manifest.bin?.dsh : manifest.bin;
    if (typeof rel !== "string" || rel === "") return undefined;
    const script = path.join(path.dirname(pkgJson), rel);
    return existsSync(script) ? script : undefined;
  } catch {
    return undefined;
  }
}

/** Spawn arguments for the pinned dsh copy (or PATH fallback). */
export function dshInvocation(entry: string | undefined, args: string[]): { command: string; args: string[] } {
  if (entry !== undefined) return { command: process.execPath, args: [entry, ...args] };
  return { command: "dsh", args };
}

/** Launch a pinned-dsh subcommand synchronously, inheriting stdio. */
export function runDsh(entry: string | undefined, args: string[], env: Record<string, string>, capture = false): {
  status: number | null;
  error?: NodeJS.ErrnoException;
  output?: string;
} {
  const inv = dshInvocation(entry, args);
  const result = spawnSync(inv.command, inv.args, {
    stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit",
    encoding: capture ? "utf8" : undefined,
    env,
  });
  const output = capture ? `${String(result.stdout ?? "")}${String(result.stderr ?? "")}` : undefined;
  return { status: result.status, ...(result.error ? { error: result.error as NodeJS.ErrnoException } : {}), ...(capture ? { output } : {}) };
}

/** The launcher-only flags kumo answers itself (T11.2: first argument only). */
export function flagMode(argv: string[]): "help" | "version" | null {
  const first = argv[0];
  if (first === "--help" || first === "-h") return "help";
  if (first === "--version" || first === "-V") return "version";
  return null;
}
