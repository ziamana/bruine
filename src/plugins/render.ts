import { Text } from "@earendil-works/pi-tui";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MainRequestMemory, sameRoute, shouldSuggest, sharedPrefixRequest, standaloneRequest } from "./suggest.js";
import { ReasoningLine, dim, type Screen } from "../render/reasoning.js";
import { kumoIcons, type KumoIcons } from "../render/chars.js";
import { TextStream } from "../render/text.js";
import { ToolCallView } from "../render/tools.js";
import { ReasoningComponent } from "../ui/reasoning-component.js";
import { ToolCallComponent, type ChatToolCall } from "../ui/tool-call-component.js";
import { QuestionCallComponent } from "../ui/question-call-component.js";
import { AssistantTextComponent, userMessageComponent } from "../ui/assistant-text.js";
import { gitStatus, turnChanges, type ChangedFile, type GitStatus } from "../ui/changes.js";
import { MODE_ANNOUNCEMENTS } from "./modes.js";
import { TpsMeter } from "../ui/tps.js";
import type { TurnActivity } from "../ui/turn-activity.js";
import { SessionSpend } from "../ui/spend.js";
import { ansi } from "../ui/theme.js";
import { TaskPanel, taskItems, type TaskItem } from "../ui/task-panel.js";
import { readSettingsRoute } from "../ui/kumo-ui.js";
import { appendErrorLog, describeLlmError, fetchAvailableModels, formatK } from "../ui/errors.js";
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

/** A token count the server actually sent, or undefined when it sent nothing. */
function reported(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Wire the live stream and the durable session log onto the pi-tui chat
 * components (T13a-d). Exported so tests can drive it with fake events.
 */
export function attachTui(
  ctx: DshContext,
  agent: { session: any },
  ui: NonNullable<KumoRepl["ui"]> & { activity?: TurnActivity; showWorking?: () => void },
  service: RenderService,
  getAgent?: () => { session: any },
): () => void {
  const tps = new TpsMeter();
  const tools = new Map<string, ChatToolCall>();
  const todoToolIds = new Set<string>();
  const setUiTasks = (tasks: TaskItem[]): void => {
    (ui as unknown as { setTasks?: (items: TaskItem[]) => void }).setTasks?.(tasks);
  };
  let reasoning: ReasoningComponent | undefined;
  let text: AssistantTextComponent | undefined;
  let lastInputTokens = 0;
  let lastOutputTokens = 0;
  let lastCacheTokens = 0;
  /** D3: what the whole session has spent, as opposed to the request in flight. */
  const spend = new SessionSpend(agent.session);
  let turnStartWall = Date.now();
  let turnOutput = 0;
  /** T59: the workspace as it was when this turn started, to diff against. */
  let turnBefore: GitStatus | undefined;
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
    if (ui.activity?.state === "Waiting for model") ui.activity.setState("Working");
    ui.requestRender();
  };

  const showWorking = (): void => {
    if (reasoning === undefined && text === undefined) {
      ui.showWorking?.();
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
      // T57: the repaint hook is what lets the answer be revealed at a readable
      // pace instead of one token at a time. Without it every delta lands whole.
      text = new AssistantTextComponent({ onTick: () => ui.requestRender(), icons: ui.icons });
      ui.addChat(text);
    }
    return text;
  };

  const ensureTool = (id: string, toolName: string): ChatToolCall => {
    let comp = tools.get(id);
    if (comp === undefined) {
      // A question has a shape of its own: the call is drawn from its first byte, and
      // the form's answers settle it (KumoUi hands them to the registered call). The
      // repaint hook is what the reveal writes through, so a question is watched being
      // written instead of jumping from one model-sized piece to the next.
      const question = toolName === "ask_user_question"
        ? new QuestionCallComponent(Date.now, ui.icons, { onTick: () => ui.requestRender() })
        : undefined;
      comp = question ?? new ToolCallComponent(toolName, Date.now, ui.icons);
      tools.set(id, comp);
      if (needBreak) {
        turnBreaks.add(id);
        needBreak = false;
      }
      turnToolIds.push(id);
      if (question !== undefined) (ui as unknown as { addQuestionCall?: (c: QuestionCallComponent) => void }).addQuestionCall?.(question);
      else ui.addChat(comp);
    }
    return comp;
  };

  const footerState = (): Record<string, unknown> =>
    (ui as unknown as { footer?: { state?: Record<string, unknown> } }).footer?.state ?? {};

  /** T33b: one red actionable line + one dim hint; detail only to kumo.log. */
  /**
   * T59: publish what the turn did to the files, once the receipt is on screen.
   *
   * The receipt is synchronous and this is not, so the line lands a frame or two
   * later. That ordering is deliberate: a turn that took four minutes should not
   * have its summary held hostage to a `git status` in a large repository.
   */
  const reportTurnChanges = (ordered: ReadonlyArray<{ tool: string; comp: unknown }>): void => {
    const declared = ordered
      .map((t) => (t.comp as { touchedPath?: () => string | undefined }).touchedPath?.())
      .filter((p): p is string => p !== undefined);
    const before = turnBefore;
    turnBefore = undefined;
    void turnChanges({ before, declared, cwd: process.cwd() }).then((changed) => {
      if (changed.length === 0) return;
      (ui as unknown as { showTurnChanges?: (files: readonly ChangedFile[]) => void }).showTurnChanges?.(changed);
      ui.requestRender();
    });
  };

  const showLlmError = async (failure: unknown): Promise<void> => {
    const f = (failure ?? {}) as { code?: unknown; message?: unknown; status?: unknown };
    const settings = readSettingsRoute();
    const state = footerState();
    const route = {
      provider: settings?.providerDisplayName ?? settings?.provider ?? "the model server",
      model: settings?.model ?? "",
      ...(settings?.baseUrl !== undefined ? { baseUrl: settings.baseUrl } : {}),
      ...(typeof state.contextWindow === "number" ? { contextWindow: state.contextWindow } : {}),
    };
    const lines = describeLlmError(f, route);
    // T55: the error is written straight away and the model list fills the hint
    // in place once the server answers. It used to wait on that network call
    // before printing anything, which delayed the message the user actually needs
    // and let the turn receipt land above the error it belongs to.
    const message = new Text(ansi.red(`${ui.icons.fail} ${lines.message}`), 0, 0);
    const hint = new Text(dim(lines.hint), 0, 0);
    ui.addChat(message);
    ui.addChat(hint);
    ui.requestRender();
    if (lines.wantAvailableModels === true && settings?.baseUrl !== undefined) {
      const ids = await fetchAvailableModels(settings.baseUrl);
      if (ids.length > 0) {
        hint.setText(dim(`Available: ${ids.join(", ")}. ${lines.hint}`));
        ui.requestRender();
      }
    }
    void appendErrorLog(f);
  };

  // T33b: visible compaction (notice while running, one dim line after).
  let compactionBefore: number | undefined;
  let compactionShadowed: number | undefined;

  const liveAgent = (): { session: any } => {
    try {
      return getAgent?.() ?? agent;
    } catch {
      return agent;
    }
  };

  let subagentCount = 0;
  const refreshSubagents = (): void => {
    type LiveAgent = { session?: { id?: unknown }; status?: string };
    const registry = ctx.get("agents") as {
      list?(): LiveAgent[];
      isOwnedBy?(id: unknown, owner: unknown): boolean;
    } | undefined;
    const candidates = registry?.list?.() ?? [];
    const root = liveAgent();
    const owned = new Set<unknown>([root]);
    // Runtime ownership includes grandchildren, independently of session ids.
    let changed = true;
    while (changed && registry?.isOwnedBy) {
      changed = false;
      for (const candidate of candidates) {
        if (owned.has(candidate) || candidate.session?.id === undefined) continue;
        for (const parent of owned) {
          if (!registry.isOwnedBy(candidate.session.id, parent)) continue;
          owned.add(candidate); changed = true; break;
        }
      }
    }
    const count = candidates.filter(candidate => candidate !== root && owned.has(candidate) && candidate.status === "running").length;
    if (count === subagentCount) return;
    subagentCount = count;
    ui.footer.set({ subagents: count });
    ui.requestRender();
  };
  // The suggestion for the next prompt starts from the conversation's own request, so the server
  // answers it out of the cache it already holds: remember the last one the loop sent.
  const mainRequests = new MainRequestMemory();
  const offRequest = ctx.on(
    "llm/stream",
    (options: Parameters<MainRequestMemory["see"]>[0], next: () => unknown) => {
      mainRequests.see(options, (liveAgent() as { session?: { id?: string } }).session?.id);
      return next();
    },
    { global: true, prepend: true },
  );
  const offAgentCreated = ctx.on("agent/created", refreshSubagents);
  const offAgentStatus = ctx.on("agent/status", refreshSubagents);
  const offAgentDisposed = ctx.on("agent/disposed", refreshSubagents);
  refreshSubagents();

  const offStream = ctx.on("agent/assistant-stream", ({ agent: subject, frame }: any) => {
    if (subject !== liveAgent()) return;
    const f = frame as StreamFrame;
    const now = typeof f.time === "number" ? f.time : Date.now();
    if (f.type === "start") {
      tps.startCall(now);
      // `/new` and `/resume` swap the session under this wiring: a call is where
      // the row notices, and the totals follow the conversation rather than the
      // process — a new one at nothing, a resumed one at what its log recorded.
      if (spend.follow(liveAgent().session)) ui.footer.set(spend.readings);
      else spend.beginCall();
      ui.footer.set({ tps: 0, pp: undefined });
      closeLive();
      // T59: the workspace is read now so the end of the turn can be diffed
      // against it. Fire and forget: a slow repository must never delay the
      // first token, and a reading that misses the start measures nothing rather
      // than something wrong.
      void gitStatus(process.cwd()).then((status) => {
        turnBefore = status;
      });
      // A call starts the moment the request is sent; a local server then prefills in
      // silence for seconds. Keep (or show) Working until the first content delta.
      // Hiding it here made it vanish instantly on llama.cpp (BOS, real server, 2026-09-26).
      showWorking();
      return;
    }
    if (f.type === "end") {
      tps.endCall();
      ui.footer.set({ tps: tps.measuredTps, pp: tps.pp, cachePct: tps.cachePct, cacheFirst: tps.cacheFirst });
      hideWorking();
      closeLive();
      ui.requestRender();
      return;
    }
    const chunk = f.chunk;
    if (chunk === undefined) return;
    const trackDelta = (content: unknown): void => {
      if (typeof content !== "string" || content.length === 0) return;
      tps.delta(now);
      ui.footer.set({ tps: tps.measuredTps, pp: tps.pp, cachePct: tps.cachePct, cacheFirst: tps.cacheFirst });
    };
    switch (chunk.type) {
      case "reasoning-delta":
        hideWorking();
        trackDelta(chunk.text);
        ensureReasoning().push(chunk.text);
        ui.requestRender();
        return;
      case "text-delta":
        hideWorking();
        trackDelta(chunk.text);
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
        hideWorking();
        trackDelta(chunk.argumentsDelta || chunk.name);
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
        // T55: publish the running context on every usage chunk, not only at
        // turn/end, so the meter in the footer is seen to climb. This is the
        // server's own running total, never an estimate: a server that does not
        // stream usage leaves the number where it was, which is the honest answer.
        const window = agent.session?.requestContext?.()?.contextWindow;
        if (typeof window === "number" && window > 0) {
          ui.footer.set({ contextUsed: lastInputTokens + lastCacheTokens + lastOutputTokens, contextWindow: window });
        }
        // D3: the row's own readings — ↑ the prompt, ↓ the answer, R what the cache
        // served — as the totals of the whole session, added to as the calls report.
        // A field that was missing is not a zero: a glyph appears once the server
        // has sent that count at least once, and until then the row says nothing
        // about it rather than claiming the session spent nothing.
        spend.add({ input: reported(u.inputTokens), output: reported(u.outputTokens), cacheRead: reported(cached) });
        ui.footer.set({ ...spend.readings, tps: tps.measuredTps, pp: tps.pp, cachePct: tps.cachePct, cacheFirst: tps.cacheFirst });
        ui.requestRender();
        return;
      }
      case "finish":
        tps.endCall();
        ui.footer.set({ tps: tps.measuredTps, pp: tps.pp, cachePct: tps.cachePct, cacheFirst: tps.cacheFirst });
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
        // The pinned activity stays in place when the durable prompt arrives.
        ui.addUserPrompt(trimmed);
        return;
      }
      case "turn/start":
        refreshSubagents();
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
      case "compaction/start": {
        const state = footerState();
        const pct =
          typeof state.contextUsed === "number" &&
          typeof state.contextWindow === "number" &&
          state.contextWindow > 0
            ? Math.round((state.contextUsed / state.contextWindow) * 100)
            : 80;
        compactionBefore = typeof state.contextUsed === "number" ? state.contextUsed : undefined;
        compactionShadowed = undefined;
        (ui as unknown as { showNotice?: (t: string) => void }).showNotice?.(
          `Context ${String(pct)}% full: summarizing the conversation…`,
        );
        return;
      }
      case "compaction/summary": {
        const n = Number(event.data?.shadowedTokenCount);
        if (Number.isFinite(n)) compactionShadowed = n;
        return;
      }
      case "compaction/end": {
        // A failed close carries `error`; the /compact reply or the next
        // retry tells the story — do not print a fake "Compacted:" line.
        if (event.data?.error === undefined) {
        if (compactionBefore !== undefined && compactionShadowed !== undefined) {
          const after = Math.max(0, compactionBefore - compactionShadowed);
          ui.addChat(new Text(dim(`Compacted: ${formatK(compactionBefore)} → ${formatK(after)} tokens`), 0, 0));
        } else {
          ui.addChat(new Text(dim("Compacted."), 0, 0));
        }
        }
        compactionBefore = undefined;
        compactionShadowed = undefined;
        ui.requestRender();
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
          void showLlmError(reason.error);
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
          reportTurnChanges(ordered);
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
  // A resumed conversation opens on the total it left off at, not on zero.
  ui.footer.set(spend.readings);

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
    // Not while planning, and not when there is nothing to build a suggestion on.
    const modes = ctx.get("modes") as { plan?: boolean } | undefined;
    if (!shouldSuggest({ enabled: suggestionsEnabled(), plan: modes?.plan === true, lastUser, answer: currentAnswer })) return;
    const route = fastRoute();
    if (route === undefined) return;
    const llm = ctx.get("llm") as
      | {
          stream(o: {
            provider: string;
            model: string;
            messages: unknown[];
            tools?: unknown[];
            maxTokens?: number;
            reasoningEffort?: string;
            signal?: AbortSignal;
          }): AsyncIterable<{ type: string; text?: string }>;
          resolveModelInfo?(p: string, m: string): Promise<{ reasoning?: { efforts?: Array<{ id: string }> } }>;
        }
      | undefined;
    if (llm === undefined) return;
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
      // On the conversation's own route the suggestion is the end of the conversation: the same
      // system prompt, tools and history the server already holds, plus one more message. On
      // any other route it has to stand alone, which costs that route a full prompt of its own.
      const last = mainRequests.last;
      const effort = off ? { effort: "off" } : {};
      const request = last !== undefined && sameRoute(route, last)
        ? sharedPrefixRequest(last, currentAnswer, effort)
        : standaloneRequest(route, lastUser, currentAnswer.slice(-800), effort);
      let text = "";
      for await (const chunk of llm.stream({ ...request, signal: controller.signal })) {
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
    offRequest();
    offAgentCreated();
    offAgentStatus();
    offAgentDisposed();
    if (subagentCount > 0) { ui.footer.set({ subagents: 0 }); ui.requestRender(); }
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

  let compactionBefore: number | undefined;
  let compactionShadowed: number | undefined;

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
      case "compaction/start":
        ui.screen.write("\nsummarizing the conversation…\n");
        return;
      case "compaction/summary": {
        const n = Number(event.data?.shadowedTokenCount);
        if (Number.isFinite(n)) compactionShadowed = n;
        return;
      }
      case "compaction/end":
        if (compactionBefore !== undefined && compactionShadowed !== undefined) {
          const after = Math.max(0, compactionBefore - compactionShadowed);
          ui.screen.write(`${dim(`Compacted: ${formatK(compactionBefore)} → ${formatK(after)} tokens`)}\n`);
        } else {
          ui.screen.write(`${dim("Compacted.")}\n`);
        }
        compactionBefore = undefined;
        compactionShadowed = undefined;
        return;
      case "turn/end": {
        ui.reasoning.end();
        ui.text.end();
        const reason = event.data.reason;
        if (reason?.kind === "error") {
          const settings = readSettingsRoute();
          const lines = describeLlmError(reason.error ?? {}, {
            provider: settings?.providerDisplayName ?? settings?.provider ?? "the model server",
            model: settings?.model ?? "",
            ...(settings?.baseUrl !== undefined ? { baseUrl: settings.baseUrl } : {}),
          });
          ui.screen.write(`\n${ui.icons.fail} ${lines.message}\n${dim(lines.hint)}\n`);
          void appendErrorLog(reason.error ?? {});
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
  if (process.env.KUMO_HEADLESS === "1") {
    ctx.provide(KUMO_RENDER_SERVICE, service);
    return;
  }
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
