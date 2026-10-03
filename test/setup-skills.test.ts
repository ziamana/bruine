import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parseSkillFrontmatter, readBundledSkills, syncSkills } from "../src/setup/skills.js";
import { initialSkillChecks } from "../src/setup/full.js";

async function fakeBundled(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bruine-skills-"));
  for (const name of ["alpha", "beta"]) {
    await mkdir(join(root, name), { recursive: true });
    await writeFile(
      join(root, name, "SKILL.md"),
      `---\nname: ${name}\ndescription: the ${name} skill\n---\n\n# ${name}\nbody\n`,
    );
  }
  return root;
}

describe("parseSkillFrontmatter", () => {
  test("reads name/description, tolerates quotes", () => {
    const fm = parseSkillFrontmatter('---\nname: "a-b"\ndescription: it does, things\n---\ntext');
    expect(fm).toEqual({ name: "a-b", description: "it does, things" });
    expect(parseSkillFrontmatter("no frontmatter")).toEqual({});
  });
});

describe("readBundledSkills", () => {
  test("Remotion is available, unchecked by default, and installed only when selected", async () => {
    const root = join(__dirname, "..", "skills");
    const bundled = await readBundledSkills(root);
    const skill = bundled.find((entry) => entry.name === "remotion");
    expect(skill?.description).toContain("motion design");
    const items = [{ value: "remotion", label: "remotion" }, { value: "remotion-best-practices", label: "remotion-best-practices" }];
    const found = items.map((item) => ({ name: item.value, description: "", dir: "source", source: "agents", alsoIn: [] }));
    expect(initialSkillChecks(items, undefined, [])).toEqual(new Set());
    expect(initialSkillChecks(items, undefined, found)).toEqual(new Set());
    expect(initialSkillChecks(items, ["remotion"], found)).toEqual(new Set([0]));
    const home = await mkdtemp(join(tmpdir(), "bruine-remotion-test-"));
    const homeSkillsDir = join(home, "skills");
    await syncSkills({ bundledRoot: root, homeSkillsDir, chosen: [], home });
    expect(existsSync(join(homeSkillsDir, "remotion"))).toBe(false);
    await syncSkills({ bundledRoot: root, homeSkillsDir, chosen: ["remotion"], home });
    expect(await readFile(join(homeSkillsDir, "remotion", "SKILL.md"), "utf8")).toBe(await readFile(join(root, "remotion", "SKILL.md"), "utf8"));
  });
  test("lists only dirs with SKILL.md, sorted by name", async () => {
    const root = await fakeBundled();
    await mkdir(join(root, "not-a-skill"), { recursive: true });
    const skills = await readBundledSkills(root);
    expect(skills.map((s) => s.name)).toEqual(["alpha", "beta"]);
    expect(skills[0]?.description).toBe("the alpha skill");
  });

  test("missing root → empty", async () => {
    expect(await readBundledSkills(join(tmpdir(), "definitely-missing-bruine"))).toEqual([]);
  });
});

describe("syncSkills (T21.6)", () => {
  test("installs chosen; unchoosing removes only what bruine installed", async () => {
    const bundled = await fakeBundled();
    const home = await mkdtemp(join(tmpdir(), "bruine-home-"));
    const dir = join(home, "skills");
    // an empty user home: only the bundled roots exist here (T26 scan is a no-op)
    const userHome = join(home, "userhome");

    const r1 = await syncSkills({
      homeSkillsDir: dir,
      bundledRoot: bundled,
      chosen: ["alpha"],
      home: userHome,
    });
    expect(r1).toEqual({ installed: ["alpha"], removed: [], copied: [] });
    expect(existsSync(join(dir, "alpha", "SKILL.md"))).toBe(true);
    const manifest = JSON.parse(await readFile(join(dir, ".bruine-installed.json"), "utf8"));
    // T26: entries carry kind + source, not the T21 file list.
    expect(manifest).toEqual({
      alpha: { name: "alpha", kind: "shipped", source: join(bundled, "alpha") },
    });

    // a hand-made skill bruine must never remove
    await mkdir(join(dir, "mine"), { recursive: true });
    await writeFile(join(dir, "mine", "SKILL.md"), "mine\n");

    const r2 = await syncSkills({
      homeSkillsDir: dir,
      bundledRoot: bundled,
      chosen: ["alpha", "beta"],
      home: userHome,
    });
    // T26: an identical installed entry is left in place (protects user edits)
    expect(r2.installed).toEqual(["beta"]);
    expect(existsSync(join(dir, "beta", "SKILL.md"))).toBe(true);

    const r3 = await syncSkills({
      homeSkillsDir: dir,
      bundledRoot: bundled,
      chosen: ["beta"],
      home: userHome,
    });
    expect(r3).toEqual({ installed: [], removed: ["alpha"], copied: [] });
    expect(existsSync(join(dir, "alpha"))).toBe(false);
    expect(existsSync(join(dir, "beta", "SKILL.md"))).toBe(true);
    expect(existsSync(join(dir, "mine", "SKILL.md"))).toBe(true); // untouched
    const m3 = JSON.parse(await readFile(join(dir, ".bruine-installed.json"), "utf8"));
    expect(Object.keys(m3)).toEqual(["beta"]);
  });
});
