import { describe, expect, test } from "vitest";
import { recentSessions, restoredDialogue } from "../src/plugins/session-history.js";

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

  test("restores user and assistant text without plugin reminders", () => {
    const session = { snapshotEvents: () => [
      { type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "Hello" }] } },
      { type: "user/message", data: { source: { kind: "plugin" }, content: [{ type: "text", text: "hidden" }] } },
      { type: "assistant/message", data: { message: { content: [{ type: "text", text: "Hi" }] } } },
    ] };
    expect(restoredDialogue(session)).toEqual([{ role: "user", text: "Hello" }, { role: "assistant", text: "Hi" }]);
  });
});
