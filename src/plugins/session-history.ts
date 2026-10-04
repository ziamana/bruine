import { Text, type Component } from "@earendil-works/pi-tui";
import type { BruineIcons } from "../render/chars.js";
import { AssistantTextComponent } from "../ui/assistant-text.js";
import { QuestionCallComponent } from "../ui/question-call-component.js";
import type { QuestionAnswer } from "../ui/questions.js";
import { ansi } from "../ui/theme.js";
import { ToolCallComponent, type ChatToolCall } from "../ui/tool-call-component.js";
import { stripReminders } from "./ui-skills.js";

/** Project-scoped choices for the REPL's resume picker. */
export interface RecentSession {
  id: string;
  createdAt: number;
  title: string;
}

interface SessionQueryLike {
  listSessions(): Promise<Array<{
    header: { id: string; cwd?: string; createdAt: number; origin?: string };
    persisted: boolean;
  }>>;
  readTitle?(id: string): Promise<{ title: string } | undefined>;
}

/** A missing query service means this dsh build cannot resume sessions. */
export async function recentSessions(
  query: SessionQueryLike | undefined,
  cwd: string,
  excludeId?: string,
): Promise<RecentSession[]> {
  if (query === undefined) return [];
  const rows = (await query.listSessions())
    .filter((row) => row.persisted && row.header.cwd === cwd && row.header.origin !== "subagent" && row.header.id !== excludeId)
    .sort((a, b) => b.header.createdAt - a.header.createdAt)
    .slice(0, 20);
  return Promise.all(rows.map(async (row) => {
    let title = "Untitled conversation";
    try { title = (await query.readTitle?.(row.header.id))?.title ?? title; } catch { /* title is optional */ }
    return { id: row.header.id, createdAt: row.header.createdAt, title };
  }));
}

export function sessionChoice(row: RecentSession): string {
  const date = new Date(row.createdAt).toLocaleString();
  return `${date}  ${row.title.slice(0, 60)}`;
}

/** What a resumed conversation needs from the UI: the same entry points a live turn uses. */
export interface ReplayUi {
  icons: BruineIcons;
  addUserPrompt(text: string): void;
  addChat(component: Component): void;
  addQuestionCall?(call: QuestionCallComponent): void;
  onTurnEnd?(info: {
    tools: Array<{ tool: string; ok: boolean; seconds: number; comp: unknown; hidden?: boolean }>;
    wallSec: number;
    outputTokens: number;
    cancelled: boolean;
    error: boolean;
  }): void;
}

/** Turns a resumed conversation puts back on screen; older ones are summarized, not drawn. */
export const REPLAY_TURNS = 3;

interface SessionEvent {
  type?: string;
  time?: number;
  data?: Record<string, any>;
}

const textOf = (blocks: unknown): string =>
  (Array.isArray(blocks) ? blocks : [])
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n")
    .trim();

/**
 * Put the last turns of a saved conversation back on screen through the same
 * components a live turn draws.
 *
 * It used to keep only the text blocks of the last twenty messages and print them
 * as raw strings: no markdown, no tool calls, no results, no receipt, so a resumed
 * session looked like a different program from the one that had written it. Here the
 * events are replayed with their own timestamps standing in for the clock, so a tool
 * that took fourteen seconds says fourteen seconds, and the receipt closes each turn.
 * Reasoning is left out: its duration is not in the log, and a number invented for a
 * replay is worse than no line.
 */
export function replaySession(session: { snapshotEvents?(): unknown }, ui: ReplayUi, turns = REPLAY_TURNS): void {
  const all = session.snapshotEvents?.();
  if (!Array.isArray(all)) return;
  const events = all.filter((e): e is SessionEvent => e !== null && typeof e === "object");
  const starts = events.flatMap((e, i) => (e.type === "turn/start" ? [i] : []));
  const first = starts.length > turns ? starts[starts.length - turns]! : 0;
  const skipped = Math.max(0, starts.length - turns);
  if (skipped > 0) ui.addChat(new Text(ansi.gray(`${skipped} earlier turn${skipped === 1 ? "" : "s"} not shown`), 1, 0));

  const calls = new Map<string, { comp: ChatToolCall; clock: { t: number }; name: string }>();
  let turnTools: Array<{ tool: string; comp: ChatToolCall }> = [];
  let turnStart = 0;
  for (const event of events.slice(first)) {
    const time = typeof event.time === "number" ? event.time : 0;
    const data = event.data ?? {};
    switch (event.type) {
      case "turn/start":
        turnStart = time;
        turnTools = [];
        break;
      case "user/message": {
        if (data.source?.kind !== "user") break;
        const text = stripReminders(textOf(data.content));
        if (text !== "") ui.addUserPrompt(text);
        break;
      }
      case "assistant/message": {
        for (const block of data.message?.content ?? []) {
          if (block?.type !== "text" || typeof block.text !== "string" || block.text.trim() === "") continue;
          const answer = new AssistantTextComponent({ icons: ui.icons, animate: false });
          answer.push(block.text);
          answer.finish();
          ui.addChat(answer);
        }
        break;
      }
      case "tool/call": {
        const id = String(data.callId ?? "");
        const name = String(data.name ?? "");
        if (id === "" || name === "" || name === "todo_write") break;
        const clock = { t: time };
        const question = name === "ask_user_question" ? new QuestionCallComponent(() => clock.t, ui.icons) : undefined;
        const comp: ChatToolCall = question ?? new ToolCallComponent(name, () => clock.t, ui.icons);
        comp.setArgs(typeof data.arguments === "string" ? data.arguments : "");
        calls.set(id, { comp, clock, name });
        turnTools.push({ tool: name, comp });
        if (question !== undefined && ui.addQuestionCall !== undefined) ui.addQuestionCall(question);
        else ui.addChat(comp);
        break;
      }
      case "tool/result": {
        const block = data.message?.content?.[0];
        const call = block?.type === "tool-result" ? calls.get(String(block.toolCallId)) : undefined;
        if (call === undefined) break;
        call.clock.t = time;
        const output = textOf(block.content);
        const ok = block.isError !== true;
        const answers = call.name === "ask_user_question" ? answersIn(output) : undefined;
        if (answers !== undefined && call.comp instanceof QuestionCallComponent) call.comp.answer(answers);
        else call.comp.result(ok, output);
        break;
      }
      case "turn/end": {
        for (const { comp } of turnTools) if (comp.active) comp.cancel();
        const kind = String(data.reason?.kind ?? "completed");
        ui.onTurnEnd?.({
          tools: turnTools.map(({ tool, comp }) => ({
            tool,
            ok: comp.doneOk ?? false,
            seconds: comp.seconds ?? 0,
            comp,
            hidden: tool === "ask_user_question",
          })),
          wallSec: Math.max(0, (time - turnStart) / 1000),
          outputTokens: 0,
          cancelled: kind === "cancelled" || kind === "interrupted",
          error: kind === "error" || kind === "failed",
        });
        break;
      }
    }
  }
}

/** The structured answers inside an `ask_user_question` result, when it carries them. */
function answersIn(output: string): QuestionAnswer[] | undefined {
  try {
    const parsed = JSON.parse(output) as { answers?: unknown };
    if (!Array.isArray(parsed.answers)) return undefined;
    return parsed.answers.flatMap((a): QuestionAnswer[] => {
      const row = a as Partial<QuestionAnswer> | null;
      if (row === null || typeof row !== "object" || typeof row.id !== "string" || !Array.isArray(row.selected)) return [];
      return [{ id: row.id, selected: row.selected.map(String), ...(typeof row.custom === "string" ? { custom: row.custom } : {}) }];
    });
  } catch {
    return undefined;
  }
}
