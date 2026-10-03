import type { Discovered } from "./discover.js";
import type { RolePick } from "./flow.js";

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
  keyEnv: "KUMO_ZEN_API_KEY",
  /** The gateway's public key: free models take it, and refuse every other value. */
  keyValue: "public",
} as const;

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
    apiKey: { env: SPACE_BUNNY.keyEnv, value: SPACE_BUNNY.keyValue },
  };
}

export function spaceBunnyPick(): RolePick {
  return { discovered: spaceBunnyDiscovered(), model: SPACE_BUNNY.model, contextWindow: SPACE_BUNNY.contextWindow };
}
