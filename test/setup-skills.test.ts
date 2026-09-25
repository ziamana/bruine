import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parseSkillFrontmatter, readBundledSkills, syncSkills } from "../src/setup/skills.js";

async function fakeBundled(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kumo-skills-"));
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
  test("lists only dirs with SKILL.md, sorted by name", async () => {
    const root = await fakeBundled();
    await mkdir(join(root, "not-a-skill"), { recursive: true });
    const skills = await readBundledSkills(root);
    expect(skills.map((s) => s.name)).toEqual(["alpha", "beta"]);
    expect(skills[0]?.description).toBe("the alpha skill");
  });

  test("missing root → empty", async () => {
    expect(await readBundledSkills(join(tmpdir(), "definitely-missing-kumo"))).toEqual([]);
  });
});

describe("syncSkills (T21.6)", () => {
  test("installs chosen; unchoosing removes only what kumo installed", async () => {
    const bundled = await fakeBundled();
    const home = await mkdtemp(join(tmpdir(), "kumo-home-"));
    const dir = join(home, "skills");

    const r1 = await syncSkills({ homeSkillsDir: dir, bundledRoot: bundled, chosen: ["alpha"] });
    expect(r1).toEqual({ installed: ["alpha"], removed: [] });
    expect(existsSync(join(dir, "alpha", "SKILL.md"))).toBe(true);
    const manifest = JSON.parse(await readFile(join(dir, ".kumo-installed.json"), "utf8"));
    expect(manifest).toEqual({ alpha: ["SKILL.md"] });

    // a hand-made skill kumo must never remove
    await mkdir(join(dir, "mine"), { recursive: true });
    await writeFile(join(dir, "mine", "SKILL.md"), "mine\n");

    const r2 = await syncSkills({ homeSkillsDir: dir, bundledRoot: bundled, chosen: ["alpha", "beta"] });
    expect(r2.installed).toEqual(["alpha", "beta"]);
    expect(existsSync(join(dir, "beta", "SKILL.md"))).toBe(true);

    const r3 = await syncSkills({ homeSkillsDir: dir, bundledRoot: bundled, chosen: ["beta"] });
    expect(r3).toEqual({ installed: ["beta"], removed: ["alpha"] });
    expect(existsSync(join(dir, "alpha"))).toBe(false);
    expect(existsSync(join(dir, "beta", "SKILL.md"))).toBe(true);
    expect(existsSync(join(dir, "mine", "SKILL.md"))).toBe(true); // untouched
    const m3 = JSON.parse(await readFile(join(dir, ".kumo-installed.json"), "utf8"));
    expect(Object.keys(m3)).toEqual(["beta"]);
  });
});
