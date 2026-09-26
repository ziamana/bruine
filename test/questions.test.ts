import { describe, expect, test } from "vitest";
import { QuestionForm, echoLine } from "../src/ui/questions.js";

describe("QuestionForm (T28A)", () => {
  test("single question Down+Enter picks second option", () => {
    const f = new QuestionForm([
      { id: "q1", question: "Which?", options: [{ label: "A" }, { label: "B" }, { label: "C" }] },
    ]);
    let out: unknown;
    f.onDone = (a) => (out = a);
    f.handleInput("\x1b[B");
    f.handleInput("\r");
    expect(out).toEqual([{ id: "q1", selected: ["B"] }]);
  });

  test("multi-select Space toggles, Enter validates", () => {
    const f = new QuestionForm([
      { id: "q1", question: "Pick", multiSelect: true, options: [{ label: "A" }, { label: "B" }] },
    ]);
    let out: any;
    f.onDone = (a) => (out = a);
    f.handleInput(" ");
    f.handleInput("\x1b[B");
    f.handleInput(" ");
    f.handleInput("\r");
    expect(out).toEqual([{ id: "q1", selected: ["A", "B"] }]);
  });

  test("Other… free text becomes custom", () => {
    const f = new QuestionForm([{ id: "q1", question: "Which?", options: [{ label: "A" }] }]);
    let out: any;
    f.onDone = (a) => (out = a);
    f.handleInput("\x1b[B");
    f.handleInput("\r");
    f.handleInput("Custom db");
    f.handleInput("\r");
    expect(out).toEqual([{ id: "q1", selected: [], custom: "Custom db" }]);
  });

  test("Esc resolves skipped, never hangs", () => {
    const f = new QuestionForm([
      { id: "q1", question: "Q1?", options: [{ label: "A" }] },
      { id: "q2", question: "Q2?", options: [{ label: "B" }] },
    ]);
    let out: any;
    f.onDone = (a) => (out = a);
    f.handleInput("\x1b");
    expect(out).toEqual([
      { id: "q1", selected: [], custom: "skipped by the user" },
      { id: "q2", selected: [], custom: "skipped by the user" },
    ]);
  });

  test("Left/Right moves between questions with 1/2 header", () => {
    const f = new QuestionForm([
      { id: "q1", header: "Choose mode", question: "Which db?", options: [{ label: "SQLite" }, { label: "Redis" }] },
      { id: "q2", question: "Second?", options: [{ label: "X" }, { label: "Y" }] },
    ]);
    expect(f.render(80).join("\n")).toContain("1/2");
    f.handleInput("\x1b[C");
    expect(f.index).toBe(1);
    expect(f.render(80).join("\n")).toContain("2/2");
    f.handleInput("\x1b[D");
    expect(f.index).toBe(0);
  });

  test("echoLine uses the full width with arrow", () => {
    expect(echoLine("Which database should I use for the cache?", "SQLite")).toBe(
      "? Which database should I use for the cache? → SQLite",
    );
  });

  test("suggestions toggle merges into kumo.json, default true", async () => {
    const { mkdtemp, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { setSuggestionsChoice } = await import("../src/setup/full.js");
    const home = await mkdtemp(join(tmpdir(), "kumo-sg-"));
    await setSuggestionsChoice(home, false);
    expect(JSON.parse(await readFile(join(home, "kumo.json"), "utf8"))).toMatchObject({ suggestions: false });
    await setSuggestionsChoice(home, true);
    expect(JSON.parse(await readFile(join(home, "kumo.json"), "utf8"))).toMatchObject({ suggestions: true });
  });
});
