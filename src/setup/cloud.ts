/**
 * The cloud providers the setup can offer, taken from the catalog pi-ai ships (the same
 * one the engine routes through, so a provider listed here is a provider that runs).
 *
 * A catalog route needs nothing but its key: the endpoint, the protocol and the model list
 * come from the catalog, so a provider is `providers.<id>: { apiKeyEnv }` in settings.yaml.
 * Only providers that need exactly one key are offered; the ones that need an account id,
 * an endpoint or a login (Bedrock, Vertex, Azure, Copilot, Cloudflare) are not.
 */

export interface CloudModel {
  id: string;
  name: string;
  contextWindow?: number;
  reasoning: boolean;
}

export interface CloudProvider {
  /** The route name in settings.yaml. */
  id: string;
  name: string;
  /** The environment variable (and `.env` line) that holds its key. */
  keyEnv: string;
  /** What the catalog lists; empty means the user types a model id. */
  models: CloudModel[];
}

/** The engine's own DeepSeek route: its model ids are not the catalog's, so they are typed. */
export const DEEPSEEK_OFFICIAL: CloudProvider = {
  id: "deepseek-official",
  name: "DeepSeek",
  keyEnv: "DEEPSEEK_API_KEY",
  models: [],
};
export const DEEPSEEK_DEFAULT_MODEL = "deepseek-flash";

/** Listed by the engine's own route, or needing more than a key. */
const NOT_OFFERED = new Set(["deepseek", "github-copilot", "azure-openai-responses", "openai-codex", "radius"]);

/** Shown first, in this order; every other provider follows, alphabetically. */
const POPULAR = [
  "deepseek-official",
  "anthropic",
  "openai",
  "google",
  "openrouter",
  "xai",
  "mistral",
  "groq",
  "together",
  "fireworks",
  "cerebras",
  "opencode",
  "huggingface",
  "nvidia",
  "zai",
  "moonshotai",
];

const FALLBACK: CloudProvider[] = [
  DEEPSEEK_OFFICIAL,
  { id: "openrouter", name: "OpenRouter", keyEnv: "OPENROUTER_API_KEY", models: [] },
];

const known = new Map<string, CloudProvider>(FALLBACK.map((p) => [p.id, p]));
let loaded: Promise<CloudProvider[]> | undefined;

/** Every cloud provider the setup offers; read once, then kept. Never throws. */
export function loadCloudProviders(): Promise<CloudProvider[]> {
  loaded ??= build();
  return loaded;
}

async function build(): Promise<CloudProvider[]> {
  try {
    const all = await import("@earendil-works/pi-ai/providers/all");
    const out: CloudProvider[] = [DEEPSEEK_OFFICIAL];
    for (const provider of all.builtinProviders()) {
      if (NOT_OFFERED.has(provider.id)) continue;
      const keyEnv = await singleKeyEnv(provider);
      if (keyEnv === undefined) continue;
      const models = all.getBuiltinModels(provider.id as Parameters<typeof all.getBuiltinModels>[0]).map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        ...(typeof m.contextWindow === "number" ? { contextWindow: m.contextWindow } : {}),
        reasoning: m.reasoning === true,
      }));
      if (models.length === 0) continue;
      out.push({ id: provider.id, name: provider.name, keyEnv, models });
    }
    const rank = (id: string): number => {
      const at = POPULAR.indexOf(id);
      return at >= 0 ? at : POPULAR.length;
    };
    out.sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
    for (const p of out) known.set(p.id, p);
    return out;
  } catch {
    return FALLBACK;
  }
}

/**
 * The one variable a provider reads its key from, asked of the provider itself: its
 * resolver is run against an environment that records the names it looks up. A provider
 * that looks up more than one (account ids, profiles) or needs anything else is not a
 * key-only provider.
 */
async function singleKeyEnv(provider: { id: string; auth: { apiKey?: { resolve(input: never): Promise<unknown> } } }): Promise<string | undefined> {
  const names: string[] = [];
  const ctx = {
    env: async (name: string): Promise<undefined> => {
      names.push(name);
      return undefined;
    },
  };
  try {
    await provider.auth.apiKey?.resolve({ ctx, credential: undefined, signal: new AbortController().signal } as never);
  } catch {
    return undefined;
  }
  // Anthropic reads a bearer token first; the key is the one a person has.
  if (provider.id === "anthropic") return names.includes("ANTHROPIC_API_KEY") ? "ANTHROPIC_API_KEY" : undefined;
  return names.length === 1 ? names[0] : undefined;
}

/**
 * The key variable of a cloud route, usable before the catalog has loaded: the ones read
 * so far come from it, and any other follows the convention (`GROQ_API_KEY`).
 */
export function cloudKeyEnv(id: string): string {
  const hit = known.get(id);
  if (hit !== undefined) return hit.keyEnv;
  return `${id.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_")}_API_KEY`;
}

export function cloudProviderName(id: string): string {
  return known.get(id)?.name ?? id;
}
