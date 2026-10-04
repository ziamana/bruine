import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { defaultSkills, ensureDefaultSkills, NOT_BY_DEFAULT } from "../src/setup/default-skills.js";

async function skill(root: string, name: string): Promise<void> {
  await mkdir(join(root, name), { recursive: true });
  await writeFile(join(root, name, "SKILL.md"), `---\nname: ${name}\ndescription: the ${name} skill\n---\nbody\n`);
}

async function fixture(): Promise<{ dshHome: string; bundledRoot: string; home: string }> {
  const base = await mkdtemp(join(tmpdir(), "bruine-defaults-"));
  const bundledRoot = join(base, "shipped");
  for (const name of ["code-review", "impeccable", "remotion", "write-tests"]) await skill(bundledRoot, name);
  const dshHome = join(base, "dsh");
  await mkdir(dshHome, { recursive: true });
  return { dshHome, bundledRoot, home: join(base, "home") };
}

describe("default skills", () => {
  test("every shipped skill starts on except remotion", () => {
    expect(defaultSkills([{ name: "code-review" }, { name: "remotion" }, { name: "impeccable" }])).toEqual([
      "code-review",
      "impeccable",
    ]);
    expect(NOT_BY_DEFAULT).toContain("remotion");
  });

  test("a fresh home gets them installed and recorded in bruine.json", async () => {
    const { dshHome, bundledRoot, home } = await fixture();
    const { installed } = await ensureDefaultSkills({ dshHome, bundledRoot, home });
    expect(installed.sort()).toEqual(["code-review", "impeccable", "write-tests"]);
    expect((await readdir(join(dshHome, "skills"))).filter((n) => !n.startsWith("."))).toEqual(
      expect.arrayContaining(["code-review", "impeccable", "write-tests"]),
    );
    expect(existsSync(join(dshHome, "skills", "remotion"))).toBe(false);
    const doc = JSON.parse(await readFile(join(dshHome, "bruine.json"), "utf8")) as { skills: string[] };
    expect(doc.skills.sort()).toEqual(["code-review", "impeccable", "write-tests"]);
  });

  test("it keeps the other settings of bruine.json", async () => {
    const { dshHome, bundledRoot, home } = await fixture();
    await writeFile(join(dshHome, "bruine.json"), JSON.stringify({ mode: "simple", theme: "light" }));
    await ensureDefaultSkills({ dshHome, bundledRoot, home });
    const doc = JSON.parse(await readFile(join(dshHome, "bruine.json"), "utf8")) as Record<string, unknown>;
    expect(doc.mode).toBe("simple");
    expect(doc.theme).toBe("light");
  });

  test("someone who chose their skills, even none, is left alone", async () => {
    const { dshHome, bundledRoot, home } = await fixture();
    await writeFile(join(dshHome, "bruine.json"), JSON.stringify({ skills: [] }));
    expect(await ensureDefaultSkills({ dshHome, bundledRoot, home })).toEqual({ installed: [], kept: [] });
    expect(existsSync(join(dshHome, "skills", "code-review"))).toBe(false);
  });

  test("an existing manifest of installed skills is left alone", async () => {
    const { dshHome, bundledRoot, home } = await fixture();
    await mkdir(join(dshHome, "skills"), { recursive: true });
    await writeFile(join(dshHome, "skills", ".bruine-installed.json"), "{}");
    expect(await ensureDefaultSkills({ dshHome, bundledRoot, home })).toEqual({ installed: [], kept: [] });
    expect(existsSync(join(dshHome, "skills", "code-review"))).toBe(false);
  });

  test("the skills the user already has in .agents/skills come along", async () => {
    const { dshHome, bundledRoot, home } = await fixture();
    await skill(join(home, ".agents", "skills"), "my-own");
    const { installed, kept } = await ensureDefaultSkills({ dshHome, bundledRoot, home });
    expect(kept).toEqual(["my-own"]);
    expect(installed).toContain("my-own");
    expect(installed).toContain("code-review");
  });

  test("it runs once: the second call changes nothing", async () => {
    const { dshHome, bundledRoot, home } = await fixture();
    await ensureDefaultSkills({ dshHome, bundledRoot, home });
    expect(await ensureDefaultSkills({ dshHome, bundledRoot, home })).toEqual({ installed: [], kept: [] });
  });
});
