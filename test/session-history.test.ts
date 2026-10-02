import { describe, expect, test } from "vitest";
import type { Component } from "@earendil-works/pi-tui";
import { recentSessions, replaySession, type ReplayUi } from "../src/plugins/session-history.js";
import { UNICODE_ICONS } from "../src/render/chars.js";
import type { QuestionCallComponent } from "../src/ui/question-call-component.js";

const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
const text = (c: Component, w = 100): string => c.render(w).map(strip).join("\n");

function fakeUi() {
  const chat: Component[] = [];
  const prompts: string[] = [];
  const calls: QuestionCallComponent[] = [];
  const turnEnds: Array<{ tools: number; wallSec: number; cancelled: boolean }> = [];
  const ui: ReplayUi = {
    icons: UNICODE_ICONS,
    addUserPrompt: (t) => prompts.push(t),
    addChat: (c) => chat.push(c),
    addQuestionCall: (c) => { calls.push(c); chat.push(c); },
    onTurnEnd: (i) => turnEnds.push({ tools: i.tools.length, wallSec: i.wallSec, cancelled: i.cancelled }),
  };
  return { ui, chat, prompts, calls, turnEnds };
}

const turn = (n: number, t0: number, body: unknown[]) => [
  { type: "turn/start", time: t0, data: { turn: n } },
  { type: "user/message", time: t0 + 1, data: { source: { kind: "user" }, content: [{ type: "text", text: `question ${n}` }] } },
  ...body,
  { type: "turn/end", time: t0 + 20_000, data: { turn: n, reason: { kind: "completed" } } },
];

describe("session history", () => {
  test("resume choices stay in the current project and exclude subagents", async () => {
    const query = {
      listSessions: async () => [
        { header: { id: "older", cwd: "/repo", createdAt: 1 }, persisted: true },
        { header: { id: "newer", cwd: "/repo", createdAt: 3 }, persisted: true },
        { header: { id: "child", cwd: "/repo", createdAt: 4, origin: "subagent" }, persisted: true },
        { header: { id: "other", cwd: "/other", createdAt: 5 }, persisted: true },
      ],
      readTitle: async (id: string) => ({ title: `title ${id}` }),
    };
    expect(await recentSessions(query, "/repo", "newer")).toEqual([{ id: "older", createdAt: 1, title: "title older" }]);
  });

  test("a resumed conversation is replayed through the live components", () => {
    const { ui, chat, prompts, turnEnds } = fakeUi();
    replaySession({ snapshotEvents: () => [
      ...turn(1, 1000, [
        { type: "user/message", time: 1002, data: { source: { kind: "plugin" }, content: [{ type: "text", text: "hidden reminder" }] } },
        { type: "tool/call", time: 2000, data: { callId: "c1", name: "bash", arguments: JSON.stringify({ command: "ls -la" }) } },
        { type: "tool/result", time: 16_000, data: { message: { content: [{ type: "tool-result", toolCallId: "c1", isError: false, content: [{ type: "text", text: "total 0" }] }] } } },
        { type: "tool/call", time: 16_100, data: { callId: "c2", name: "bash", arguments: JSON.stringify({ command: "false" }) } },
        { type: "tool/result", time: 16_200, data: { message: { content: [{ type: "tool-result", toolCallId: "c2", isError: true, content: [{ type: "text", text: "exit 1" }] }] } } },
        { type: "assistant/message", time: 17_000, data: { message: { content: [
          { type: "reasoning", text: "thinking out loud" },
          { type: "text", text: "## Done\n\nIt **works**." },
        ] } } },
      ]),
    ] }, ui);
    expect(prompts).toEqual(["question 1"]);
    const out = chat.map((c) => text(c)).join("\n");
    // Markdown is rendered, not printed; reasoning and plugin reminders stay out.
    expect(out).toContain("Done");
    expect(out).toContain("It works.");
    expect(out).not.toContain("##");
    expect(out).not.toContain("**");
    expect(out).not.toContain("thinking out loud");
    expect(out).not.toContain("hidden reminder");
    // The timestamps stand in for the clock: the first tool took fourteen seconds.
    expect(out).toContain("ls -la");
    expect(out).toContain("Took 14s");
    // A failed tool is red, a good one settled; the turn gets its receipt.
    const rails = chat.map((c) => (c as { rail?: string }).rail).filter((r) => r !== undefined);
    expect(rails).toEqual(["blue", "red"]);
    expect(turnEnds).toEqual([{ tools: 2, wallSec: 20, cancelled: false }]);
  });

  test("a question and its answers come back as the settled call", () => {
    const { ui, calls } = fakeUi();
    const questions = [{ id: "q1", question: "Which?", options: [{ label: "A" }, { label: "B", description: "second" }] }];
    replaySession({ snapshotEvents: () => turn(1, 0, [
      { type: "tool/call", time: 10, data: { callId: "q", name: "ask_user_question", arguments: JSON.stringify({ questions }) } },
      { type: "tool/result", time: 5000, data: { message: { content: [{ type: "tool-result", toolCallId: "q", isError: false, content: [{ type: "text", text: JSON.stringify({ answers: [{ id: "q1", selected: ["B"] }] }) }] }] } } },
    ]) }, ui);
    expect(calls).toHaveLength(1);
    const out = text(calls[0]!);
    expect(calls[0]!.rail).toBe("blue");
    expect(out).toContain("✓ B");
    expect(out).toContain("● B - second");
    expect(out).toContain("○ A");
  });

  test("only the last turns are drawn, and the rest are said to exist", () => {
    const { ui, prompts, chat } = fakeUi();
    const events = [1, 2, 3, 4, 5].flatMap((n) => turn(n, n * 100_000, []));
    replaySession({ snapshotEvents: () => events }, ui);
    expect(prompts).toEqual(["question 3", "question 4", "question 5"]);
    expect(text(chat[0]!)).toContain("2 earlier turns not shown");
  });

  test("a call that never got its result is cancelled, not left spinning", () => {
    const { ui, chat, turnEnds } = fakeUi();
    replaySession({ snapshotEvents: () => turn(1, 0, [
      { type: "tool/call", time: 10, data: { callId: "x", name: "bash", arguments: JSON.stringify({ command: "sleep 99" }) } },
    ]) }, ui);
    const call = chat.find((c) => (c as { tool?: string }).tool === "bash") as unknown as { rail: string; active: boolean };
    expect(call.active).toBe(false);
    expect(call.rail).toBe("red");
    expect(turnEnds).toHaveLength(1);
  });

  test("a missing or unreadable log draws nothing", () => {
    const { ui, chat } = fakeUi();
    replaySession({}, ui);
    replaySession({ snapshotEvents: () => "nope" }, ui);
    expect(chat).toEqual([]);
  });
});
