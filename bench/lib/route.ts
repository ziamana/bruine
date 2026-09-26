/**
 * T36 — the route under test, read from a real settings.yaml. The bench never
 * guesses a server: it copies one route out of the user's own file, so the
 * model, its reasoning block and its context window are exactly the ones the
 * user runs with.
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { fetchProps, detectTemplateCaps, type TemplateCaps } from "../../src/setup/discover.js";

export interface ProviderRoute {
  provider: string;
  /** The provider block as written in settings.yaml (`llm-pi-ai.providers`). */
  config: Record<string, unknown>;
  /** The model entry, when the route declares it. */
  model?: Record<string, unknown>;
}

export interface SettingsRoutes {
  providers: Record<string, Record<string, unknown>>;
  defaultRoute: { provider: string; model: string } | undefined;
  modelsOf(provider: string): Record<string, unknown>[];
}

export async function readSettingsRoutes(settingsPath: string): Promise<SettingsRoutes> {
  const doc = parseYaml(await readFile(settingsPath, "utf8")) as Record<string, any>;
  const providers = (doc?.["llm-pi-ai"]?.providers ?? {}) as Record<string, Record<string, unknown>>;
  const def = doc?.["agent-default-model"];
  const defaultRoute =
    typeof def?.provider === "string" && typeof def?.model === "string"
      ? { provider: def.provider, model: def.model }
      : undefined;
  return {
    providers,
    defaultRoute,
    modelsOf(provider: string): Record<string, unknown>[] {
      const models = providers[provider]?.["models"];
      return Array.isArray(models) ? (models as Record<string, unknown>[]) : [];
    },
  };
}

/** One provider/model pair, or an error naming what the file does contain. */
export function pickRoute(
  routes: SettingsRoutes,
  provider: string,
  model: string,
): ProviderRoute {
  const config = routes.providers[provider];
  if (config === undefined) {
    const known = Object.keys(routes.providers).sort();
    throw new Error(
      `route "${provider}/${model}": settings.yaml has no llm-pi-ai provider "${provider}"` +
        (known.length > 0 ? ` (known: ${known.join(", ")})` : " (no provider at all)"),
    );
  }
  const models = routes.modelsOf(provider);
  const entry = models.find((m) => m["id"] === model);
  return { provider, config, ...(entry !== undefined ? { model: entry } : {}) };
}

/** Human name of a route: the model entry's `name:`, else its id. */
export function routeModelName(route: ProviderRoute, model: string): string {
  const name = route.model?.["name"];
  if (typeof name === "string" && name.trim() !== "") return name.trim();
  const base = model.split(/[\\/]/).at(-1) ?? model;
  return base.replace(/\.gguf$/i, "");
}

/** What the route needs for its key: the env var name, if any. */
export function routeKeyEnv(route: ProviderRoute): string | undefined {
  const name = route.config["apiKeyEnv"];
  return typeof name === "string" && name.trim() !== "" ? name.trim() : undefined;
}

/** Base URL of the route (the origin `/props` is served from). */
export function routeBaseUrl(route: ProviderRoute): string | undefined {
  const base = route.config["baseURL"];
  return typeof base === "string" && base.trim() !== "" ? base.trim() : undefined;
}

/** The server facts recorded in every result file (T36: never mix presets). */
export interface ServerProps {
  /** Base URL the props came from. */
  baseUrl?: string;
  /** Model id the server reports for the route. */
  model?: string;
  /** Served context window (`/props`), never the training size. */
  nCtx?: number;
  /** Which thinking switches the chat template reads. */
  template?: TemplateCaps;
  /** Stable hash of the chat template, so two presets never look alike. */
  templateHash?: string;
  /** Sampler values dsh actually sent, when it exposes them. */
  temperature?: number;
  seed?: number;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/**
 * GET /props for a route, best effort. A cloud route or a server without
 * `/props` yields `{ baseUrl }` only — the result file then carries
 * `props.ok === false` so an unrecorded preset is visible, never implied.
 */
export async function serverPropsFor(
  route: ProviderRoute,
  model: string,
  fetchImpl?: typeof fetch,
): Promise<ServerProps & { ok: boolean }> {
  const baseUrl = routeBaseUrl(route);
  if (baseUrl === undefined) return { ok: false, model };
  const out: ServerProps & { ok: boolean } = { ok: false, baseUrl, model };
  let origin: string;
  let port: number;
  try {
    const url = new URL(baseUrl);
    origin = url.hostname;
    port = Number(url.port) || (url.protocol === "https:" ? 443 : 80);
  } catch {
    return out;
  }
  const doFetch = (fetchImpl ?? (fetch as unknown as Parameters<typeof fetchProps>[2])) as
    | typeof fetch
    | undefined;
  const props = await fetchProps(origin, port, doFetch as never, 2000);
  if (props?.nctx !== undefined) {
    out.nCtx = props.nctx;
    out.ok = true;
  }
  if (props?.template !== undefined) {
    out.template = props.template;
    out.ok = true;
  }
  try {
    const res = await (fetchImpl ?? fetch)(`http://${origin}:${String(port)}/props`, {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      const body = (await res.json()) as Record<string, any>;
      const template = body?.["chat_template"];
      if (typeof template === "string" && template !== "") {
        out.templateHash = sha256(template);
        out.template ??= detectTemplateCaps(template);
        out.ok = true;
      }
    }
  } catch {
    // /props is llama.cpp-only: its absence is normal
  }
  return out;
}
