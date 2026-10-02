import { expect, test } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { QuestionForm } from "../src/ui/questions.js";
import { ASCII_ICONS } from "../src/render/chars.js";
const questions = [{ id: "database", header: "review", question: "Which database should store the local cache?", options: [{ label: "SQLite", description: "Local storage without a service." }, { label: "Redis", description: "Shared storage with a server." }] }];
test.each([100, 60, 30])("popup fits %i columns and displays the selected description", width => {
  const form = new QuestionForm(questions);
  const rows = form.render(width);
  expect(rows.join("\n")).toContain("review"); expect(rows.join("\n")).toContain("kumo v");
  expect(rows.join("\n").replace(/\x1b\[[0-9;]*m/g, "").replace(/\s+/g, " ")).toContain("Local storage without");
  for (const row of rows) expect(visibleWidth(row)).toBeLessThanOrEqual(width);
});
test("filtering keeps original option identity, backspace edits, Escape clears before cancelling", () => {
  const form = new QuestionForm(questions); let result: unknown; form.onDone = a => { result = a; };
  form.handleInput("Redis"); expect(form.render(100).join("\n")).not.toContain("SQLite");
  form.handleInput("\x7f"); expect(form.render(100).join("\n")).toContain("Redi");
  form.handleInput("\x1b"); expect(result).toBeUndefined(); expect(form.render(100).join("\n")).toContain("SQLite");
  form.handleInput("Redis"); form.handleInput("\r"); expect(result).toEqual([{ id: "database", selected: ["Redis"] }]);
});
test("no matches retains Other as the custom response", () => {
  const form = new QuestionForm(questions); let result: unknown; form.onDone = a => { result = a; };
  form.handleInput("missing"); expect(form.render(100).join("\n")).toContain("No matching options");
  form.handleInput("\r"); form.handleInput("Custom database"); form.handleInput("\r");
  expect(result).toEqual([{ id: "database", selected: [], custom: "Custom database" }]);
});
test("tabs preserve each question's filter and multi selection", () => {
  const form = new QuestionForm([{ ...questions[0]!, multiSelect: true }, { id: "logging", question: "Logging?", options: [{ label: "Quiet" }] }]);
  let result: unknown; form.onDone = a => { result = a; };
  form.handleInput("Redis"); form.handleInput(" "); form.handleInput("\t"); expect(form.index).toBe(1);
  form.handleInput("\x1b[Z"); expect(form.index).toBe(0); expect(form.render(100).join("\n")).toContain("Redis");
  form.handleInput("\r"); form.handleInput("\r"); expect(result).toEqual([{ id: "database", selected: ["Redis"] }, { id: "logging", selected: ["Quiet"] }]);
});
test("ASCII popup uses ASCII structure and marks", () => {
  const form = new QuestionForm(questions, ASCII_ICONS);
  expect(form.render(30).join("\n").replace(/\x1b\[[0-9;]*m/g, "")).not.toMatch(/[^\x00-\x7f]/);
});
test("the question footer displays the version supplied by its host", () => {
  expect(new QuestionForm(questions, ASCII_ICONS, "9.8.7").render(60).join("\n")).toContain("kumo v9.8.7");
});
