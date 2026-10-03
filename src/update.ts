import { runtimeHome, configReadPath, configWritePath } from "./compat.js";
/**
 * T30 — update check + `kumo update`.
 *
 * At launch kumo fires a background check (never delays the UI): at most
 * once per 24 h a plain `GET https://registry.npmjs.org/kumo-code/latest`
 * (2 s timeout), the result cached in `$DSH_HOME/update-check.json` as
 * `{ checkedAt, latest }`. When the cached `latest` is newer than the
 * running version, the session shows one notice line above the editor
 * (T24 notice style, stays until the first prompt).
 *
 * Privacy: the GET is the only traffic — no id, no version in headers
 * beyond npm's default. The check is off when kumo.json says
 * `updateCheck: false`, when `KUMO_NO_UPDATE_CHECK=1`, whenever `CI` is
 * set, and whenever stdout is not a TTY. `kumo update` never installs
 * anything without an explicit yes, and a developer (git/link) install is
 * never touched at all.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path, { join } from "node:path";

export const REGISTRY_LATEST = "https://registry.npmjs.org/kumo-code/latest";
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

/** The kumo home the session and the launcher both use (T26 convention). */
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
  if (env.KUMO_NO_UPDATE_CHECK === "1") return false;
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

/** The exact notice text (T24 notice style, one line). */
export function formatUpdateNotice(latest: string, current: string): string {
  return `kumo ${latest} is available (you have ${current}). Run: kumo update`;
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

/** kumo.json, best effort (absent or broken → {}). */
export async function readKumoJsonDoc(dshHome: string): Promise<Record<string, unknown>> {
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
  /** Skip reading kumo.json (caller resolved `updateCheck` already). */
  doc?: Record<string, unknown>;
}): Promise<CheckOutcome> {
  const pathMod = opts.pathMod ?? path;
  const now = opts.now?.() ?? Date.now();
  const doc = opts.doc ?? (await readKumoJsonDoc(opts.dshHome));
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
  if (cached !== undefined && now - cached.checkedAt < CHECK_INTERVAL_MS) {
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

/** How kumo was installed, from the real path of the running entry script. */
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
  if (has("/node_modules/kumo-code/")) return "npm";
  return "developer";
}

/** kumo.json `updateCheck` (undefined = never chosen = default on). */
export function readUpdateCheckChoice(
  doc: Record<string, unknown>,
): boolean | undefined {
  return typeof doc.updateCheck === "boolean" ? doc.updateCheck : undefined;
}

/** Merge `updateCheck` into kumo.json (0600, atomic); keeps every other key. */
export async function setUpdateCheck(dshHome: string, value: boolean): Promise<void> {
  const doc = await readKumoJsonDoc(dshHome);
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
      return ["npm", "install", "-g", "kumo-code@latest"];
    case "pnpm":
      return ["pnpm", "add", "-g", "kumo-code@latest"];
    case "bun":
      return ["bun", "add", "-g", "kumo-code@latest"];
    case "developer":
      return undefined;
  }
}

