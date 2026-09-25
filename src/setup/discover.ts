/**
 * Server discovery for kumo setup (T21.1): localhost ports, opt-in /24 scans
 * of PRIVATE interfaces only, and explicit Tailscale peers. A public address
 * is rejected before any request goes out.
 */
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";

export type DiscoverySource = "localhost" | "network" | "tailscale" | "manual";

export interface Discovered {
  source: DiscoverySource;
  host: string;
  port: number;
  baseUrl: string;
  models: string[];
  /** Per-model server facts (context window comes from the SERVER). */
  modelInfos: ModelInfo[];
}

/**
 * One model as the server advertises it. `contextWindow` is the server's
 * configured `n_ctx` — NEVER the training size (`n_ctx_train`), which may be
 * far larger than what the deployment can actually serve.
 */
export interface ModelInfo {
  id: string;
  contextWindow?: number;
}

/** Ports probed on localhost (T21 adds 5000 to the v0.1 list). */
export const LOCAL_PORTS = [
  8080, 8081, 8082, 8083, 8084, 8085, 8086, 8087, 8088, 8089, 8090,
  11434, 1234, 8000, 5000,
];

type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

function positiveInt(v: unknown): number | undefined {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : undefined;
}

/**
 * Accepts the OpenAI shape ({data:[{id, meta:{n_ctx}}]}) and the llama.cpp
 * shape ({models:[…]}). `meta.n_ctx` is the served context window;
 * `n_ctx_train` is deliberately ignored.
 */
export function normalizeModelInfos(body: any): ModelInfo[] {
  const raw: any[] = Array.isArray(body?.data)
    ? body.data
    : Array.isArray(body?.models)
      ? body.models
      : [];
  const out: ModelInfo[] = [];
  for (const m of raw) {
    const idRaw = m?.id ?? m?.model ?? m?.name;
    const id = idRaw === undefined || idRaw === null ? "" : String(idRaw);
    if (id === "" || id === "undefined") continue;
    const ctx = positiveInt(m?.meta?.n_ctx) ?? positiveInt(m?.n_ctx);
    out.push(ctx === undefined ? { id } : { id, contextWindow: ctx });
  }
  return out;
}

/** ids only, from {@link normalizeModelInfos}. */
export function normalizeModelIds(body: any): string[] {
  return normalizeModelInfos(body).map((m) => m.id);
}

/** Is this dotted IPv4 in a private range we may scan (127 included)? */
export function isPrivateIPv4(ip: string): boolean {
  const p = ip.trim().split(".");
  if (p.length !== 4) return false;
  const n = p.map((x) => Number(x));
  if (n.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return false;
  const [a, b] = n;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b !== undefined && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/** Tailscale's CGNAT range 100.64.0.0/10 — probed host-by-host, never swept. */
export function isTailscaleIPv4(ip: string): boolean {
  const p = ip.trim().split(".").map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x))) return false;
  return p[0] === 100 && p[1] !== undefined && p[1] >= 64 && p[1] <= 127;
}

/** IPv4 addresses of the private /8 /12 /16 ranges kumo may scan. */
export function privateInterfaceIPv4(
  ifs: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): string[] {
  const out: string[] = [];
  for (const list of Object.values(ifs)) {
    for (const i of list ?? []) {
      if (i.family === "IPv4" && !i.internal && isPrivateIPv4(i.address)) {
        out.push(i.address);
      }
    }
  }
  return out;
}

/** The /24 an IPv4 belongs to, as `a.b.c.0/24`. */
export function cidr24Of(ip: string): string {
  const [a, b, c] = ip.split(".");
  return `${a}.${b}.${c}.0/24`;
}

/** The 254 usable hosts of a /24 like `a.b.c.0/24`. */
export function hostsOf24(cidr: string): string[] {
  const m = /^(\d+)\.(\d+)\.(\d+)\.0\/24$/.exec(cidr.trim());
  if (m === null || m[1] === undefined || m[2] === undefined || m[3] === undefined) {
    throw new Error(`not a /24 IPv4 range: ${cidr}`);
  }
  const base = `${m[1]}.${m[2]}.${m[3]}`;
  return Array.from({ length: 254 }, (_, i) => `${base}.${String(i + 1)}`);
}

/**
 * Refuse anything that is not private BEFORE any request is issued (T21
 * acceptance). Tailscale CGNAT IPs are allowed as explicit single hosts.
 */
export function assertScannableHosts(hosts: Iterable<string>): void {
  for (const host of hosts) {
    if (!isPrivateIPv4(host) && !isTailscaleIPv4(host)) {
      throw new Error(`refusing to scan non-private address ${host}`);
    }
  }
}

export interface ScanOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  ports?: number[];
  concurrency?: number;
}

/** One GET /v1/models on host:port; undefined on any failure. */
export async function probeServer(
  host: string,
  port: number,
  opts: ScanOptions & { source?: DiscoverySource } = {},
): Promise<Discovered | undefined> {
  const doFetch = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  const timeoutMs = opts.timeoutMs ?? 800;
  const baseUrl = `http://${host}:${String(port)}/v1`;
  try {
    const res = await doFetch(`${baseUrl}/models`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return undefined;
    let modelInfos = normalizeModelInfos(await res.json());
    if (modelInfos.length === 0) return undefined;
    if (modelInfos.every((m) => m.contextWindow === undefined)) {
      // llama.cpp exposes the configured generation settings on /props.
      modelInfos = await applyPropsContext(host, port, modelInfos, doFetch, timeoutMs);
    }
    return {
      source: opts.source ?? "localhost",
      host,
      port,
      baseUrl,
      models: modelInfos.map((m) => m.id),
      modelInfos,
    };
  } catch {
    return undefined;
  }
}

async function applyPropsContext(
  host: string,
  port: number,
  infos: ModelInfo[],
  doFetch: FetchLike,
  timeoutMs: number,
): Promise<ModelInfo[]> {
  try {
    const res = await doFetch(`http://${host}:${String(port)}/props`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return infos;
    const props = await res.json();
    const nctx =
      positiveInt(props?.default_generation_settings?.n_ctx) ?? positiveInt(props?.n_ctx);
    if (nctx === undefined) return infos;
    return infos.map((m) => (m.contextWindow === undefined ? { ...m, contextWindow: nctx } : m));
  } catch {
    return infos;
  }
}

/** Bounded-concurrency map; results keep input order. */
async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

/** Localhost: every port of {@link LOCAL_PORTS} in flight (800 ms each). */
export async function scanLocalhosts(opts: ScanOptions = {}): Promise<Discovered[]> {
  const ports = opts.ports ?? LOCAL_PORTS;
  const hits = await mapPool(ports, opts.concurrency ?? 64, (p) =>
    probeServer("127.0.0.1", p, { ...opts, source: "localhost" }),
  );
  return hits.filter((h): h is Discovered => h !== undefined);
}

/**
 * Scan /24s for private interfaces: same ports, 800 ms timeout, max 64 in
 * flight, every target validated BEFORE the first request.
 */
export async function scanNetwork(
  cidrs: string[],
  opts: ScanOptions = {},
): Promise<Discovered[]> {
  const hosts = [...new Set(cidrs.flatMap(hostsOf24))];
  assertScannableHosts(hosts); // throws on a public range before any fetch
  const ports = opts.ports ?? LOCAL_PORTS;
  const targets: Array<[string, number]> = hosts.flatMap((h) =>
    ports.map((p) => [h, p] as [string, number]),
  );
  const hits = await mapPool(targets, opts.concurrency ?? 64, ([h, p]) =>
    probeServer(h, p, { ...opts, source: "network" }),
  );
  return hits.filter((h): h is Discovered => h !== undefined);
}

export interface TailscaleStatus {
  Self?: { IPv4?: string };
  Peer?: Record<string, { IP?: string; IPv4?: string; HostName?: string }>;
}

/** Explicit Tailscale peer IPs (plus this host's tailnet IP). Never sweeps 100.64/10. */
export function tailscalePeerIPs(
  run: (cmd: string, args: string[]) => SpawnSyncReturns<string> = (c, a) =>
    spawnSync(c, a, { encoding: "utf8" }),
): string[] {
  let r: SpawnSyncReturns<string>;
  try {
    r = run("tailscale", ["status", "--json"]);
  } catch {
    return [];
  }
  if (r.error !== undefined || r.status !== 0 || typeof r.stdout !== "string") return [];
  try {
    const status = JSON.parse(r.stdout) as TailscaleStatus;
    const ips: string[] = [];
    if (typeof status.Self?.IPv4 === "string") ips.push(status.Self.IPv4);
    for (const peer of Object.values(status.Peer ?? {})) {
      const ip = peer.IP ?? peer.IPv4;
      if (typeof ip === "string") ips.push(ip);
    }
    return [...new Set(ips.filter((ip) => isTailscaleIPv4(ip)))];
  } catch {
    return [];
  }
}

export async function scanTailscale(
  opts: ScanOptions & {
    runTailscale?: (cmd: string, args: string[]) => SpawnSyncReturns<string>;
  } = {},
): Promise<Discovered[]> {
  const ips = tailscalePeerIPs(opts.runTailscale);
  if (ips.length === 0) return [];
  assertScannableHosts(ips);
  const ports = opts.ports ?? LOCAL_PORTS;
  const targets = ips.flatMap((h) => ports.map((p) => [h, p] as [string, number]));
  const hits = await mapPool(targets, opts.concurrency ?? 64, ([h, p]) =>
    probeServer(h, p, { ...opts, source: "tailscale" }),
  );
  return hits.filter((h): h is Discovered => h !== undefined);
}

/** Human label for a discovery in the wizard lists. */
export function discoveredLabel(d: Discovered): string {
  return `${d.baseUrl} · ${String(d.models.length)} model${d.models.length === 1 ? "" : "s"}`;
}
