import { appEnv, runtimeHome, configReadPath, configWritePath } from "./compat.js";
/**
 * T30 — update check + `bruine update`.
 *
 * At launch bruine fires a background check (never delays the UI): at most
 * once per 24 h a plain `GET https://registry.npmjs.org/@ziamana%2Fbruine/latest`
 * (2 s timeout), the result cached in `$DSH_HOME/update-check.json` as
 * `{ checkedAt, latest }`. When the cached `latest` is newer than the
 * running version, the session shows one notice line above the editor
 * (T24 notice style, stays until the first prompt).
 *
 * Privacy: the GET is the only traffic — no id, no version in headers
 * beyond npm's default. The check is off when bruine.json says
 * `updateCheck: false`, when `BRUINE_NO_UPDATE_CHECK=1`, whenever `CI` is
 * set, and whenever stdout is not a TTY. `bruine update` never installs
 * anything without an explicit yes, and a developer (git/link) install is
 * never touched at all.
 */
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path, { join } from "node:path";

/** The npm name: the unscoped "bruine" is refused by npm (too close to "byline"). */
export const NPM_PACKAGE = "@ziamana/bruine";
export const REGISTRY_LATEST = `https://registry.npmjs.org/${NPM_PACKAGE.replace("/", "%2F")}/latest`;
export const UPDATE_CACHE_FILE = "update-check.json";
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface UpdateCache {
  /** epoch ms of the last successful registry answer */
  checkedAt: number;
  latest: string;
}

export type CheckOutcome =
  | { ran: "disabled" }
  | { ran: "cached"; cache: UpdateCache }
  | { ran: "fetched"; cache: UpdateCache }
  | { ran: "failed" };

export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; json(): Promise<any> }>;

/** The bruine home the session and the launcher both use (T26 convention). */
export function resolveDshHome(
  env: NodeJS.ProcessEnv = process.env,
  pathMod: typeof path = path,
): string {
  return runtimeHome(env, pathMod);
}

export function updateCachePath(dshHome: string, pathMod: typeof path = path): string {
  return pathMod.join(dshHome, UPDATE_CACHE_FILE);
}

/** Off switches: config, env, CI, and any non-interactive stdout. */
export function updateCheckEnabled(opts: {
  doc?: Record<string, unknown> | undefined;
  env?: NodeJS.ProcessEnv;
  isTTY: boolean;
}): boolean {
  const env = opts.env ?? process.env;
  if (appEnv("NO_UPDATE_CHECK", env) === "1") return false;
  if (env.CI !== undefined && env.CI !== "") return false;
  if (opts.doc?.updateCheck === false) return false;
  return opts.isTTY;
}

/** `major.minor.patch` (prerelease suffixes stripped); null when unparseable. */
export function parseSemver(version: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
  if (m === null || m[1] === undefined || m[2] === undefined || m[3] === undefined) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Negative when a < b, 0 when equal, positive when a > b; null if unparseable. */
export function compareSemver(a: string, b: string): number | null {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (pa === null || pb === null) return null;
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** The exact notice text (T24 notice style, one line): what is new, and the one thing to type. */
export function formatUpdateNotice(latest: string, current: string): string {
  return `bruine ${latest} is available (you have ${current}). Type /update to install it.`;
}

/** The notice to show at startup, or undefined when nothing newer is known. */
export function noticeForStartup(opts: {
  cache: UpdateCache | undefined;
  current: string;
}): string | undefined {
  if (opts.cache === undefined) return undefined;
  const cmp = compareSemver(opts.cache.latest, opts.current);
  if (cmp === null || cmp <= 0) return undefined;
  return formatUpdateNotice(opts.cache.latest, opts.current);
}

export async function readUpdateCache(
  dshHome: string,
  pathMod: typeof path = path,
): Promise<UpdateCache | undefined> {
  try {
    const doc = JSON.parse(
      await readFile(updateCachePath(dshHome, pathMod), "utf8"),
    ) as { checkedAt?: unknown; latest?: unknown };
    if (typeof doc.checkedAt !== "number" || typeof doc.latest !== "string") return undefined;
    return { checkedAt: doc.checkedAt, latest: doc.latest };
  } catch {
    return undefined;
  }
}

async function writeUpdateCache(
  dshHome: string,
  cache: UpdateCache,
  pathMod: typeof path,
): Promise<void> {
  const file = updateCachePath(dshHome, pathMod);
  await mkdir(pathMod.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

/** bruine.json, best effort (absent or broken → {}). */
export async function readBruineJsonDoc(dshHome: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(
      await readFile(configReadPath(dshHome), "utf8"),
    ) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * The 24 h-throttled registry check. Gated by the off switches; a fresh
 * cache means no request at all. Any network or parse failure is silent
 * (the previous cache stays) — the check never errors into the user.
 */
export async function checkForUpdate(opts: {
  dshHome: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** Injectable clock (tests). */
  now?: () => number;
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
  pathMod?: typeof path;
  /** Skip reading bruine.json (caller resolved `updateCheck` already). */
  doc?: Record<string, unknown>;
  /** Ask the registry even when the cached answer is fresh (`/update`). */
  force?: boolean;
}): Promise<CheckOutcome> {
  const pathMod = opts.pathMod ?? path;
  const now = opts.now?.() ?? Date.now();
  const doc = opts.doc ?? (await readBruineJsonDoc(opts.dshHome));
  if (
    !updateCheckEnabled({
      doc,
      ...(opts.env !== undefined ? { env: opts.env } : {}),
      isTTY: opts.isTTY ?? process.stdout.isTTY === true,
    })
  ) {
    return { ran: "disabled" };
  }
  const cached = await readUpdateCache(opts.dshHome, pathMod);
  if (opts.force !== true && cached !== undefined && now - cached.checkedAt < CHECK_INTERVAL_MS) {
    return { ran: "cached", cache: cached };
  }
  try {
    const doFetch = opts.fetchImpl ?? (fetch as unknown as FetchLike);
    const res = await doFetch(REGISTRY_LATEST, {
      signal: AbortSignal.timeout(opts.timeoutMs ?? 2000),
    });
    if (!res.ok) return { ran: "failed" };
    const body = await res.json();
    const latest = (body as { version?: unknown })?.version;
    if (typeof latest !== "string" || latest === "") return { ran: "failed" };
    const cache: UpdateCache = { checkedAt: now, latest };
    await writeUpdateCache(opts.dshHome, cache, pathMod);
    return { ran: "fetched", cache };
  } catch {
    return { ran: "failed" };
  }
}

/** Where the launch's check is kept, so the session can wait for it (one process, any module copy). */
const PENDING_CHECK = Symbol.for("bruine.updateCheck");

/**
 * The launch's background check, remembered: the session shows its answer the moment it lands,
 * on the very first launch too, instead of only the next day from the cache.
 */
export function startUpdateCheck(opts: Parameters<typeof checkForUpdate>[0]): Promise<CheckOutcome> {
  const check = checkForUpdate(opts).catch((): CheckOutcome => ({ ran: "failed" }));
  (globalThis as Record<symbol, unknown>)[PENDING_CHECK] = check;
  return check;
}

/** The check the launcher started, if it did. */
export function pendingUpdateCheck(): Promise<CheckOutcome> | undefined {
  return (globalThis as Record<symbol, unknown>)[PENDING_CHECK] as Promise<CheckOutcome> | undefined;
}

/** The newer version an outcome knows of, if any. */
export function newerVersion(outcome: CheckOutcome | undefined, current: string): string | undefined {
  if (outcome === undefined || !("cache" in outcome)) return undefined;
  const cmp = compareSemver(outcome.cache.latest, current);
  return cmp !== null && cmp > 0 ? outcome.cache.latest : undefined;
}

/** How bruine was installed, from the real path of the running entry script. */
export type InstallKind = "npm" | "pnpm" | "bun" | "developer";

export function detectInstallKind(realPath: string): InstallKind {
  const p = realPath.replaceAll("\\", "/").toLowerCase();
  const has = (needle: string): boolean => p.includes(needle);
  // bun global root: the user home's .bun/install/global (Windows: bun's
  // APPDATA install/global).
  if (has("/.bun/") && has("global/node_modules")) return "bun";
  // pnpm store entry, or a pnpm global root: .pnpm-global, pnpm/global,
  // pnpm/node_modules (covers LOCALAPPDATA/pnpm, .local/share/pnpm,
  // Library/pnpm homes).
  if (has("/.pnpm/") || has("/.pnpm-global/") || has("/pnpm/global/") || has("/pnpm/node_modules/")) {
    return "pnpm";
  }
  if (has("/node_modules/@ziamana/bruine/") || has("/node_modules/bruine/") || has("/node_modules/kumo-code/")) return "npm";
  return "developer";
}

/** bruine.json `updateCheck` (undefined = never chosen = default on). */
export function readUpdateCheckChoice(
  doc: Record<string, unknown>,
): boolean | undefined {
  return typeof doc.updateCheck === "boolean" ? doc.updateCheck : undefined;
}

/** Merge `updateCheck` into bruine.json (0600, atomic); keeps every other key. */
export async function setUpdateCheck(dshHome: string, value: boolean): Promise<void> {
  const doc = await readBruineJsonDoc(dshHome);
  doc.updateCheck = value;
  const file = configWritePath(dshHome);
  await mkdir(dshHome, { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(doc, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, file);
}

/** The exact command for this install kind; developer: never run anything. */
export function updateCommand(kind: InstallKind): string[] | undefined {
  switch (kind) {
    case "npm":
      return ["npm", "install", "-g", `${NPM_PACKAGE}@latest`];
    case "pnpm":
      return ["pnpm", "add", "-g", `${NPM_PACKAGE}@latest`];
    case "bun":
      return ["bun", "add", "-g", `${NPM_PACKAGE}@latest`];
    case "developer":
      return undefined;
  }
}


/** How the running bruine was installed, from its entry script's real path. */
export function installKindOf(entry: string | undefined = process.argv[1]): InstallKind {
  if (entry === undefined) return "developer";
  let real = entry;
  try {
    real = realpathSync(entry);
  } catch {
    // already a real path, or unreadable: detect from what we have
  }
  return detectInstallKind(real);
}

/** What the installer printed, and whether it worked. */
export interface InstallResult {
  ok: boolean;
  code: number | null;
  output: string;
}

/**
 * Run the installer command quietly (the session's screen is not a place for npm's progress),
 * and keep what it said for the failure message.
 */
export function runInstaller(cmd: readonly string[]): Promise<InstallResult> {
  return new Promise((resolve) => {
    let output = "";
    let child;
    try {
      child = spawn(cmd[0] as string, cmd.slice(1), { shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolve({ ok: false, code: null, output: (error as Error).message });
      return;
    }
    child.stdout?.on("data", (d: Buffer) => (output += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (output += d.toString()));
    child.on("error", (error) => resolve({ ok: false, code: null, output: error.message }));
    child.on("close", (code) => resolve({ ok: code === 0, code, output }));
  });
}

/** The last meaningful line of an installer's output, for a one-line failure. */
export function lastLine(output: string): string {
  const lines = output.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  return lines.at(-1) ?? "";
}
