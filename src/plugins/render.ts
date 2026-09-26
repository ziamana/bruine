import { Text } from "@earendil-works/pi-tui";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { ReasoningLine, dim, type Screen } from "../render/reasoning.js";
import { kumoIcons, type KumoIcons } from "../render/chars.js";
import { TextStream } from "../render/text.js";
import { ToolCallView } from "../render/tools.js";
import { ReasoningComponent } from "../ui/reasoning-component.js";
import { ToolCallComponent } from "../ui/tool-call-component.js";
import { AssistantTextComponent, userMessageComponent } from "../ui/assistant-text.js";
import { WorkingComponent } from "../ui/working.js";
import { MODE_ANNOUNCEMENTS } from "./modes.js";
import { TpsMeter } from "../ui/tps.js";
import { ansi } from "../ui/theme.js";
import { TaskPanel, taskItems, type TaskItem } from "../ui/task-panel.js";
import type { DshContext, KumoRepl } from "./ctx.js";

/** Stable Cordis plugin name. */
export const name = "kumo-render";

/** The service provided by this plugin and injected by kumo-approval. */
export const KUMO_RENDER_SERVICE = "kumoRender";

/** The screen-drawing surface kumo owns for non-TTY (piped) output. */
export interface ScreenUi {
  screen: Screen;
  icons: KumoIcons;
  reasoning: ReasoningLine;
  text: TextStream;
  tools: ToolCallView;
}

/** What kumo-approval can ask this service. */
export interface RenderService {
  screen?: ScreenUi;
  describe?: (callId: string) => { tool: string; summary: string } | undefined;
  cancelSuggest?: () => void;
}

/** Live view of the controlling terminal. */
export function stdoutScreen(): Screen {
  return {
    write: (s) => void process.stdout.write(s),
    get columns() {
      return process.stdout.columns ?? 80;
    },
  };
}

export function createUi(screen: Screen, icons: KumoIcons = kumoIcons()): ScreenUi {
  return {
    screen,
    icons,
    reasoning: new ReasoningLine(screen, Date.now, icons),
    text: new TextStream(screen),
    tools: new ToolCallView(screen, Date.now, icons),
  };
}

interface StreamFrame {
  type: "start" | "chunk" | "end";
  time?: number;
  chunk?: any;
}

interface SessionEvent {
  type: string;
  data: any;
}

/** A restored session carries its last whole-list write in the event log. */
function restoreTasks(session: any): ReturnType<typeof taskItems> {
  try {
    const events = session?.snapshotEvents?.() as SessionEvent[] | undefined;
    if (!Array.isArray(events)) return undefined;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i]?.type === "todo/write") return taskItems(events[i]?.data?.todos);
    }
  } catch {
    // A missing or unavailable history leaves the panel empty.
  }
  return undefined;
}

/**
 * Wire the live stream and the durable session log onto the pi-tui chat
 * components (T13a-d). Exported so tests can drive it with fake events.
 */
export function attachTui(
  ctx: DshContext,
  agent: { session: any },
  ui: NonNullable<KumoRepl["ui"]>,
  service: RenderService,
  getAgent?: () => { session: any },
): () => void {
  const tps = new TpsMeter();
  const tools = new Map<string, ToolCallComponent>();
  const todoToolIds = new Set<string>();
  const setUiTasks = (tasks: TaskItem[]): void => {
    (ui as unknown as { setTasks?: (items: TaskItem[]) => void }).setTasks?.(tasks);
  };
  let reasoning: ReasoningComponent | undefined;
  let text: AssistantTextComponent | undefined;
  let working: WorkingComponent | undefined;
  let lastInputTokens = 0;
  let lastOutputTokens = 0;
  let lastCacheTokens = 0;
  let turnStartWall = Date.now();
  let turnOutput = 0;
  let turnToolIds: string[] = [];
  let turnBreaks = new Set<string>();
  let needBreak = false;
  let lastUser = "";
  let currentAnswer = "";
  let suggestController: AbortController | undefined;

  service.describe = (callId: string) => {
    const comp = tools.get(callId);
    if (comp === undefined) return undefined;
    return { tool: comp.tool, summary: comp.summary(80) };
  };
  service.cancelSuggest = () => {
    suggestController?.abort();
    suggestController = undefined;
  };

  const hideWorking = (): void => {
    const chat = (ui as unknown as { chat?: { children: unknown[]; removeChild(c: unknown): void } }).chat;
    if (chat !== undefined) {
      for (const child of [...chat.children]) {
        if ((child as { constructor?: { name?: string } }).constructor?.name === "WorkingComponent") {
          chat.removeChild(child);
        }
      }
    }
    if (working !== undefined) {
      (ui as unknown as { removeChat?: (c: unknown) => void }).removeChat?.(working);
      working = undefined;
    }
    ui.requestRender();
  };

  const showWorking = (): void => {
    const chat = (ui as unknown as { chat?: { children: unknown[] } }).chat;
    if (
      chat !== undefined &&
      chat.children.some((c) => (c as { constructor?: { name?: string } }).constructor?.name === "WorkingComponent")
    ) {
      return;
    }
    if (working === undefined && reasoning === undefined && text === undefined) {
      working = new WorkingComponent(Date.now, ui.icons);
      ui.addChat(working);
      ui.requestRender();
    }
  };

  const closeLive = (): void => {
    if (reasoning !== undefined) {
      reasoning.end();
      reasoning = undefined;
      ui.requestRender();
    }
    if (text !== undefined) {
      text.finish();
      text = undefined;
    }
  };

  const ensureReasoning = (): ReasoningComponent => {
    if (reasoning === undefined) {
      reasoning = new ReasoningComponent(Date.now, ui.icons);
      ui.addChat(reasoning);
    }
    return reasoning;
  };

  const ensureText = (): AssistantTextComponent => {
    if (text === undefined) {
      text = new AssistantTextComponent();
      ui.addChat(text);
    }
    return text;
  };

  const ensureTool = (id: string, toolName: string): ToolCallComponent => {
    let comp = tools.get(id);
    if (comp === undefined) {
      comp = new ToolCallComponent(toolName, Date.now, ui.icons);
      tools.set(id, comp);
      if (needBreak) {
        turnBreaks.add(id);
        needBreak = false;
      }
      turnToolIds.push(id);
      // T28b.3: the question UI + echo line tell the story; never draw the
      // ask_user_question tool header or its answers preview in the chat.
      if (toolName !== "ask_user_question") ui.addChat(comp);
    }
    return comp;
  };

  const liveAgent = (): { session: any } => {
    try {
      return getAgent?.() ?? agent;
    } catch {
      return agent;
    }
  };

  const offStream = ctx.on("agent/assistant-stream", ({ agent: subject, frame }: any) => {
    if (subject !== liveAgent()) return;
    const f = frame as StreamFrame;
    const now = typeof f.time === "number" ? f.time : Date.now();
    if (f.type === "start") {
      tps.startCall(now);
      hideWorking();
      closeLive();
      return;
    }
    if (f.type === "end") {
      tps.endCall();
      ui.footer.set({ tps: tps.tps, pp: tps.pp, cachePct: tps.cachePct, cacheFirst: tps.cacheFirst });
      hideWorking();
      closeLive();
      ui.requestRender();
      return;
    }
    const chunk = f.chunk;
    if (chunk === undefined) return;
    const trackDelta = (): void => {
      tps.delta(now);
      ui.footer.set({ tps: tps.tps, pp: tps.pp, cachePct: tps.cachePct, cacheFirst: tps.cacheFirst });
    };
    hideWorking();
    switch (chunk.type) {
      case "reasoning-delta":
        trackDelta();
        ensureReasoning().push(chunk.text);
        ui.requestRender();
        return;
      case "text-delta":
        trackDelta();
        needBreak = true;
        currentAnswer += String(chunk.text ?? "");
        ensureText().push(chunk.text);
        ui.requestRender();
        return;
      case "block-start":
        if (chunk.blockType !== "reasoning") closeLive();
        return;
      case "block-end":
        if (chunk.block.type === "reasoning") {
          reasoning?.end();
          reasoning = undefined;
          ui.requestRender();
        } else if (chunk.block.type === "text") {
          text?.finish();
          text = undefined;
        }
        return;
      case "tool-call-delta": {
        trackDelta();
        const id = String(chunk.id);
        if (chunk.name === "todo_write") todoToolIds.add(id);
        if (todoToolIds.has(id)) return;
        if (chunk.name !== undefined) ensureTool(id, chunk.name);
        tools.get(id)?.args(chunk.argumentsDelta ?? "");
        ui.requestRender();
        return;
      }
      case "usage": {
        const u = chunk.usage ?? {};
        const tokens = Number(u.outputTokens ?? 0);
        lastOutputTokens = tokens;
        lastInputTokens = Number(u.inputTokens ?? lastInputTokens);
        if (Number.isFinite(tokens)) turnOutput += Math.max(0, tokens);
        const details = (u.prompt_tokens_details ?? u.promptTokensDetails ?? {}) as Record<string, unknown>;
        const cached = Number(
          u.cacheReadTokens ?? u.cachedTokens ?? u.cache_read ?? details.cached_tokens ?? NaN,
        );
        if (Number.isFinite(cached)) lastCacheTokens = Math.max(0, cached);
        tps.usage(now, {
          outputTokens: Number(u.outputTokens ?? NaN),
          inputTokens: Number(u.inputTokens ?? NaN),
          cacheReadTokens: cached,
        });
        ui.footer.set({ tps: tps.tps, pp: tps.pp, cachePct: tps.cachePct, cacheFirst: tps.cacheFirst });
        ui.requestRender();
        return;
      }
      case "finish":
        tps.endCall();
        ui.footer.set({ tps: tps.tps, pp: tps.pp, cachePct: tps.cachePct, cacheFirst: tps.cacheFirst });
        closeLive();
        ui.requestRender();
        return;
      default:
        return;
    }
  });

  const offSession = ctx.on("session/event", (session: unknown, event: SessionEvent) => {
    if (session !== liveAgent().session) return;
    switch (event.type) {
      case "user/message": {
        // Only echo real user input; dsh injects reminders as plugin/system
        // user-messages that must not clutter the transcript. Mode announcements
        // (T24.4) are injected for the model but shown as a notice, not chat.
        if (event.data.source?.kind !== "user") return;
        const blocks = (event.data.content ?? []).filter((b: any) => b.type === "text");
        const content = blocks.map((b: any) => b.text).join(" ");
        const trimmed = content.trim();
        if (trimmed === "") return;
        if (MODE_ANNOUNCEMENTS.has(trimmed)) return;
        lastUser = trimmed;
        ui.addChat(userMessageComponent(trimmed));
        return;
      }
      case "turn/start":
        tps.reset();
        ui.footer.set({ tps: 0, pp: undefined, cachePct: undefined, cacheFirst: false });
        turnStartWall = Date.now();
        turnOutput = 0;
        turnToolIds = [];
        turnBreaks = new Set<string>();
        needBreak = false;
        currentAnswer = "";
        suggestController?.abort();
        suggestController = undefined;
        showWorking();
        return;
      case "tool/call": {
        hideWorking();
        const id = String(event.data.callId);
        if (event.data.name === "todo_write") {
          todoToolIds.add(id);
          return;
        }
        const comp = ensureTool(id, event.data.name);
        if (event.data.arguments) comp.setArgs(event.data.arguments);
        ui.requestRender();
        return;
      }
      case "tool/result": {
        const block = event.data.message?.content?.[0];
        if (block === undefined || block.type !== "tool-result") return;
        if (todoToolIds.delete(String(block.toolCallId))) return;
        const output = block.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("\n");
        tools.get(String(block.toolCallId))?.result(block.isError !== true, output);
        ui.requestRender();
        return;
      }
      case "todo/write": {
        const tasks = taskItems(event.data?.todos);
        if (tasks !== undefined) setUiTasks(tasks);
        return;
      }
      case "turn/end": {
        hideWorking();
        closeLive();
        for (const comp of tools.values()) comp.cancel();
        const window = agent.session?.requestContext?.()?.contextWindow;
        if (typeof window === "number" && window > 0) {
          ui.footer.set({
            contextUsed: lastInputTokens + lastCacheTokens + lastOutputTokens,
            contextWindow: window,
          });
        }
        const reason = event.data.reason;
        const wallSec = Math.max(0, (Date.now() - turnStartWall) / 1000);
        if (reason?.kind === "error") {
          ui.addChat(new Text(ansi.red(`${ui.icons.fail} ${reason.error.code}: ${reason.error.message}`), 0, 0));
          (ui as unknown as { onTurnEnd?: (i: unknown) => void }).onTurnEnd?.({
            tools: [],
            wallSec,
            outputTokens: turnOutput,
            cancelled: false,
            error: true,
          });
        } else if (reason?.kind === "aborted") {
          (ui as unknown as { onTurnEnd?: (i: unknown) => void }).onTurnEnd?.({
            tools: [],
            wallSec,
            outputTokens: 0,
            cancelled: true,
            error: false,
          });
        } else {
          const ordered = turnToolIds
            .map((id) => {
              const comp = tools.get(id);
              if (comp === undefined) return undefined;
              return {
                tool: comp.tool,
                ok: comp.doneOk ?? false,
                seconds: comp.seconds ?? 0,
                comp: comp as unknown,
                breakBefore: turnBreaks.has(id),
                hidden: comp.tool === "ask_user_question",
              };
            })
            .filter((t) => t !== undefined);
          (ui as unknown as { onTurnEnd?: (i: unknown) => void }).onTurnEnd?.({
            tools: ordered,
            wallSec,
            outputTokens: turnOutput,
            cancelled: false,
            error: false,
          });
          void triggerSuggest();
        }
        turnToolIds = [];
        turnBreaks = new Set<string>();
        needBreak = false;
        turnOutput = 0;
        ui.requestRender();
        return;
      }
      default:
        return;
    }
  });

  const restored = restoreTasks(agent.session);
  if (restored !== undefined) setUiTasks(restored);

  function suggestionsEnabled(): boolean {
    try {
      const home = process.env.DSH_HOME;
      if (home === undefined || home === "") return true;
      const raw = readFileSync(join(home, "kumo.json"), "utf8");
      const doc = JSON.parse(raw) as { suggestions?: boolean };
      return doc.suggestions ?? true;
    } catch {
      return true;
    }
  }

  function fastRoute(): { provider: string; model: string } | undefined {
    try {
      const home = process.env.DSH_HOME;
      if (home !== undefined && home !== "") {
        const raw = readFileSync(join(home, "kumo.json"), "utf8");
        const doc = JSON.parse(raw) as {
          models?: {
            fast?: { provider?: string; model?: string };
            main?: { provider?: string; model?: string };
          };
        };
        const fast = doc.models?.fast ?? doc.models?.main;
        if (fast?.provider !== undefined && fast?.model !== undefined) {
          return { provider: fast.provider, model: fast.model };
        }
      }
    } catch {
      // fall through
    }
    return undefined;
  }

  async function triggerSuggest(): Promise<void> {
    if (!suggestionsEnabled()) return;
    const route = fastRoute();
    if (route === undefined) return;
    const llm = ctx.get("llm") as
      | {
          stream(o: {
            provider: string;
            model: string;
            messages: unknown[];
            maxTokens?: number;
            reasoningEffort?: string;
            signal?: AbortSignal;
          }): AsyncIterable<{ type: string; text?: string }>;
          resolveModelInfo?(p: string, m: string): Promise<{ reasoning?: { efforts?: Array<{ id: string }> } }>;
        }
      | undefined;
    if (llm === undefined) return;
    if (lastUser.trim() === "" || currentAnswer.trim() === "") return;
    suggestController?.abort();
    const controller = new AbortController();
    suggestController = controller;
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      let off = false;
      try {
        const info = await llm.resolveModelInfo?.(route.provider, route.model);
        off = (info?.reasoning?.efforts ?? []).some((e) => e.id === "off");
      } catch {
        off = false;
      }
      let text = "";
      const excerpt = currentAnswer.slice(-800);
      const prompt = createUserMessage({
        content: [
          {
            type: "text",
            text: `Suggest the user's most likely next message, max 8 words, same language as the user. Reply with the message only.\n\nLast user prompt: ${lastUser}\nLast answer (excerpt): ${excerpt}`,
          },
        ],
        source: { kind: "plugin", plugin: "kumo-suggest" },
      });
      for await (const chunk of llm.stream({
        provider: route.provider,
        model: route.model,
        messages: [prompt],
        maxTokens: 24,
        ...(off ? { reasoningEffort: "off" } : {}),
        signal: controller.signal,
      })) {
        if (controller.signal.aborted) return;
        if (chunk.type === "text-delta" && chunk.text !== undefined) text += chunk.text;
      }
      if (controller.signal.aborted) return;
      const words = text.trim().split(/\s+/).filter((w) => w !== "").slice(0, 8);
      if (words.length === 0) return;
      if (controller.signal.aborted) return;
      (ui as unknown as { setGhost?: (t: string) => void }).setGhost?.(words.join(" "));
      ui.requestRender();
    } catch {
      // suggestion is best effort; never break the session
    } finally {
      clearTimeout(timer);
      if (suggestController === controller) suggestController = undefined;
    }
  }

  return () => {
    hideWorking();
    closeLive();
    for (const comp of tools.values()) comp.cancel();
    ui.requestRender();
    offStream();
    offSession();
  };
}

/**
 * Screen wiring for non-TTY (piped) runs: raw-ANSI renderers. Kept for
 * `echo "x" | kumo` usage and CI smoke tests.
 */
export function attach(
  ctx: Pick<DshContext, "on">,
  agent: { session: unknown },
  ui: ScreenUi,
): () => void {
  const started = new Set<string>();
  const todoToolIds = new Set<string>();
  const taskPanel = new TaskPanel(ui.icons);
  const showTasks = (raw: unknown): void => {
    const tasks = taskItems(raw);
    if (tasks === undefined) return;
    taskPanel.setTasks(tasks);
    const lines = taskPanel.plainLines();
    if (lines.length > 0) ui.screen.write(`${lines.join("\n")}\n`);
  };

  const offStream = ctx.on("agent/assistant-stream", ({ agent: subject, frame }: any) => {
    if (subject !== agent) return;
    const f = frame as StreamFrame;
    if (f.type === "start") {
      ui.reasoning.end();
      return;
    }
    if (f.type === "end") {
      ui.reasoning.end();
      return;
    }
    const chunk = f.chunk;
    if (chunk === undefined) return;
    switch (chunk.type) {
      case "reasoning-delta":
        ui.reasoning.push(chunk.text);
        return;
      case "text-delta":
        ui.text.push(chunk.text);
        return;
      case "block-start":
        if (chunk.blockType !== "reasoning") ui.reasoning.end();
        return;
      case "block-end":
        if (chunk.block.type === "reasoning") ui.reasoning.end();
        else if (chunk.block.type === "text") ui.text.end();
        return;
      case "tool-call-delta": {
        const id = String(chunk.id);
        if (chunk.name === "todo_write") todoToolIds.add(id);
        if (todoToolIds.has(id)) return;
        if (chunk.name !== undefined && !started.has(id)) {
          started.add(id);
          ui.tools.start(id, chunk.name);
        }
        if (chunk.argumentsDelta) ui.tools.args(id, chunk.argumentsDelta);
        return;
      }
      case "usage":
      case "finish":
        return;
      default:
        return;
    }
  });

  const offSession = ctx.on("session/event", (session: unknown, event: SessionEvent) => {
    if (session !== agent.session) return;
    switch (event.type) {
      case "tool/call": {
        const id = String(event.data.callId);
        if (event.data.name === "todo_write") {
          todoToolIds.add(id);
          return;
        }
        if (started.has(id)) return; // already streamed live
        started.add(id);
        ui.tools.start(id, event.data.name);
        if (event.data.arguments) ui.tools.args(id, event.data.arguments);
        return;
      }
      case "tool/result": {
        const block = event.data.message?.content?.[0];
        if (block === undefined || block.type !== "tool-result") return;
        if (todoToolIds.delete(String(block.toolCallId))) return;
        const output = block.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("\n");
        ui.tools.result(String(block.toolCallId), block.isError !== true, output);
        started.delete(String(block.toolCallId));
        return;
      }
      case "todo/write":
        showTasks(event.data?.todos);
        return;
      case "turn/end": {
        ui.reasoning.end();
        ui.text.end();
        const reason = event.data.reason;
        if (reason?.kind === "error") {
          ui.screen.write(`\n${ui.icons.fail} ${reason.error.code}: ${reason.error.message}\n`);
        } else if (reason?.kind === "aborted") {
          ui.screen.write("\n- cancelled\n");
        }
        return;
      }
      default:
        return;
    }
  });

  const restored = restoreTasks(agent.session);
  if (restored !== undefined) showTasks(restored);

  return () => {
    offStream();
    offSession();
  };
}

export function apply(ctx: DshContext): void {
  const service: RenderService = {};
  if (process.stdin.isTTY === true && process.stdout.isTTY === true) {
    // TUI mode: components only; the screen service stays empty.
    ctx.provide(KUMO_RENDER_SERVICE, service);
    ctx.inject(["kumoRepl"], (c: any) => {
      const repl: KumoRepl | undefined = c.kumoRepl;
      if (repl?.agent !== undefined && repl.ui !== undefined) {
        // Follow service.agent live so /new (same service object, new agent)
        // keeps rendering without re-provisioning (Cordis forbids re-provide).
        attachTui(ctx, repl.agent, repl.ui, service, () => repl.agent);
      }
    });
    return;
  }
  const ui = createUi(stdoutScreen());
  service.screen = ui;
  ctx.provide(KUMO_RENDER_SERVICE, service);
  ctx.inject(["kumoRepl"], (c: any) => {
    const repl: KumoRepl | undefined = c.kumoRepl;
    if (repl?.agent !== undefined) attach(ctx, repl.agent, ui);
  });
}
