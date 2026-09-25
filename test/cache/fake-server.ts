import { createServer, type Server } from "node:http";

export interface RecordedRequest {
  /** The raw JSON body the client sent. */
  body: unknown;
}

export interface ScriptedResponse {
  /** assistant text, tool calls, or both — in order. */
  text?: string;
  toolCalls?: Array<{ id: string; name: string; args: string }>;
}

export interface FakeModelServer {
  server: Server;
  port: number;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

/**
 * OpenAI-compatible fake that RECORDS every /v1/chat/completions body and
 * replays scripted responses in order (T17 — Cache Hunter test).
 */
export async function startFakeModelServer(
  responses: ScriptedResponse[],
): Promise<FakeModelServer> {
  const requests: RecordedRequest[] = [];
  let turn = 0;
  const server = createServer((req, res) => {
    if (req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "cache-test-model" }] }));
      return;
    }
    if (req.url === "/v1/chat/completions" && req.method === "POST") {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        let parsed: any;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = raw;
        }
        requests.push({ body: parsed });
        // Only MAIN-session requests consume the script; one-shot calls
        // (session titles, compaction, judges) get a benign canned answer.
        const main =
          parsed !== undefined && typeof parsed === "object" && isMainSessionRequest(parsed as OpenAiRequestLike);
        const script: ScriptedResponse = main
          ? (responses[Math.min(turn, responses.length - 1)] ?? {})
          : { text: "session" };
        if (main) turn += 1;
        res.writeHead(200, { "content-type": "text/event-stream" });
        const chunkFn = (delta: unknown, finish: string | null) =>
          res.write(
            `data: ${JSON.stringify({
              id: `chatcmpl-${turn}`,
              object: "chat.completion.chunk",
              created: 1,
              model: "cache-test-model",
              choices: [{ index: 0, delta, finish_reason: finish }],
            })}\n\n`,
          );
        chunkFn({ role: "assistant" }, null);
        for (const call of script.toolCalls ?? []) {
          chunkFn(
            { tool_calls: [{ index: 0, id: call.id, type: "function", function: { name: call.name, arguments: call.args } }] },
            null,
          );
        }
        if (script.text !== undefined) chunkFn({ content: script.text }, null);
        chunkFn({}, script.toolCalls !== undefined ? "tool_calls" : "stop");
        res.write("data: [DONE]\n\n");
        res.end();
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return {
    server,
    port,
    requests,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** Compare two recorded request bodies for the cache invariants. */
export interface OpenAiRequestLike {
  messages: Array<{ role: string; content?: unknown }>;
  tools?: unknown;
}

/** pi-ai sends `developer` instead of `system` for reasoning models. */
function isSystemish(m: { role: string }): boolean {
  return m.role === "system" || m.role === "developer";
}

function systemMessageOf(body: OpenAiRequestLike): string {
  const system = (body.messages ?? []).find(isSystemish);
  return system === undefined ? "" : JSON.stringify(system);
}

/** A main-session request carries kumo's persona; one-shot calls (titles…) do not. */
export function isMainSessionRequest(body: OpenAiRequestLike): boolean {
  return systemMessageOf(body).includes("terminal coding agent");
}

export function firstDiffByte(a: string, b: string): string | undefined {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      return `byte ${String(i)}: ${JSON.stringify(a.slice(Math.max(0, i - 60), i + 60))} vs ${JSON.stringify(b.slice(Math.max(0, i - 60), i + 60))}`;
    }
  }
  return a.length !== b.length
    ? `length ${String(a.length)} vs ${String(b.length)} at tail: ${JSON.stringify(
        (a.length > b.length ? a : b).slice(n, n + 120),
      )}`
    : undefined;
}

/**
 * Assert: for consecutive main-session requests i-1 → i, `system` + `tools`
 * are byte-identical and the older messages are a prefix of the newer ones.
 * Returns one line of failure evidence per violation.
 */
export function checkCacheInvariants(mainBodies: OpenAiRequestLike[]): string[] {
  const failures: string[] = [];
  for (let i = 1; i < mainBodies.length; i++) {
    const prev = mainBodies[i - 1]!;
    const curr = mainBodies[i]!;
    const sys = firstDiffByte(systemMessageOf(prev), systemMessageOf(curr));
    if (sys !== undefined) failures.push(`request ${String(i)}: system changed — ${sys}`);
    const tools = firstDiffByte(JSON.stringify(prev.tools ?? null), JSON.stringify(curr.tools ?? null));
    if (tools !== undefined) failures.push(`request ${String(i)}: tools changed — ${tools}`);
    const prevMsgs = (prev.messages ?? []).filter((m) => !isSystemish(m));
    const currMsgs = (curr.messages ?? []).filter((m) => !isSystemish(m));
    if (prevMsgs.length > currMsgs.length) {
      failures.push(
        `request ${String(i)}: history shrank (${String(prevMsgs.length)} → ${String(currMsgs.length)} messages)`,
      );
    }
    const len = Math.min(prevMsgs.length, currMsgs.length);
    for (let m = 0; m < len; m++) {
      const d = firstDiffByte(JSON.stringify(prevMsgs[m]), JSON.stringify(currMsgs[m]));
      if (d !== undefined) {
        failures.push(`request ${String(i)}: message[${String(m)}] mutated — ${d}`);
        break;
      }
    }
  }
  return failures;
}
