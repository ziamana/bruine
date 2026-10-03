/**
 * T26 — "kumo reuses the skills you already have": scanning foreign skill
 * dirs, link/copy install into $DSH_HOME/skills, the `.kumo-installed.json`
 * manifest, the wizard's pre-check migration, the T26b migration at launch,
 * and the `kumo skills` command.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { tmpdir } from "node:os";
import path, { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  migrateAgentsSkills,
  readAvailableSkills,
  readInstalledSkills,
  scanFoundSkills,
  scanProjectSkills,
  SKILLS_MANIFEST,
  syncSkills,
  type FoundSkill,
} from "../src/setup/skills.js";
import { RECOMMENDED_SKILLS, initialSkillChecks, savedSkillsList } from "../src/setup/full.js";
import type { CheckItem } from "../src/setup/widgets.js";
import { createAutocomplete } from "../src/ui/file-complete.js";
import { formatAvailableSkills, skillCommand } from "../src/plugins/repl.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

async function putSkill(dir: string, name: string, description: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\nSECRET BODY of ${name}: never show this.\n`,
  );
}

/** A fake user home with skills under several agents' directories. */
async function fakeUserHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "kumo-t26-home-"));
  await putSkill(join(home, ".agents", "skills", "alpha"), "alpha", "from agents");
  await putSkill(join(home, ".claude", "skills", "alpha"), "alpha", "from claude");
  await putSkill(join(home, ".pi", "agent", "skills", "alpha"), "alpha", "from pi");
  await putSkill(join(home, ".claude", "skills", "beta"), "beta", "from claude only");
  await putSkill(join(home, ".config", "opencode", "skills", "gamma"), "gamma", "from opencode");
  // Not skills: no SKILL.md / SKILL.md without a frontmatter name / hostile name.
  await mkdir(join(home, ".codex", "skills", "empty"), { recursive: true });
  await mkdir(join(home, ".codex", "skills", "noname"), { recursive: true });
  await writeFile(join(home, ".codex", "skills", "noname", "SKILL.md"), "---\ndescription: x\n---\n");
  await putSkill(join(home, ".codex", "skills", "evil"), "../escape", "bad name");
  return home;
}

function found(names: FoundSkill[], name: string): FoundSkill | undefined {
  return names.find((s) => s.name === name);
}

describe("scanFoundSkills (T26)", () => {
  test("same skill in .agents and .claude → ONE item, also in: claude", async () => {
    const home = await fakeUserHome();
    const foundSkills = await scanFoundSkills(home);
    expect(foundSkills.map((s) => s.name)).toEqual(["alpha", "beta", "gamma"]);
    const alpha = found(foundSkills, "alpha");
    expect(alpha).toBeDefined();
    expect(alpha?.source).toBe("agents"); // first in SKILL_SOURCES order wins
    expect(alpha?.alsoIn).toEqual(["claude", "pi"]);
    expect(alpha?.description).toBe("from agents"); // only frontmatter meta, never the body
    expect(alpha?.dir).toBe(join(home, ".agents", "skills", "alpha"));
    expect(found(foundSkills, "beta")).toMatchObject({ source: "claude", alsoIn: [] });
  });

  test("folders without a SKILL.md `name` do not count; unsafe names are dropped", async () => {
    const home = await fakeUserHome();
    const names = (await scanFoundSkills(home)).map((s) => s.name);
    expect(names).not.toContain("empty");
    expect(names).not.toContain("noname");
    expect(names).not.toContain("..");
    expect(names.some((n) => n.includes("/"))).toBe(false);
  });

  test("missing home and win32 pathMod: no crash, empty", async () => {
    expect(await scanFoundSkills(join(tmpdir(), "definitely-missing-kumo-t26"))).toEqual([]);
    expect(await scanFoundSkills("C:\\Users\\x", path.win32)).toEqual([]);
  });

  test("a skill folder symlinked into an agent root counts (common install shape)", async () => {
    const base = await mkdtemp(join(tmpdir(), "kumo-t26-sym-"));
    const real = join(base, "elsewhere", "delta");
    await putSkill(real, "delta", "via symlink");
    const home = join(base, "home");
    await mkdir(join(home, ".claude", "skills"), { recursive: true });
    await symlink(real, join(home, ".claude", "skills", "delta"), process.platform === "win32" ? "junction" : "dir");
    const found = await scanFoundSkills(home);
    expect(found.map((s) => s.name)).toEqual(["delta"]);
    expect(found[0]?.source).toBe("claude");
  });

  test("scanProjectSkills reads .agents/skills and .dsh/skills of the cwd", async () => {
    const proj = await mkdtemp(join(tmpdir(), "kumo-t26-proj-"));
    await putSkill(join(proj, ".agents", "skills", "one"), "one", "project one");
    await putSkill(join(proj, ".dsh", "skills", "two"), "two", "project two");
    expect((await scanProjectSkills(proj)).map((s) => s.name)).toEqual(["one", "two"]);
    expect(await scanProjectSkills(join(tmpdir(), "definitely-missing-kumo-t26-p"))).toEqual([]);
  });
});

test("/skills lists usable home and project skills and completes their names", async () => {
  const root = await mkdtemp(join(tmpdir(), "kumo-skills-menu-"));
  const homeSkills = join(root, "home", "skills");
  const project = join(root, "project");
  await putSkill(join(homeSkills, "apex"), "apex", "Adaptive work");
  await putSkill(join(homeSkills, "browser"), "browser", "Browser control");
  await putSkill(join(project, ".agents", "skills", "impeccable"), "impeccable", "Interface design");
  await putSkill(join(project, ".dsh", "skills", "apex"), "apex", "Project-specific work");

  const skills = await readAvailableSkills(homeSkills, project);
  expect(skills.map((skill) => skill.name)).toEqual(["apex", "browser", "impeccable"]);
  expect(skills[0]).toMatchObject({ description: "Project-specific work", scope: "project" });
  const listed = formatAvailableSkills(skills);
  expect(listed).toContain("apex");
  expect(listed).toContain("browser");
  expect(listed).toContain("impeccable");
  expect(listed).not.toContain("SECRET BODY");

  const provider = createAutocomplete([skillCommand(homeSkills, project)], project, null);
  const signal = new AbortController().signal;
  const all = await provider.getSuggestions(["/skills "], 0, 8, { signal });
  expect(all?.items.map((item) => item.value)).toEqual(["apex", "browser", "impeccable"]);
  const filtered = await provider.getSuggestions(["/skills imp"], 0, 11, { signal });
  expect(filtered?.items.map((item) => item.value)).toEqual(["impeccable"]);
  const applied = provider.applyCompletion(["/skills imp"], 0, 11, filtered!.items[0]!, filtered!.prefix);
  expect(applied.lines[0]).toBe("/skills impeccable");
  const forced = await provider.getSuggestions(["/skills "], 0, 8, { signal, force: true });
  expect(forced?.items.map((item) => item.value)).toEqual(["apex", "browser", "impeccable"]);
});

describe("syncSkills and the skills kumo ships", () => {
  test("a skill the user linked keeps its link when kumo ships the same name", async () => {
    const home = await fakeUserHome();
    const skillsDir = join(home, ".kumo", "skills");
    const bundled = join(home, "bundle");
    await putSkill(join(bundled, "beta"), "beta", "shipped copy");
    await syncSkills({ homeSkillsDir: skillsDir, bundledRoot: join(home, "no-bundle"), chosen: ["beta"], home });
    const r = await syncSkills({ homeSkillsDir: skillsDir, bundledRoot: bundled, chosen: ["beta"], home });
    expect(r.installed).toEqual([]);
    expect((await lstat(join(skillsDir, "beta"))).isSymbolicLink()).toBe(true);
    expect((await readInstalledSkills(skillsDir))[0]?.kind).toBe("linked");
  });

  test("with no link of the user's, the shipped copy is installed", async () => {
    const home = await fakeUserHome();
    const skillsDir = join(home, ".kumo", "skills");
    const bundled = join(home, "bundle");
    await putSkill(join(bundled, "beta"), "beta", "shipped copy");
    const r = await syncSkills({ homeSkillsDir: skillsDir, bundledRoot: bundled, chosen: ["beta"], home });
    expect(r.installed).toEqual(["beta"]);
    expect((await readInstalledSkills(skillsDir))[0]?.kind).toBe("shipped");
    expect(await readFile(join(skillsDir, "beta", "SKILL.md"), "utf8")).toContain("shipped copy");
  });
});

describe("syncSkills links foreign skills (T26)", () => {
  test("accepted: source edits are visible through $DSH_HOME/skills/<name>/SKILL.md", async () => {
    const home = await fakeUserHome();
    const skillsDir = join(home, ".kumo", "skills");
    const r = await syncSkills({
      homeSkillsDir: skillsDir,
      bundledRoot: join(home, "no-bundle"),
      chosen: ["beta"],
      home,
    });
    expect(r).toEqual({ installed: ["beta"], removed: [], copied: [] });
    const st = await lstat(join(skillsDir, "beta"));
    expect(st.isSymbolicLink()).toBe(true);
    expect(await readInstalledSkills(skillsDir)).toEqual([
      {
        name: "beta",
        kind: "linked",
        source: join(home, ".claude", "skills", "beta"),
      },
    ]);
    // edit the skill where it lives (Claude Code): kumo sees the change…
    const src = join(home, ".claude", "skills", "beta", "SKILL.md");
    await writeFile(src, "---\nname: beta\ndescription: edited\n---\nNEW BODY\n");
    expect(await readFile(join(skillsDir, "beta", "SKILL.md"), "utf8")).toContain("NEW BODY");
  });

  test("accepted: unchecking a linked skill removes ONLY the link; source untouched", async () => {
    const home = await fakeUserHome();
    const skillsDir = join(home, ".kumo", "skills");
    const src = join(home, ".claude", "skills", "beta");
    await syncSkills({ homeSkillsDir: skillsDir, bundledRoot: join(home, "no-bundle"), chosen: ["beta"], home });
    const r = await syncSkills({ homeSkillsDir: skillsDir, bundledRoot: join(home, "no-bundle"), chosen: [], home });
    expect(r.removed).toEqual(["beta"]);
    expect(existsSync(join(skillsDir, "beta"))).toBe(false);
    expect(existsSync(join(src, "SKILL.md"))).toBe(true); // folder and file intact
  });

  test("a user folder in $DSH_HOME/skills not in the manifest survives", async () => {
    const home = await fakeUserHome();
    const skillsDir = join(home, ".kumo", "skills");
    await putSkill(join(skillsDir, "mine"), "mine", "hand-made");
    await syncSkills({ homeSkillsDir: skillsDir, bundledRoot: join(home, "no-bundle"), chosen: ["beta"], home });
    const r = await syncSkills({ homeSkillsDir: skillsDir, bundledRoot: join(home, "no-bundle"), chosen: [], home });
    expect(r.removed).toEqual(["beta"]);
    expect(existsSync(join(skillsDir, "mine", "SKILL.md"))).toBe(true);
  });

  test("shipped beats found for the same name: the copy is installed", async () => {
    const bundled = await mkdtemp(join(tmpdir(), "kumo-t26-bundle-"));
    await putSkill(join(bundled, "alpha"), "alpha", "kumo shipped");
    const home = await fakeUserHome();
    const skillsDir = join(home, ".kumo", "skills");
    await syncSkills({ homeSkillsDir: skillsDir, bundledRoot: bundled, chosen: ["alpha"], home });
    const [entry] = await readInstalledSkills(skillsDir);
    expect(entry).toMatchObject({ kind: "shipped", source: join(bundled, "alpha") });
    expect((await lstat(join(skillsDir, "alpha"))).isDirectory()).toBe(true);
    expect((await lstat(join(skillsDir, "alpha"))).isSymbolicLink()).toBe(false);
  });

  test("linking failure falls back to a copy and says so", async () => {
    const home = await fakeUserHome();
    const skillsDir = join(home, ".kumo", "skills");
    const r = await syncSkills({
      homeSkillsDir: skillsDir,
      bundledRoot: join(home, "no-bundle"),
      chosen: ["beta"],
      home,
      link: async () => {
        throw Object.assign(new Error("EPERM"), { code: "EPERM" });
      },
    });
    expect(r).toEqual({ installed: ["beta"], removed: [], copied: ["beta"] });
    expect(existsSync(join(skillsDir, "beta", "SKILL.md"))).toBe(true); // a real copy
    expect(await readInstalledSkills(skillsDir)).toEqual([
      { name: "beta", kind: "linked", source: join(home, ".claude", "skills", "beta"), copied: true },
    ]);
    // unchecking removes the copy only, never the source folder
    await syncSkills({
      homeSkillsDir: skillsDir,
      bundledRoot: join(home, "no-bundle"),
      chosen: [],
      home,
      link: async () => {
        throw new Error("still no links here");
      },
    });
    expect(existsSync(join(skillsDir, "beta"))).toBe(false);
    expect(existsSync(join(home, ".claude", "skills", "beta", "SKILL.md"))).toBe(true);
  });

  test("re-saving the same choice keeps the installed copy — and the user's edits to it", async () => {
    const bundled = await mkdtemp(join(tmpdir(), "kumo-t26-bundle2-"));
    await putSkill(join(bundled, "alpha"), "alpha", "kumo shipped");
    const home = await fakeUserHome();
    const skillsDir = join(home, ".kumo", "skills");
    await syncSkills({ homeSkillsDir: skillsDir, bundledRoot: bundled, chosen: ["alpha"], home });
    await writeFile(join(skillsDir, "alpha", "SKILL.md"), "user tweaked the installed copy");
    const r = await syncSkills({ homeSkillsDir: skillsDir, bundledRoot: bundled, chosen: ["alpha"], home });
    expect(r).toEqual({ installed: [], removed: [], copied: [] });
    expect(await readFile(join(skillsDir, "alpha", "SKILL.md"), "utf8")).toBe(
      "user tweaked the installed copy",
    );
  });

  test("pre-T26 manifest rows (file lists) still remove their directories", async () => {
    const home = await fakeUserHome();
    const skillsDir = join(home, ".kumo", "skills");
    await mkdir(join(skillsDir, "legacy"), { recursive: true });
    await writeFile(join(skillsDir, "legacy", "SKILL.md"), "old\n");
    await writeFile(
      join(skillsDir, SKILLS_MANIFEST),
      JSON.stringify({ legacy: ["SKILL.md"] }),
      "utf8",
    );
    const r = await syncSkills({
      homeSkillsDir: skillsDir,
      bundledRoot: join(home, "no-bundle"),
      chosen: [],
      home,
    });
    expect(r.removed).toEqual(["legacy"]);
    expect(existsSync(join(skillsDir, "legacy"))).toBe(false);
  });
});

describe("wizard skills-step defaults (T26)", () => {
  test("savedSkillsList: kumo.json's list, or undefined when never saved", async () => {
    const home = await mkdtemp(join(tmpdir(), "kumo-t26-pref-"));
    expect(savedSkillsList(home)).toBeUndefined();
    await writeFile(join(home, "kumo.json"), JSON.stringify({ mode: "full", skills: ["a", "b"] }));
    expect(savedSkillsList(home)).toEqual(["a", "b"]);
    await writeFile(join(home, "kumo.json"), JSON.stringify({ mode: "simple" }));
    expect(savedSkillsList(home)).toBeUndefined();
  });

  test("first run of this version: everything found in ~/.agents is pre-checked", () => {
    const items: CheckItem[] = [
      { value: "#h1", label: "Shipped with kumo", disabled: true },
      { value: "shipped-one", label: "shipped-one" },
      { value: "#h2", label: "Found on this computer", disabled: true },
      { value: "alpha", label: "alpha" },
      { value: "beta", label: "beta" },
    ];
    const foundSkills = [
      { name: "alpha", description: "", dir: "/h/.agents/skills/alpha", source: "agents", alsoIn: [] },
      { name: "beta", description: "", dir: "/h/.claude/skills/beta", source: "claude", alsoIn: [] },
    ];
    expect(initialSkillChecks(items, undefined, foundSkills)).toEqual(new Set([3]));
  });

  test("first run: the recommended skills are pre-checked wherever they were found", () => {
    expect([...RECOMMENDED_SKILLS].sort()).toEqual([
      "browser",
      "impeccable",
      "make-interfaces-feel-better",
      "playwright-cli",
      "thermo-nuclear-code-quality-review",
      "youtube-transcript",
    ]);
    const items: CheckItem[] = [
      { value: "#h", label: "Found on this computer", disabled: true },
      { value: "impeccable", label: "impeccable" },
      { value: "youtube-transcript", label: "youtube-transcript" },
      { value: "other", label: "other" },
    ];
    const foundSkills: FoundSkill[] = [
      { name: "impeccable", description: "", dir: "/h/.pi/agent/skills/impeccable", source: "pi", alsoIn: [] },
      { name: "youtube-transcript", description: "", dir: "/h/.claude/skills/youtube-transcript", source: "claude", alsoIn: [] },
      { name: "other", description: "", dir: "/h/.claude/skills/other", source: "claude", alsoIn: [] },
    ];
    expect(initialSkillChecks(items, undefined, foundSkills)).toEqual(new Set([1, 2]));
    // A list the user already saved is theirs: the recommendation never overrides it.
    expect(initialSkillChecks(items, ["other"], foundSkills)).toEqual(new Set([3]));
  });

  test("first run: a recommended skill kumo ships is pre-checked too, and an ordinary shipped one is not", () => {
    const items: CheckItem[] = [
      { value: "#h", label: "Shipped with kumo", disabled: true },
      { value: "code-review", label: "code-review" },
      { value: "impeccable", label: "impeccable" },
      { value: "playwright-cli", label: "playwright-cli" },
    ];
    expect(initialSkillChecks(items, undefined, [])).toEqual(new Set([2, 3]));
  });

  test("a saved list pre-checks exactly that; headers never check", () => {
    const items: CheckItem[] = [
      { value: "#h1", label: "Shipped with kumo", disabled: true },
      { value: "alpha", label: "alpha" },
      { value: "beta", label: "beta" },
    ];
    const foundSkills: FoundSkill[] = [
      { name: "beta", description: "", dir: "/h/.agents/skills/beta", source: "agents", alsoIn: [] },
    ];
    expect(initialSkillChecks(items, ["#h1", "alpha"], foundSkills)).toEqual(new Set([1]));
  });
});

describe("migrateAgentsSkills (T26b)", () => {
  async function launchHomes(): Promise<{ userHome: string; skillsDir: string }> {
    const base = await mkdtemp(join(tmpdir(), "kumo-t26b-"));
    const userHome = join(base, "user");
    for (const name of ["one", "two", "three"]) {
      await putSkill(join(userHome, ".agents", "skills", name), name, `the ${name} skill`);
    }
    await putSkill(join(userHome, ".claude", "skills", "four"), "four", "claude only"); // not .agents
    await mkdir(join(userHome, ".agents", "skills", "noname"), { recursive: true }); // not a skill
    await writeFile(join(userHome, ".agents", "skills", "noname", "SKILL.md"), "---\ndescription: x\n---\n");
    return { userHome, skillsDir: join(base, "kumo", "skills") };
  }

  test("accepted: no manifest + 3 valid .agents skills → 3 links + manifest", async () => {
    const { userHome, skillsDir } = await launchHomes();
    const r = await migrateAgentsSkills({ homeSkillsDir: skillsDir, home: userHome });
    expect(r.linked.slice().sort()).toEqual(["one", "three", "two"]);
    expect(r.copied).toEqual([]);
    const entries = await readInstalledSkills(skillsDir);
    expect(entries.map((e) => e.name)).toEqual(["one", "three", "two"]);
    for (const e of entries) {
      expect(e).toMatchObject({ kind: "linked", source: join(userHome, ".agents", "skills", e.name) });
      expect((await lstat(join(skillsDir, e.name))).isSymbolicLink()).toBe(true);
    }
    // only what the user had in .agents: the claude-only folder stays out.
    expect(existsSync(join(skillsDir, "four"))).toBe(false);
    // second launch: the manifest is the marker — nothing runs, nothing changes.
    const manifestBefore = await readFile(join(skillsDir, SKILLS_MANIFEST), "utf8");
    const again = await migrateAgentsSkills({ homeSkillsDir: skillsDir, home: userHome });
    expect(again).toEqual({ linked: [], copied: [] });
    expect(await readFile(join(skillsDir, SKILLS_MANIFEST), "utf8")).toBe(manifestBefore);
  });

  test("manifest already present (even empty = user choice) → nothing linked", async () => {
    const { userHome, skillsDir } = await launchHomes();
    await mkdir(skillsDir, { recursive: true });
    await writeFile(join(skillsDir, SKILLS_MANIFEST), "{}\n");
    const r = await migrateAgentsSkills({ homeSkillsDir: skillsDir, home: userHome });
    expect(r).toEqual({ linked: [], copied: [] });
    expect(existsSync(join(skillsDir, "one"))).toBe(false);
  });

  test("no .agents skills and no manifest → nothing invented, no marker", async () => {
    const base = await mkdtemp(join(tmpdir(), "kumo-t26b-none-"));
    const skillsDir = join(base, "kumo", "skills");
    const r = await migrateAgentsSkills({ homeSkillsDir: skillsDir, home: join(base, "empty-user") });
    expect(r).toEqual({ linked: [], copied: [] });
    expect(existsSync(join(skillsDir, SKILLS_MANIFEST))).toBe(false);
  });

  test("linking failure falls back to copies and says so", async () => {
    const { userHome, skillsDir } = await launchHomes();
    const r = await migrateAgentsSkills({
      homeSkillsDir: skillsDir,
      home: userHome,
      link: async () => {
        throw new Error("no symlinks on this mount");
      },
    });
    expect(r.linked.slice().sort()).toEqual(["one", "three", "two"]);
    expect(r.copied.slice().sort()).toEqual(["one", "three", "two"]);
    expect((await lstat(join(skillsDir, "one"))).isSymbolicLink()).toBe(false);
    expect(existsSync(join(skillsDir, "one", "SKILL.md"))).toBe(true);
    for (const e of await readInstalledSkills(skillsDir)) expect(e).toMatchObject({ copied: true });
  });
});

describe("kumo launch migration (T26b)", () => {
  // The user-home scan runs on os.homedir(); POSIX honours $HOME overrides.
  test.skipIf(process.platform === "win32")(
    "kumo without a manifest links the .agents skills and says so once",
    async () => {
      const { localServerSettings, renderSettingsYaml } = await import("../src/setup/simple.js");
      const base = await mkdtemp(join(tmpdir(), "kumo-t26b-launch-"));
      const userHome = join(base, "user");
      await putSkill(join(userHome, ".agents", "skills", "kept"), "kept", "keep me loaded");
      const kumoHome = join(base, "kumo");
      // Pre-bake settings so launch skips the first-run setup entirely.
      await mkdir(kumoHome, { recursive: true });
      const settings = localServerSettings(
        { baseUrl: "http://127.0.0.1:9/v1", models: ["nope"] },
        "nope",
      );
      await writeFile(join(kumoHome, "settings.yaml"), renderSettingsYaml(settings));
      await writeFile(join(kumoHome, "kumo.json"), JSON.stringify({ permissionMode: "full", search: { provider: "none" } }));

      const child = spawn(
        process.execPath,
        [join(repoRoot, "dist", "bin.js")],
        {
          cwd: base,
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, HOME: userHome, KUMO_HOME: kumoHome },
        },
      );
      let out = "";
      child.stdout?.on("data", (d) => { out += String(d); });
      child.stderr?.on("data", (d) => { out += String(d); });
      const manifest = join(kumoHome, "skills", SKILLS_MANIFEST);
      const t0 = Date.now();
      try {
        while (!existsSync(manifest)) {
          if (Date.now() - t0 > 90_000) throw new Error(`no migration manifest after 90s; output:\n${out}`);
          if (child.exitCode !== null && existsSync(manifest) === false && Date.now() - t0 > 5_000) {
            throw new Error(`kumo exited ${String(child.exitCode)} before migrating; output:\n${out}`);
          }
          await sleep(250);
        }
        // Give the announcement a tick to reach stdout (printed before dsh spawns).
        for (let i = 0; i < 20 && !out.includes("kept your 1 skill"); i++) await sleep(100);
        expect(out).toContain("Setting up kumo (one time)…");
        expect(out).toContain("Ready.");
        expect(out).not.toContain("Already up to date");
        expect(out).not.toContain("dependencies:");
        expect(out).toContain("kept your 1 skill from .agents/skills");
        const entries = await readInstalledSkills(join(kumoHome, "skills"));
        expect(entries).toEqual([
          { name: "kept", kind: "linked", source: join(userHome, ".agents", "skills", "kept") },
        ]);
        expect((await lstat(join(kumoHome, "skills", "kept"))).isSymbolicLink()).toBe(true);
      } finally {
        const pid = child.pid;
        try {
          if (pid !== undefined) process.kill(-pid, "SIGKILL"); // the whole group, dsh included
          else child.kill("SIGKILL");
        } catch {
          try { child.kill("SIGKILL"); } catch { /* already gone */ }
        }
      }
    },
    150_000,
  );
});

describe("kumo skills command (T26)", () => {
  function runSkillsCli(kumoHome: string): string {
    return execFileSync(process.execPath, [join(repoRoot, "dist", "bin.js"), "skills"], {
      encoding: "utf8",
      env: { ...process.env, KUMO_HOME: kumoHome },
    });
  }

  test("prints enabled skills with kind and source, never content", async () => {
    const bundled = await mkdtemp(join(tmpdir(), "kumo-t26-cli-"));
    await putSkill(join(bundled, "git-workflow"), "git-workflow", "ship it");
    const home = await fakeUserHome();
    const kumoHome = join(home, ".kumo");
    await syncSkills({
      homeSkillsDir: join(kumoHome, "skills"),
      bundledRoot: bundled,
      chosen: ["git-workflow", "beta"],
      home,
    });
    const out = runSkillsCli(kumoHome);
    expect(out).toContain(`git-workflow  shipped  ${join(bundled, "git-workflow")}`);
    expect(out).toContain(`beta  linked  ${join(home, ".claude", "skills", "beta")}`);
    expect(out).not.toContain("SECRET BODY");
  }, 30_000);

  test("nothing enabled → tells the user", async () => {
    const home = await mkdtemp(join(tmpdir(), "kumo-t26-cli-empty-"));
    expect(runSkillsCli(home)).toContain("No skills enabled");
  }, 30_000);
});

describe("skills written by other people, shipped with kumo", () => {
  const theirs = ["impeccable", "make-interfaces-feel-better", "playwright-cli", "thermo-nuclear-code-quality-review", "youtube-transcript"];

  test("each carries its own license file and is named in THIRD_PARTY_NOTICES.md", async () => {
    const notices = await readFile(join(repoRoot, "THIRD_PARTY_NOTICES.md"), "utf8");
    for (const name of theirs) {
      const license = await readFile(join(repoRoot, "skills", name, "LICENSE"), "utf8");
      expect(license, `${name}: LICENSE`).toMatch(/Apache License|MIT License/);
      expect(notices, `${name}: notice`).toContain(`\`${name}\``);
      expect(existsSync(join(repoRoot, "skills", name, "SKILL.md")), `${name}: SKILL.md`).toBe(true);
    }
  });

  test("impeccable keeps the notice its author ships", () => {
    expect(existsSync(join(repoRoot, "skills", "impeccable", "NOTICE.md"))).toBe(true);
  });

  test("the notices ship in the package", async () => {
    const pkg = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8")) as { files: string[] };
    expect(pkg.files).toContain("THIRD_PARTY_NOTICES.md");
    expect(pkg.files).toContain("skills");
  });
});
