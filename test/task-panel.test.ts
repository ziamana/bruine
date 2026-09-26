import { describe, expect, test } from "vitest";
import { ASCII_ICONS, UNICODE_ICONS } from "../src/render/chars.js";
import { TaskPanel, TASKS_HELP, taskItems } from "../src/ui/task-panel.js";
import { strip } from "./fakes.js";

const list = (active = 2) => [
  { content: "Read the launcher", status: "completed" as const },
  { content: "Find the footer", status: "completed" as const },
  { content: "Add the panel", status: active === 2 ? "in_progress" as const : "completed" as const },
  { content: "Update tests", status: "pending" as const },
  { content: "Run e2e", status: "pending" as const },
];

describe("TaskPanel", () => {
  test("three writes replace the entire list and update the counter", () => {
    const panel = new TaskPanel(UNICODE_ICONS, () => 0);
    panel.setTasks([{ content: "Old", status: "pending" }]);
    panel.setTasks([{ content: "Middle", status: "in_progress" }]);
    panel.setTasks(list());
    const out = strip(panel.render(80).join("\n"));
    expect(out).toContain("Tasks  2/5");
    expect(out).toContain("· Add the panel");
    expect(out).not.toContain("Old");
    expect(out).not.toContain("Middle");
  });

  test("limits the panel to seven lines, then ctrl+t can reveal everything", () => {
    const panel = new TaskPanel(UNICODE_ICONS, () => 100);
    panel.setTasks(Array.from({ length: 10 }, (_, i) => ({
      content: `Step ${i}`, status: i === 7 ? "in_progress" : "pending",
    })));
    const compact = strip(panel.render(50).join("\n"));
    expect(panel.render(50)).toHaveLength(7);
    expect(compact).toContain("Step 7");
    expect(compact).toContain("Step 6");
    expect(compact).toContain("… 5 more");
    panel.toggleExpanded();
    expect(panel.render(50)).toHaveLength(11);
  });

  test("all completed collapses; clearTasks discards the panel and expansion", () => {
    const panel = new TaskPanel(UNICODE_ICONS);
    panel.setTasks(list());
    expect(panel.setTasks(list().map((item) => ({ ...item, status: "completed" as const })))).toBe(5);
    expect(panel.render(80)).toEqual([]);
    panel.setTasks(list());
    panel.toggleExpanded();
    panel.clearTasks();
    expect(panel.tasks).toEqual([]);
    expect(panel.expanded).toBe(false);
    expect(panel.render(80)).toEqual([]);
    expect(TASKS_HELP).toBe("ctrl+t  show all tasks");
  });

  test("ASCII and hostile content stay plain and single-line", () => {
    const panel = new TaskPanel(ASCII_ICONS, () => 0);
    panel.setTasks([{ content: "Fix\n\x1b[31m bug 😀", status: "in_progress" }]);
    expect(strip(panel.render(50).join("\n"))).toContain("- Fix bug");
    expect(panel.render(50).join("\n")).not.toContain("😀");
    expect(taskItems([{ content: "x", status: "bogus" }])).toBeUndefined();
  });
});
