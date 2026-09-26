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

  test("the option Enter will pick is visibly the selected one (T55)", async () => {
    const { bgCode, resetColorDepth } = await import("../src/ui/palette.js");
    const saved = process.env.KUMO_COLOR;
    process.env.KUMO_COLOR = "truecolor";
    resetColorDepth();
    try {
      const f = new QuestionForm([
        { id: "q1", question: "Which?", options: [{ label: "A" }, { label: "B" }] },
      ]);
      // The defect: a `›` and nothing else. The option you are about to confirm
      // looked exactly like the ones you are not.
      const first = f.render(60);
      const a = first.find((l) => l.includes("A"));
      const b = first.find((l) => l.includes("B"));
      expect(a).toContain(bgCode("surface", "truecolor"));
      expect(b).not.toContain(bgCode("surface", "truecolor"));
      // Moving the cursor moves the selection, not just a character.
      f.handleInput("\x1b[B");
      const moved = f.render(60);
      expect(moved.find((l) => l.includes("B"))).toContain(bgCode("surface", "truecolor"));
      expect(moved.find((l) => l.includes("A"))).not.toContain(bgCode("surface", "truecolor"));
    } finally {
      if (saved === undefined) delete process.env.KUMO_COLOR;
      else process.env.KUMO_COLOR = saved;
      resetColorDepth();
    }
  });

  test("the selection is never signalled by colour alone (T55)", async () => {
    const { resetColorDepth } = await import("../src/ui/palette.js");
    const saved = process.env.KUMO_COLOR;
    process.env.KUMO_COLOR = "basic";
    resetColorDepth();
    try {
      const f = new QuestionForm([
        { id: "q1", question: "Which?", options: [{ label: "AAA" }, { label: "BBB" }] },
      ]);
      const rows = f.render(60).map((l) => l.replace(/\x1b\[[0-9;]*m/g, ""));
      // A 16-color terminal paints no background, so the marker has to carry it.
      const selected = rows.find((l) => l.includes("AAA"))!;
      const other = rows.find((l) => l.includes("BBB"))!;
      expect(selected.trimStart().startsWith("›")).toBe(true);
      expect(other.trimStart().startsWith("›")).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.KUMO_COLOR;
      else process.env.KUMO_COLOR = saved;
      resetColorDepth();
    }
  });

  test("the hint only offers the keys that do something right now (T55)", () => {
    const single = new QuestionForm([
      { id: "q1", question: "Which?", options: [{ label: "A" }] },
    ]).render(100).join("\n");
    // Space does nothing in a single-select question, so advertising it was a lie.
    expect(single).not.toContain("Space toggle");
    expect(single).toContain("type to answer");
    const multi = new QuestionForm([
      { id: "q1", question: "Which?", multiSelect: true, options: [{ label: "A" }] },
    ]).render(100).join("\n");
    expect(multi).toContain("Space toggle");
  });

  test("a long question is wrapped, so its end is not the part that disappears (T55)", () => {
    const ask = "Which database should I use for the cache, and do I have to migrate the rows that are already there?";
    const f = new QuestionForm([{ id: "q1", question: ask, options: [{ label: "SQLite" }] }]);
    const text = f.render(60).map((l) => l.replace(/\x1b\[[0-9;]*m/g, "")).join(" ");
    // The truncation used to eat exactly the part that carries the ask.
    expect(text).toContain("already there?");
    // And every line still fits the width it was given.
    for (const line of f.render(60)) expect(stringWidth(line)).toBeLessThanOrEqual(60);
  });

  test("the question reads brighter than the chrome around it (T55)", async () => {
    const { NUAGE, contrastRatio, fgCode, resetColorDepth } = await import("../src/ui/palette.js");
    const saved = process.env.KUMO_COLOR;
    process.env.KUMO_COLOR = "truecolor";
    resetColorDepth();
    try {
      const f = new QuestionForm([
        { id: "q1", header: "Cache", question: "Which one?", options: [{ label: "A" }] },
      ]);
      const rows = f.render(60);
      const header = rows.find((l) => l.includes("Cache"))!;
      const question = rows.find((l) => l.includes("Which one?"))!;
      // The header was cyan and the question plain: the decoration was louder
      // than the thing being asked.
      expect(header).toContain(fgCode("faint", "truecolor"));
      expect(question).toContain(fgCode("text", "truecolor"));
      expect(contrastRatio(NUAGE.text.hex, NUAGE.surface.hex)).toBeGreaterThan(
        contrastRatio(NUAGE.faint.hex, NUAGE.surface.hex),
      );
    } finally {
      if (saved === undefined) delete process.env.KUMO_COLOR;
      else process.env.KUMO_COLOR = saved;
      resetColorDepth();
    }
  });

  test("multi-select uses kumo's own checkbox, and the icon set decides it (T55)", async () => {
    const { ASCII_ICONS, UNICODE_ICONS } = await import("../src/render/chars.js");
    const form = (icons: typeof UNICODE_ICONS): QuestionForm =>
      new QuestionForm(
        [{ id: "q1", question: "Pick", multiSelect: true, options: [{ label: "A" }, { label: "B" }] }],
        icons,
      );
    // The defect: hardcoded `[x]` / `[ ]` in a UI that speaks ✓ ✗ ▍ █ elsewhere.
    const uni = form(UNICODE_ICONS);
    expect(uni.render(60).join("\n")).toContain("○");
    uni.handleInput(" ");
    expect(uni.render(60).join("\n")).toContain("◉");
    // And an ASCII terminal gets its own marks, not the Unicode ones.
    const ascii = form(ASCII_ICONS);
    const row = ascii.render(60).join("\n");
    expect(row).not.toContain("○");
    expect(row).not.toContain("◉");
    expect(row).toMatch(/\[[ x]\]/);
  });

  test("the hint says typing is allowed, because it now is", () => {
    const f = new QuestionForm([{ id: "q1", question: "Which?", options: [{ label: "A" }] }]);
    expect(f.render(80).join("\n")).toContain("type to answer");
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
