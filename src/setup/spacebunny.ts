import type { Discovered } from "./discover.js";
import type { RolePick } from "./flow.js";
import type { SettingsDoc } from "./simple.js";

/**
 * Space Bunny Free: a model OpenCode serves at no charge for a limited time through its
 * Zen gateway. It speaks the OpenAI chat protocol, so it is a route like a local server,
 * with two differences: the gateway answers 401 to any key but its public one, and the
 * offer can end without notice.
 */
export const SPACE_BUNNY = {
  baseUrl: "https://opencode.ai/zen/v1",
  model: "space-bunny-free",
  contextWindow: 1_000_000,
  routeName: "opencode-zen",
} as const;

/**
 * The gateway's public key: free models take it, and refuse every other value. It travels as a
 * header and not through an environment variable, so a route added in the middle of a session
 * works at once (a variable the process did not start with is one the runtime never sees).
 */
export const SPACE_BUNNY_HEADERS: Record<string, string> = { Authorization: "Bearer public" };

/**
 * The thinking levels the endpoint takes, asked of it: `reasoning_effort` accepts minimal, low,
 * medium, high, xhigh and max, and refuses `none`. `minimal` and `low` answer without thinking, so
 * `off` is `minimal`; the others think more as they go up.
 */
export const SPACE_BUNNY_EFFORTS: Record<string, string> = {
  off: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

/**
 * What the model takes in. Without this the harness assumes text only and refuses every image
 * before it is sent, although the model reads them (the catalogue lists text, image and video).
 */
export const SPACE_BUNNY_INPUT: string[] = ["text", "image"];

/**
 * A stream timeout of two minutes that an earlier version wrote into the route. It was wrong: at its
 * highest level the model stays silent for longer than that while it prepares a large write, so every
 * attempt was cut off and the turn failed. The harness default (five minutes) is the right one, and a
 * route that still carries exactly this value loses it.
 */
export const SPACE_BUNNY_LEGACY_IDLE_TIMEOUT_MS = 120_000;

/** The route as settings.yaml spells it. */
export function spaceBunnyRoute(): Record<string, unknown> {
  return {
    displayName: "OpenCode Zen",
    api: "openai-completions",
    baseURL: SPACE_BUNNY.baseUrl,
    headers: { ...SPACE_BUNNY_HEADERS },
    models: [
      {
        id: SPACE_BUNNY.model,
        name: SPACE_BUNNY.model,
        contextWindow: SPACE_BUNNY.contextWindow,
        input: [...SPACE_BUNNY_INPUT],
        reasoningEfforts: { ...SPACE_BUNNY_EFFORTS },
      },
    ],
  };
}

/** What the user is told before saying yes. */
export const SPACE_BUNNY_NOTICE = [
  "Use Space Bunny Free as your main model?",
  "Free for now through OpenCode Zen, no account and no key.",
  "Your prompts and files are sent to OpenCode's provider, which states zero retention and no training.",
  "The offer is temporary and can end without notice.",
].join("\n");

export function spaceBunnyDiscovered(): Discovered {
  return {
    source: "manual",
    host: "opencode.ai",
    port: 443,
    baseUrl: SPACE_BUNNY.baseUrl,
    models: [SPACE_BUNNY.model],
    modelInfos: [{ id: SPACE_BUNNY.model, contextWindow: SPACE_BUNNY.contextWindow }],
    routeName: SPACE_BUNNY.routeName,
    displayName: "OpenCode Zen",
    headers: { ...SPACE_BUNNY_HEADERS },
    reasoningEfforts: { ...SPACE_BUNNY_EFFORTS },
    input: [...SPACE_BUNNY_INPUT],
  };
}

export function spaceBunnyPick(): RolePick {
  return { discovered: spaceBunnyDiscovered(), model: SPACE_BUNNY.model, contextWindow: SPACE_BUNNY.contextWindow };
}

/** settings.yaml for the quick setup: the route, and it as the default model. */
export function spaceBunnySettings(): SettingsDoc {
  return {
    "llm-pi-ai": { providers: { [SPACE_BUNNY.routeName]: spaceBunnyRoute() } },
    "agent-default-model": { provider: SPACE_BUNNY.routeName, model: SPACE_BUNNY.model },
  };
}
