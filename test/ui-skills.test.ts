import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { availableSkillNames, isUiTask, stripReminders, uiSkillsHint, withUiSkillsHint } from "../src/plugins/ui-skills.js";

const BOTH = ["code-review", "impeccable", "make-interfaces-feel-better"];

describe("what counts as a web or interface task", () => {
  test.each([
    "cree moi un site complet de vente de bougie professionnel",
    "Crée un site web pour mon restaurant",
    "build a landing page for my SaaS",
    "fais une page d'accueil moderne",
    "make a dashboard with charts",
    "refais le CSS du header",
    "add a dark mode to the UI",
    "une boutique en ligne pour des vélos",
    "design a portfolio website",
    "Create an e-commerce store",
    "améliore l'interface utilisateur",
  ])("yes: %s", (prompt) => expect(isUiTask(prompt)).toBe(true));

  test.each([
    "fix the failing test in parser.ts",
    "add an interface for the config object",
    "explique ce que fait cette fonction",
    "oui",
    "rename the variable and run the tests",
    "git commit and push",
  ])("no: %s", (prompt) => expect(isUiTask(prompt)).toBe(false));
});

describe("the reminder", () => {
  test("names both skills, asks to load them before any code, and is conditional", () => {
    const hint = uiSkillsHint("cree moi un site de bougies", BOTH)!;
    expect(hint).toContain("`impeccable`");
    expect(hint).toContain("`make-interfaces-feel-better`");
    expect(hint).toContain("`skill` tool");
    expect(hint).toContain("before writing any code");
    expect(hint).toContain("inline SVG");
    expect(hint).toContain("desktop and at phone width");
    expect(hint).toMatch(/^If this task|If this task/m);
    expect(hint.startsWith("<system-reminder>")).toBe(true);
    expect(hint.endsWith("</system-reminder>")).toBe(true);
  });

  test("it names only the skills that are installed, and nothing when neither is", () => {
    expect(uiSkillsHint("a landing page", ["impeccable"])).toMatch(/`impeccable`(?! and)/);
    expect(uiSkillsHint("a landing page", ["impeccable"])).not.toContain("make-interfaces-feel-better");
    expect(uiSkillsHint("a landing page", ["code-review"])).toBeUndefined();
    expect(uiSkillsHint("a landing page", [])).toBeUndefined();
  });

  test("an ordinary prompt gets nothing", () => {
    expect(uiSkillsHint("fix the bug in the parser", BOTH)).toBeUndefined();
  });

  test("the prompt's own parts are kept first and untouched, the reminder comes after", () => {
    const parts = [{ type: "text" as const, text: "un site web" }];
    const out = withUiSkillsHint("un site web", parts, BOTH);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(parts[0]);
    expect((out[1] as { text: string }).text).toContain("impeccable");
    expect(withUiSkillsHint("fix tests", parts, BOTH)).toBe(parts);
  });

  test("a transcript shows the prompt without the reminder", () => {
    const text = `un site web\n${uiSkillsHint("un site web", BOTH)!}`;
    expect(stripReminders(text)).toBe("un site web");
    expect(stripReminders("rien à retirer")).toBe("rien à retirer");
  });
});

describe("the skills the session can load", () => {
  test("they are read from the skills folder, and a missing folder gives none", async () => {
    const home = await mkdtemp(join(tmpdir(), "bruine-uiskills-"));
    for (const name of ["impeccable", "other"]) {
      await mkdir(join(home, name), { recursive: true });
      await writeFile(join(home, name, "SKILL.md"), `---\nname: ${name}\ndescription: d ${name}\n---\nbody\n`);
    }
    const cwd = await mkdtemp(join(tmpdir(), "bruine-uiskills-cwd-"));
    expect((await availableSkillNames(home, cwd)).sort()).toEqual(["impeccable", "other"]);
    expect(await availableSkillNames(join(home, "nope"), cwd)).toEqual([]);
  });
});
