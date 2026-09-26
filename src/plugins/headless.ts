import { randomUUID } from "node:crypto";
import { SessionId } from "@deepseek-ai/dsh-session";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import type { DshContext, KumoStartup } from "./ctx.js";
import type { KumoModesService } from "./modes.js";

export const name = "kumo-headless";
export const inject = ["agentDefaultModel", "agents", "sessions", "kumoStartup", "kumoModes"];

export interface HeadlessResult {
  ok: boolean;
  text: string;
  reason: string;
  sessionId: string;
  durationMs: number;
  tools: Array<{ name: string; decision: "allow" | "ask" | "deny" }>;
}

async function stdinTask(): Promise<string> {
  let task = "";
  for await (const chunk of process.stdin) task += String(chunk);
  return task;
}

function messageText(event: any): string {
  const blocks = event?.data?.message?.content;
  return Array.isArray(blocks)
    ? blocks.filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text).join("\n")
    : "";
}

async function run(ctx: DshContext): Promise<number> {
  await ctx.get("loader")?.await();
  const startup = ctx.get("kumoStartup") as KumoStartup | undefined;
  const task = startup?.headless;
  if (task === undefined || task.prompts.length === 0) throw new Error("headless task is missing");
  const modes = ctx.get("kumoModes") as KumoModesService | undefined;
  if (modes === undefined) throw new Error("permission gate is unavailable");
  const agents = ctx.get("agents");
  const sessions = ctx.get("sessions");
  const selection = ctx.get("agentDefaultModel")?.currentSelection();
  if (agents === undefined || sessions === undefined || selection === undefined) throw new Error("agent services are unavailable");

  const selectionRef = { current: selection, assembled: undefined };
  const handle = await agents.create({
    sessionId: SessionId(`session-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: (agentCtx: unknown) => { installModelSelection(agentCtx as any, selectionRef as any); },
  });
  const { agent } = handle;
  modes.govern(agent);
  await agent.whenIdle();

  const started = Date.now();
  let text = "";
  let reason = "error";
  let streamed = "";
  const writeEvent = (event: Record<string, unknown>): void => {
    if (task.format === "stream-json") process.stdout.write(`${JSON.stringify(event)}\n`);
  };
  const offStream = ctx.on("agent/assistant-stream", ({ agent: subject, frame }: any) => {
    if (subject !== agent || task.format !== "stream-json") return;
    if (frame?.type === "chunk" && frame.chunk?.type === "text-delta") {
      streamed += String(frame.chunk.text ?? "");
      writeEvent({ type: "text", text: frame.chunk.text });
    }
  });
  const offSession = ctx.on("session/event", (session: unknown, event: any) => {
    if (session !== agent.session) return;
    if (event?.type === "assistant/message") text = messageText(event);
    if (event?.type === "turn/end") reason = String(event.data?.reason?.kind ?? "error");
    if (event?.type === "tool/call") writeEvent({ type: "tool", name: event.data?.name, callId: event.data?.callId });
  });

  try {
    for (const raw of task.prompts) {
      const prompt = raw === "-" ? await stdinTask() : raw;
      if (prompt.trim() === "") throw new Error("-p needs a non-empty task");
      text = "";
      streamed = "";
      reason = "error";
      agent.followup(createUserMessage({ content: [{ type: "text", text: prompt }], source: { kind: "user" } }));
      await agent.whenIdle();
      if (text === "") text = streamed;
      if (reason !== "completed") break;
    }
    await sessions.flush(agent.session);
    const result: HeadlessResult = {
      ok: reason === "completed",
      text,
      reason,
      sessionId: String(agent.session.id),
      durationMs: Date.now() - started,
      tools: modes.log.map(({ tool, decision }) => ({ name: tool, decision })),
    };
    if (task.format === "text") process.stdout.write(result.text);
    else process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.ok ? 0 : 1;
  } finally {
    offStream();
    offSession();
    await handle.dispose();
  }
}

export function apply(ctx: DshContext): void {
  const exit = ctx.get("appExit") as ((code: number) => void) | undefined;
  if (exit === undefined) throw new Error("kumo-headless: appExit is unavailable");
  void run(ctx).then(exit, (error: unknown) => {
    console.error(`kumo: ${error instanceof Error ? error.message : String(error)}`);
    exit(1);
  });
}
