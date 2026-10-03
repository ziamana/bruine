import { createAssistantMessage, createUserMessage } from "@deepseek-ai/dsh-llm";

/**
 * The request the agent loop last sent for the main conversation, as the server saw it.
 *
 * A server caches the start of a request: the system prompt, the tools and the history.
 * A background request that starts from the same place costs a few tokens of prefill; one
 * that starts differently makes the server forget the conversation it was holding.
 */
export interface MainRequest {
  provider: string;
  model: string;
  /** The conversation exactly as the provider got it, system message first. */
  messages: unknown[];
  tools?: unknown[];
  reasoningEffort?: string;
}

/** What the engine's request hook hands over. Written out so this module does not import its types. */
interface StreamOptionsLike {
  provider?: string;
  model?: string;
  messages?: unknown[];
  tools?: unknown[];
  reasoningEffort?: string;
  sessionId?: string;
  purpose?: string;
}

/** Remembers the last loop request of one session. */
export class MainRequestMemory {
  #last: MainRequest | undefined;

  /**
   * Look at a request on its way to the model. Only the main conversation's own loop request
   * counts: it carries the session, it has no auxiliary purpose (titles, compaction), and it
   * has tools. A request this module builds itself carries no session, so it is never mistaken
   * for one.
   */
  see(options: StreamOptionsLike, sessionId: string | undefined): void {
    if (sessionId === undefined || options.sessionId !== sessionId || options.purpose !== undefined) return;
    if (typeof options.provider !== "string" || typeof options.model !== "string") return;
    if (!Array.isArray(options.messages) || options.messages.length === 0) return;
    this.#last = {
      provider: options.provider,
      model: options.model,
      messages: [...options.messages],
      ...(Array.isArray(options.tools) && options.tools.length > 0 ? { tools: [...options.tools] } : {}),
      ...(options.reasoningEffort !== undefined ? { reasoningEffort: options.reasoningEffort } : {}),
    };
  }

  get last(): MainRequest | undefined {
    return this.#last;
  }

  /** A new conversation (`/new`, `/resume`) starts from nothing. */
  clear(): void {
    this.#last = undefined;
  }
}

export const SUGGEST_INSTRUCTION =
  "Suggest the user's most likely next message, max 8 words, same language as the user. Reply with the message only.";

/** The instruction of a suggestion that stands alone: it has to carry what the conversation would have. */
export function standaloneInstruction(lastUser: string, answerExcerpt: string): string {
  return `${SUGGEST_INSTRUCTION}\n\nLast user prompt: ${lastUser}\nLast answer (excerpt): ${answerExcerpt}`;
}

const SOURCE = { kind: "plugin", plugin: "kumo-suggest" } as const;

export interface SuggestionRequest {
  provider: string;
  model: string;
  messages: unknown[];
  tools?: unknown[];
  maxTokens: number;
  reasoningEffort?: string;
}

/**
 * The suggestion as the end of the conversation: the last main request, the answer it
 * produced, and one more user message asking for the next prompt.
 *
 * Everything before that last message is what the server already holds in its cache, so the
 * request costs the tail and a few tokens of output. It goes to the main route with the main
 * tools, because a different model or a different tool list is a different prefix.
 */
export function sharedPrefixRequest(
  last: MainRequest,
  answer: string,
  opts: { maxTokens?: number; effort?: string } = {},
): SuggestionRequest {
  const effort = opts.effort ?? last.reasoningEffort;
  return {
    provider: last.provider,
    model: last.model,
    messages: [
      ...last.messages,
      createAssistantMessage({ content: [{ type: "text", text: answer }], source: { provider: last.provider, model: last.model } }),
      createUserMessage({ content: [{ type: "text", text: SUGGEST_INSTRUCTION }], source: SOURCE }),
    ],
    ...(last.tools !== undefined ? { tools: last.tools } : {}),
    maxTokens: opts.maxTokens ?? 24,
    ...(effort !== undefined ? { reasoningEffort: effort } : {}),
  };
}

/** The standalone request: a short prompt of its own, for a route that is not the main one. */
export function standaloneRequest(
  route: { provider: string; model: string },
  lastUser: string,
  answerExcerpt: string,
  opts: { maxTokens?: number; effort?: string } = {},
): SuggestionRequest {
  return {
    provider: route.provider,
    model: route.model,
    messages: [createUserMessage({ content: [{ type: "text", text: standaloneInstruction(lastUser, answerExcerpt) }], source: SOURCE })],
    maxTokens: opts.maxTokens ?? 24,
    ...(opts.effort !== undefined ? { reasoningEffort: opts.effort } : {}),
  };
}

/**
 * Whether a suggestion is worth a request, by the rules a coding agent that reuses its cache
 * for this applies: not while planning, and not when there is nothing to build on.
 */
export function shouldSuggest(state: { enabled: boolean; plan: boolean; lastUser: string; answer: string }): boolean {
  return state.enabled && !state.plan && state.lastUser.trim() !== "" && state.answer.trim() !== "";
}

/** True when the route the suggestion would use is the one the conversation is on. */
export function sameRoute(a: { provider: string; model: string }, b: { provider: string; model: string }): boolean {
  return a.provider === b.provider && a.model === b.model;
}
