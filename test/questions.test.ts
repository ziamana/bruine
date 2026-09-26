import { describe, expect, test } from "vitest";
import stringWidth from "string-width";
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

  test("typing a letter is an answer, with no Other… detour", () => {
    const f = new QuestionForm([
      { id: "q1", question: "Which?", options: [{ label: "A" }, { label: "B" }] },
    ]);
    let out: any;
    f.onDone = (a) => (out = a);
    // The cursor is still on the first option: type, and it becomes the answer.
    f.handleInput("u");
    f.handleInput("t");
    f.handleInput("ilise");
    f.handleInput(" ");
    f.handleInput("postgres");
    expect(f.render(60).join("\n")).toContain("utilise postgres");
    f.handleInput("\r");
    expect(out).toEqual([{ id: "q1", selected: [], custom: "utilise postgres" }]);
  });

  test("the hint says typing is allowed, because it now is", () => {
    const f = new QuestionForm([{ id: "q1", question: "Which?", options: [{ label: "A" }] }]);
    expect(f.render(80).join("\n")).toContain("type to answer freely");
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

  test("a long question never leaves half an escape sequence behind", () => {
    const f = new QuestionForm([
      {
        id: "q1",
        header: "Choix de la base de donnees pour le cache local",
        question: "Quelle base de donnees dois-je utiliser pour le cache, et faut-il migrer les donnees existantes ?",
        options: [
          { label: "SQLite", description: "le plus simple, aucun service a lancer" },
          { label: "Redis", description: "rapide mais demande un serveur" },
        ],
      },
    ]);
    for (const width of [80, 60, 40, 34, 30, 20, 12, 5]) {
      for (const line of f.render(width)) {
        // A cut escape sequence is what made the form unreadable: the terminal
        // kept the colour open and smeared it over the lines below. Every line
        // must end on a closed style, and must fit the width it was given.
        // Nothing half-open at the end, every escape well formed, and the
        // visible width never exceeds what the caller allowed.
        expect(line).not.toMatch(/\x1b\[[0-9;]*$/);
        expect(line.replace(/\x1b\[[0-9;]*m/g, "")).not.toContain("\x1b");
        expect(stringWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  test("the form still shows its choices when the terminal is narrow", () => {
    const f = new QuestionForm([
      { id: "q1", question: "Quelle base ?", options: [{ label: "SQLite" }, { label: "Redis" }] },
    ]);
    const text = f.render(20).join("\n");
    expect(text).toContain("SQL");
    expect(text).toContain("...");
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
