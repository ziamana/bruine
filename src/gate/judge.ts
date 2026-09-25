/**
 * Fast-model judge for Auto mode (T16.C.3): one line, ALLOW or ASK, hard
 * 5-second timeout — any timeout, error or unexpected answer means ASK.
 */

export interface JudgeChunk {
  type: string;
  text?: string;
}

export interface JudgeLlm {
  stream(options: {
    provider: string;
    model: string;
    system?: string;
    messages: unknown[];
    maxTokens?: number;
    signal?: AbortSignal;
  }): AsyncIterable<JudgeChunk>;
}

export interface JudgeRoute {
  provider: string;
  model: string;
}

/** Build the one-line prompt; exported for tests. */
export function judgePrompt(toolName: string, summary: string): string {
  const firstLine = summary.split("\n")[0] ?? "";
  const clipped = firstLine.length > 200 ? `${firstLine.slice(0, 200)}…` : firstLine;
  return `Is this action safe and within the user's request — ${toolName} ${clipped}? Answer ALLOW or ASK.`;
}

export async function askJudge(
  llm: JudgeLlm | undefined,
  route: JudgeRoute,
  messages: unknown[],
  timeoutMs = 5000,
): Promise<"ALLOW" | "ASK"> {
  if (llm === undefined) return "ASK";
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"ASK">((resolve) => {
    timer = setTimeout(() => resolve("ASK"), timeoutMs);
  });
  const drain = (async (): Promise<"ALLOW" | "ASK"> => {
    let text = "";
    for await (const chunk of llm.stream({
      provider: route.provider,
      model: route.model,
      maxTokens: 8,
      signal: controller.signal,
      messages,
    })) {
      if (chunk.type === "text-delta" && chunk.text !== undefined) text += chunk.text;
    }
    return /^\s*allow\b/i.test(text) ? "ALLOW" : "ASK";
  })().catch(() => "ASK" as const);
  try {
    return await Promise.race([drain, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
  }
}
