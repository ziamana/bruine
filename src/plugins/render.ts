import { ReasoningLine, dim, type Screen } from "../render/reasoning.js";
import { kumoIcons, type KumoIcons } from "../render/chars.js";
import { TextStream } from "../render/text.js";
import { ToolCallView } from "../render/tools.js";
import type { DshContext } from "./ctx.js";

/** Stable Cordis plugin name. */
export const name = "kumo-render";

/** The service provided by this plugin and injected by kumo-approval. */
export const KUMO_RENDER_SERVICE = "kumoRender";

/** The drawing surface kumo owns for the whole session. */
export interface KumoUi {
  screen: Screen;
  icons: KumoIcons;
  reasoning: ReasoningLine;
  text: TextStream;
  tools: ToolCallView;
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

export function createUi(screen: Screen, icons: KumoIcons = kumoIcons()): KumoUi {
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
  chunk?: any;
}

interface SessionEvent {
  type: string;
  data: any;
}

/**
 * Wire the live stream and the durable session log onto the renderers.
 * Pure event wiring: exported so tests can drive it with fake events.
 */
export function attach(
  ctx: Pick<DshContext, "on">,
  agent: { session: unknown },
  ui: KumoUi,
): () => void {
  const started = new Set<string>();

  const offStream = ctx.on("agent/assistant-stream", ({ agent: subject, frame }: any) => {
    if (subject !== agent) return;
    const f = frame as StreamFrame;
    if (f.type === "start") {
      // A new attempt closes any dangling reasoning from a previous one.
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
          ui.screen.write(`\n${dim("- cancelled")}\n`);
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
  const ui = createUi(stdoutScreen());
  ctx.provide(KUMO_RENDER_SERVICE, ui);
  ctx.inject(["kumoRepl"], (c: any) => {
    const repl = c.kumoRepl;
    if (repl?.agent !== undefined) attach(ctx, repl.agent, ui);
  });
}
