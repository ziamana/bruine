import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

export interface RequestBody {
  messages: Array<{ role: string; content?: unknown; tool_call_id?: string }>;
  tools?: unknown[];
  stream?: boolean;
}
export interface Chunk {
  delta: Record<string, unknown>;
  delayMs?: number;
}
export interface Script {
  chunks: Chunk[];
  finish?: "stop" | "tool_calls";
  finishDelayMs?: number;
  usage?: { outputTokens?: number; inputTokens?: number; cachedTokens?: number };
}
export interface RecordedRequest {
  body: RequestBody;
  main: boolean;
  completed: boolean;
  disconnected: boolean;
}
export const textScript = (text: string): Script => ({ chunks: [{ delta: { content: text } }] });

/** Identity once, then indexed argument fragments, then a tool_calls finish. */
export function toolScript(name: string, args: Record<string, unknown>, id = "call_e2e_1"): Script {
  const json = JSON.stringify(args);
  const middle = Math.floor(json.length / 2);
  return {
    finish: "tool_calls",
    finishDelayMs: 400,
    chunks: [
      { delta: { tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: "" } }] }, delayMs: 100 },
      ...[json.slice(0, middle), json.slice(middle)].map((arguments_) => ({
        delta: { tool_calls: [{ index: 0, function: { arguments: arguments_ } }] }, delayMs: 300,
      })),
    ],
  };
}

/** Side requests (e.g. titles) never consume the main conversation's script. */
export async function startServer(scripts: Script[]) {
  const requests: RecordedRequest[] = [];
  const errors: string[] = [];
  let turn = 0;
  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "e2e-model", object: "model", owned_by: "e2e" }] }));
      return;
    }
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.writeHead(404).end();
      return;
    }
    try {
      let raw = "";
      for await (const part of req) raw += String(part);
      const body = JSON.parse(raw) as RequestBody;
      const main = body.messages.some((m) => ["system", "developer"].includes(m.role) && JSON.stringify(m.content).includes("terminal coding agent"));
      const record: RecordedRequest = { body, main, completed: false, disconnected: false };
      requests.push(record);
      const abort = new AbortController();
      res.on("close", () => {
        record.disconnected = !record.completed;
        abort.abort();
      });
      const script = main ? scripts[turn++] : textScript("E2E session");
      if (!script) {
        errors.push(`Unexpected main request ${turn}`);
        res.writeHead(500).end("No scripted response remains");
        return;
      }
      if (body.stream === false) {
        res.writeHead(200, { "content-type": "application/json" });
        record.completed = true;
        res.end(JSON.stringify({ id: "e2e", object: "chat.completion", created: 1, model: "e2e-model", choices: [{ index: 0, message: { role: "assistant", content: "E2E session" }, finish_reason: "stop" }] }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      const chunk = (delta: Record<string, unknown>, finish: string | null = null) => res.write(`data: ${JSON.stringify({
        id: `chatcmpl-e2e-${requests.length}`, object: "chat.completion.chunk", created: 1,
        model: "e2e-model", choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`);
      const usageChunk = (u: NonNullable<Script["usage"]>) => res.write(`data: ${JSON.stringify({
        id: `chatcmpl-e2e-${requests.length}`, object: "chat.completion.chunk", created: 1,
        model: "e2e-model", choices: [{ index: 0, delta: {}, finish_reason: null }],
        usage: {
          prompt_tokens: u.inputTokens ?? 0,
          completion_tokens: u.outputTokens ?? 0,
          total_tokens: (u.inputTokens ?? 0) + (u.outputTokens ?? 0),
          prompt_tokens_details: { cached_tokens: u.cachedTokens ?? 0 },
        },
      })}\n\n`);
      chunk({ role: "assistant", content: "" });
      for (const part of script.chunks) {
        await delay(part.delayMs ?? 0, undefined, { signal: abort.signal });
        if (res.destroyed) return;
        chunk(part.delta);
      }
      if (script.usage !== undefined) {
        await delay(50, undefined, { signal: abort.signal });
        if (!res.destroyed) usageChunk(script.usage);
      }
      await delay(script.finishDelayMs ?? 0, undefined, { signal: abort.signal });
      chunk({}, script.finish ?? "stop");
      record.completed = true;
      res.end("data: [DONE]\n\n");
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      errors.push(String(error));
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing server port");
  return {
    url: `http://127.0.0.1:${address.port}/v1`, requests, errors,
    mainRequests: () => requests.filter((r) => r.main),
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
