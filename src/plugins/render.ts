import { Text } from "@earendil-works/pi-tui";
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

/**
 * Wire the live stream and the durable session log onto the pi-tui chat
 * components (T13a-d). Exported so tests can drive it with fake events.
 */
export function attachTui(
  ctx: Pick<DshContext, "on">,
  agent: { session: any },
  ui: NonNullable<KumoRepl["ui"]>,
  service: RenderService,
): () => void {
  const tps = new TpsMeter();
  const tools = new Map<string, ToolCallComponent>();
  let reasoning: ReasoningComponent | undefined;
  let text: AssistantTextComponent | undefined;
  let working: WorkingComponent | undefined;
  let lastInputTokens = 0;
  let lastOutputTokens = 0;

  service.describe = (callId: string) => {
    const comp = tools.get(callId);
    if (comp === undefined) return undefined;
    return { tool: comp.tool, summary: comp.summary(80) };
  };

  const hideWorking = (): void => {
    if (working !== undefined) {
      (ui as unknown as { removeChat?: (c: unknown) => void }).removeChat?.(working);
      working = undefined;
      ui.requestRender();
    }
  };

  const showWorking = (): void => {
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
      ui.addChat(comp);
    }
    return comp;
  };

  const offStream = ctx.on("agent/assistant-stream", ({ agent: subject, frame }: any) => {
    if (subject !== agent) return;
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
      ui.footer.set({ tps: tps.tps, pp: tps.pp });
      hideWorking();
      closeLive();
      ui.requestRender();
      return;
    }
    const chunk = f.chunk;
    if (chunk === undefined) return;
    const trackDelta = (): void => {
      tps.delta(now);
      ui.footer.set({ tps: tps.tps, pp: tps.pp });
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
        tps.usage(now, {
          outputTokens: Number(u.outputTokens ?? NaN),
          inputTokens: Number(u.inputTokens ?? NaN),
          cacheReadTokens: Number(
            u.cacheReadTokens ?? u.cachedTokens ?? u.cache_read ?? NaN,
          ),
        });
        ui.footer.set({ tps: tps.tps, pp: tps.pp });
        ui.requestRender();
        return;
      }
      case "finish":
        tps.endCall();
        ui.footer.set({ tps: tps.tps, pp: tps.pp });
        closeLive();
        ui.requestRender();
        return;
      default:
        return;
    }
  });

  const offSession = ctx.on("session/event", (session: unknown, event: SessionEvent) => {
    if (session !== agent.session) return;
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
        ui.addChat(userMessageComponent(trimmed));
        return;
      }
      case "turn/start":
        tps.reset();
        ui.footer.set({ tps: 0, pp: undefined });
        showWorking();
        return;
      case "tool/call": {
        hideWorking();
        const id = String(event.data.callId);
        const comp = ensureTool(id, event.data.name);
        if (event.data.arguments) comp.setArgs(event.data.arguments);
        ui.requestRender();
        return;
      }
      case "tool/result": {
        const block = event.data.message?.content?.[0];
        if (block === undefined || block.type !== "tool-result") return;
        const output = block.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("\n");
        tools.get(String(block.toolCallId))?.result(block.isError !== true, output);
        ui.requestRender();
        return;
      }
      case "turn/end": {
        hideWorking();
        closeLive();
        for (const comp of tools.values()) comp.cancel();
        const window = agent.session?.requestContext?.()?.contextWindow;
        if (typeof window === "number" && window > 0) {
          ui.footer.set({ contextUsed: lastInputTokens + lastOutputTokens, contextWindow: window });
        }
        const reason = event.data.reason;
        if (reason?.kind === "error") {
          ui.addChat(new Text(ansi.red(`${ui.icons.fail} ${reason.error.code}: ${reason.error.message}`), 0, 0));
        } else if (reason?.kind === "aborted") {
          ui.addChat(new Text(dim("- cancelled"), 0, 0));
        }
        ui.requestRender();
        return;
      }
      default:
        return;
    }
  });

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
        if (started.has(id)) return; // already streamed live
        started.add(id);
        ui.tools.start(id, event.data.name);
        if (event.data.arguments) ui.tools.args(id, event.data.arguments);
        return;
      }
      case "tool/result": {
        const block = event.data.message?.content?.[0];
        if (block === undefined || block.type !== "tool-result") return;
        const output = block.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("\n");
        ui.tools.result(String(block.toolCallId), block.isError !== true, output);
        started.delete(String(block.toolCallId));
        return;
      }
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
        attachTui(ctx, repl.agent, repl.ui, service);
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
