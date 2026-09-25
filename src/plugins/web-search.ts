import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DshContext } from "./ctx.js";

/** Stable Cordis plugin name. */
export const name = "kumo-web-search";

/** Service provided so the `web` row can resolve searchProvider from kumo. */
export const KUMO_SEARCH_SERVICE = "kumoSearch";

export type SearchProviderId = "none" | "searxng" | "brave" | "tavily";

export interface SearchConfig {
  provider: SearchProviderId;
  url?: string;
  apiKeyEnv?: string;
}

export interface SearchRequestLike {
  query: string;
  maxResults?: number;
}

export interface SearchSourceLike {
  url: string;
  title?: string;
  snippet?: string;
}

export interface SearchOutcomeLike {
  content?: string;
  sources: SearchSourceLike[];
  truncated: boolean;
}

export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string>; method?: string; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

/** Reads the search section of <DSH_HOME>/kumo.json. Never throws. */
export function readSearchConfig(
  env: NodeJS.ProcessEnv = process.env,
  read: (path: string) => string = (p) => readFileSync(p, "utf8"),
  has: (path: string) => boolean = existsSync,
): SearchConfig {
  const home = env.DSH_HOME ?? join(homedir(), ".kumo");
  const path = join(home, "kumo.json");
  try {
    if (!has(path)) return { provider: "none" };
    const raw = JSON.parse(read(path)) as { search?: { provider?: string; url?: string; apiKeyEnv?: string } };
    const s = raw?.search;
    if (s !== undefined && typeof s.provider === "string" && s.provider !== "none") {
      return s as SearchConfig;
    }
  } catch {
    // fall through
  }
  return { provider: "none" };
}

function clip(sources: SearchSourceLike[], max?: number): SearchOutcomeLike {
  if (max === undefined || sources.length <= max) {
    return { sources, truncated: false };
  }
  return { sources: sources.slice(0, max), truncated: true };
}

/**
 * The provider object. Exported pure so tests can drive it with a fake
 * fetch and env.
 */
export function makeSearchProvider(
  cfg: SearchConfig,
  env: NodeJS.ProcessEnv,
  doFetch: FetchLike,
) {
  return {
    id: "kumo",
    available(): boolean {
      if (cfg.provider === "none") return false;
      if (cfg.provider === "searxng") return cfg.url !== undefined && cfg.url !== "";
      const key = cfg.apiKeyEnv ?? "";
      return env[key] !== undefined && env[key] !== "";
    },
    async search(request: SearchRequestLike, signal?: AbortSignal): Promise<SearchOutcomeLike> {
      const q = encodeURIComponent(request.query);
      if (cfg.provider === "searxng") {
        const res = await doFetch(`${(cfg.url ?? "").replace(/\/+$/, "")}/search?q=${q}&format=json`, { signal });
        if (!res.ok) throw new Error(`searxng: HTTP ${res.status}`);
        const body = await res.json();
        const sources: SearchSourceLike[] = (body?.results ?? []).map((r: any) => ({
          url: String(r.url),
          title: r.title === undefined ? undefined : String(r.title),
          snippet: r.content === undefined ? undefined : String(r.content),
        }));
        return clip(sources, request.maxResults);
      }
      if (cfg.provider === "brave") {
        const key = env[cfg.apiKeyEnv ?? "BRAVE_API_KEY"] ?? "";
        const res = await doFetch(
          `https://api.search.brave.com/res/v1/web/search?q=${q}${request.maxResults !== undefined ? `&count=${request.maxResults}` : ""}`,
          { signal, headers: { "X-Subscription-Token": key, Accept: "application/json" } },
        );
        if (!res.ok) throw new Error(`brave: HTTP ${res.status}`);
        const body = await res.json();
        const sources: SearchSourceLike[] = (body?.web?.results ?? []).map((r: any) => ({
          url: String(r.url),
          title: r.title === undefined ? undefined : String(r.title),
          snippet: r.description === undefined ? undefined : String(r.description),
        }));
        return clip(sources, request.maxResults);
      }
      if (cfg.provider === "tavily") {
        const key = env[cfg.apiKeyEnv ?? "TAVILY_API_KEY"] ?? "";
        const res = await doFetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: key,
            query: request.query,
            max_results: request.maxResults ?? 8,
          }),
          signal,
        });
        if (!res.ok) throw new Error(`tavily: HTTP ${res.status}`);
        const body = await res.json();
        const sources: SearchSourceLike[] = (body?.results ?? []).map((r: any) => ({
          url: String(r.url),
          title: r.title === undefined ? undefined : String(r.title),
          snippet: r.content === undefined ? undefined : String(r.content),
        }));
        return clip(sources, request.maxResults);
      }
      return {
        content:
          "Web search is not configured. Choose a provider in kumo setup (SearXNG, Brave, or Tavily).",
        sources: [],
        truncated: false,
      };
    },
  };
}

export function apply(ctx: DshContext): () => void {
  ctx.provide(KUMO_SEARCH_SERVICE, { id: "kumo" });
  const provider = makeSearchProvider(readSearchConfig(), process.env, fetch as unknown as FetchLike);
  let dispose: (() => void) | undefined;
  // Register when the `web` runtime mounts — never declared as a module-level
  // `inject`, which would deadlock the `web` row behind this plugin.
  ctx.inject(["web"], (c: any) => {
    const web = c.web ?? ctx.get("web");
    if (typeof web?.registerSearchProvider === "function") {
      dispose = web.registerSearchProvider(provider);
    }
  });
  return () => {
    dispose?.();
  };
}
