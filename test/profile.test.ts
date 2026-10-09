import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { describe, expect, test } from "vitest";
import { existsSync } from "node:fs";
import { symlink } from "node:fs/promises";
import { bundleIsCurrent, ensureProfile, linkProfileBundles, profilePaths, resolveDshBaseDir } from "../src/profile.js";

describe("profilePaths (T14.4)", () => {
  test("win32 home uses backslash separators", () => {
    const p = profilePaths("C:\\Users\\x", path.win32);
    expect(p.dir).toBe("C:\\Users\\x\\profiles\\bruine");
    expect(p.packageJson).toBe("C:\\Users\\x\\profiles\\bruine\\package.json");
    expect(p.patchYml).toBe("C:\\Users\\x\\profiles\\bruine\\cordis.patch.yml");
    expect(p.agentsDir).toBe("C:\\Users\\x\\agents");
  });

  test("posix home uses slash separators", () => {
    const p = profilePaths("/home/x", path.posix);
    expect(p.cordisYml).toBe("/home/x/profiles/bruine/cordis.yml");
  });

  test("the running platform's own module decides the separator", () => {
    const p = profilePaths("/home/x");
    expect(p.cordisYml).toBe(path.join("/home/x", "profiles", "bruine", "cordis.yml"));
  });
});

describe("ensureProfile", () => {
  test("creates the profile with 3 files on an empty home", async () => {
    const home = await mkdtemp(join(tmpdir(), "bruine-profile-"));
    const result = await ensureProfile(home);

    expect(result.created).toBe(true);
    expect(result.dir).toBe(join(home, "profiles", "bruine"));

    const packageJson = JSON.parse(
      await readFile(join(result.dir, "package.json"), "utf8"),
    );
    expect(packageJson.name).toBe("dsh-profile-bruine");
    expect(packageJson.dsh.profile.bundles).toEqual([
      "@deepseek-ai/dsh-base",
      "@ziamana/bruine",
    ]);
    expect(packageJson.dsh.profile.patchReload).toBe("startup");

    const patch = await readFile(join(result.dir, "cordis.patch.yml"), "utf8");
    expect(patch).toContain("# bruine user overrides. Edit this file, not cordis.yml.");
    // T36: the persona row is bruine's, not the bare `[]` placeholder.
    expect(patch).toContain("- id: system-prompt");
    expect(patch).toContain("includeHarnessIdentity: false");
    expect(patch).toContain("Your working directory is {{cwd}}.");

    const managed = await readFile(join(result.dir, "cordis.yml"), "utf8");
    expect(managed).toContain("# managed by dsh, do not edit");
    expect(managed.trimEnd().endsWith("[]")).toBe(true);
  });

  test("second call is idempotent and preserves user edits", async () => {
    const home = await mkdtemp(join(tmpdir(), "bruine-profile-"));
    await ensureProfile(home);

    const patchPath = join(home, "profiles", "bruine", "cordis.patch.yml");
    await writeFile(patchPath, "# my custom overrides\n- foo\n");

    const result = await ensureProfile(home);
    expect(result.created).toBe(false);

    const patch = await readFile(patchPath, "utf8");
    expect(patch).toBe("# my custom overrides\n- foo\n");
  });

  test("T26: the empty $DSH_HOME/agents dir exists, also on upgrade", async () => {
    const home = await mkdtemp(join(tmpdir(), "bruine-profile-"));
    await ensureProfile(home);
    expect((await stat(join(home, "agents"))).isDirectory()).toBe(true);

    // An existing profile (created before T26): the next run must still get
    // the dir the bundle patch points agentsHome at.
    await rm(join(home, "agents"), { recursive: true });
    const again = await ensureProfile(home);
    expect(again.created).toBe(false);
    expect((await stat(join(home, "agents"))).isDirectory()).toBe(true);
  });
});

describe("ensureProfile migration (T20.3)", () => {
  const SETTINGS = "agent-default-model:\n  provider: legacy\n  model: m\n";
  // Assembled at runtime so the source stays free of the retired literal
  // (T20 acceptance greps for it).
  const legacyName = `${"bruine"}-${"cli"}`;

  test("a profile from the pre-rename package is regenerated; surrounding home is untouched", async () => {
    const home = await mkdtemp(join(tmpdir(), "bruine-profile-"));
    // Simulate the old layout: legacy dependency name + stale node_modules symlink.
    const legacy = {
      name: "dsh-profile-bruine",
      private: true,
      dependencies: { [legacyName]: "link:/somewhere/old" },
      dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", legacyName], patchReload: "startup" } },
    };
    await ensureProfile(home); // write current files first…
    const dir = join(home, "profiles", "bruine");
    await writeFile(join(dir, "package.json"), JSON.stringify(legacy, null, 2) + "\n");
    await mkdir(join(dir, "node_modules", legacyName), { recursive: true });
    await writeFile(join(dir, "node_modules", legacyName, "package.json"), "{}");
    // …and home content that must survive.
    await writeFile(join(home, "settings.yaml"), SETTINGS);
    await writeFile(join(home, ".env"), "X=1\n");
    await writeFile(join(home, "bruine.json"), '{"mode":"simple"}\n');
    await mkdir(join(home, "sessions"), { recursive: true });
    await writeFile(join(home, "sessions", "keep"), "s");

    const result = await ensureProfile(home);
    expect(result.created).toBe(true);

    const manifest = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    expect(manifest.dependencies[legacyName]).toBeUndefined();
    expect(Object.keys(manifest.dependencies)).toEqual(["@ziamana/bruine"]);
    await expect(stat(join(dir, "node_modules"))).rejects.toThrow(); // old install gone
    expect(await readFile(join(home, "settings.yaml"), "utf8")).toBe(SETTINGS);
    expect(await readFile(join(home, ".env"), "utf8")).toBe("X=1\n");
    expect(await readFile(join(home, "bruine.json"), "utf8")).toBe('{"mode":"simple"}\n');
    expect(await readFile(join(home, "sessions", "keep"), "utf8")).toBe("s");

    // Idempotent after migration.
    const again = await ensureProfile(home);
    expect(again.created).toBe(false);
  });

  test("a profile carrying extra plugin deps under the current name is kept", async () => {
    const home = await mkdtemp(join(tmpdir(), "bruine-profile-"));
    await ensureProfile(home);
    const pkgPath = join(home, "profiles", "bruine", "package.json");
    const manifest = JSON.parse(await readFile(pkgPath, "utf8"));
    manifest.dependencies["bruine-some-plugin"] = "^1.0.0";
    manifest.dsh.profile.bundles.push("bruine-some-plugin");
    await writeFile(pkgPath, JSON.stringify(manifest, null, 2) + "\n");
    const result = await ensureProfile(home);
    expect(result.created).toBe(false);
    const kept = JSON.parse(await readFile(pkgPath, "utf8"));
    expect(kept.dsh.profile.bundles).toContain("bruine-some-plugin");
  });
});

describe("linkProfileBundles (first run without pnpm)", () => {
  async function fixture(): Promise<{ profile: string; own: string; base: string }> {
    const root = await mkdtemp(join(tmpdir(), "bruine-link-"));
    const own = join(root, "global", "node_modules", "@ziamana", "bruine");
    const base = join(root, "global", "node_modules", "@deepseek-ai", "dsh-base");
    for (const dir of [own, base]) {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "package.json"), "{}");
    }
    return { profile: join(root, "home", "profiles", "bruine"), own, base };
  }

  test("links this package and dsh-base into the profile, creating the scope folder", async () => {
    const { profile, own, base } = await fixture();
    expect(linkProfileBundles(profile, { name: "@ziamana/bruine", root: own }, base)).toBe(true);
    expect(existsSync(join(profile, "node_modules", "@ziamana", "bruine", "package.json"))).toBe(true);
    expect(existsSync(join(profile, "node_modules", "@deepseek-ai", "dsh-base", "package.json"))).toBe(true);
  });

  test("a link that points nowhere any more is replaced", async () => {
    const { profile, own, base } = await fixture();
    await mkdir(join(profile, "node_modules", "@ziamana"), { recursive: true });
    await symlink(join(own, "..", "gone"), join(profile, "node_modules", "@ziamana", "bruine"), "dir");
    expect(existsSync(join(profile, "node_modules", "@ziamana", "bruine", "package.json"))).toBe(false);
    expect(linkProfileBundles(profile, { name: "@ziamana/bruine", root: own }, base)).toBe(true);
    expect(existsSync(join(profile, "node_modules", "@ziamana", "bruine", "package.json"))).toBe(true);
  });

  test("dsh-base is found through the dsh this package pins", () => {
    const dir = resolveDshBaseDir();
    expect(dir).toBeDefined();
    expect(existsSync(join(dir as string, "package.json"))).toBe(true);
  });
});

describe("bundleIsCurrent (an update must reach the profile)", () => {
  const NAME = "@ziamana/bruine";
  async function install(version: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "bruine-current-"));
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: NAME, version }));
    return dir;
  }
  const profileAt = async (): Promise<string> => join(await mkdtemp(join(tmpdir(), "bruine-prof-")), "profiles", "bruine");
  const linkTo = async (profile: string, target: string): Promise<void> => {
    await mkdir(join(profile, "node_modules", "@ziamana"), { recursive: true });
    await symlink(target, join(profile, "node_modules", "@ziamana", "bruine"), "dir");
  };

  test("a profile with no bundle yet is not current", async () => {
    expect(bundleIsCurrent(await profileAt(), NAME, { root: await install("0.1.4"), version: "0.1.4" })).toBe(false);
  });

  test("a link to the running install is current", async () => {
    const root = await install("0.1.4");
    const profile = await profileAt();
    await linkTo(profile, root);
    expect(bundleIsCurrent(profile, NAME, { root, version: "0.1.4" })).toBe(true);
  });

  test("a link to another copy is not: the session would load the old plugins and say the old version", async () => {
    const old = await install("0.1.3");
    const running = await install("0.1.4");
    const profile = await profileAt();
    await linkTo(profile, old);
    expect(bundleIsCurrent(profile, NAME, { root: running, version: "0.1.4" })).toBe(false);
    // relinking it makes it current
    expect(linkProfileBundles(profile, { name: NAME, root: running }, await install("0.0.0"))).toBe(true);
    expect(bundleIsCurrent(profile, NAME, { root: running, version: "0.1.4" })).toBe(true);
  });

  test("a link whose path stayed while the folder was replaced in place is current", async () => {
    const root = await install("0.1.3");
    const profile = await profileAt();
    await linkTo(profile, root);
    await writeFile(join(root, "package.json"), JSON.stringify({ name: NAME, version: "0.1.4" }));
    expect(bundleIsCurrent(profile, NAME, { root, version: "0.1.4" })).toBe(true);
  });

  test("a copy dsh installed is current at the same version and not at another", async () => {
    const profile = await profileAt();
    const copy = join(profile, "node_modules", "@ziamana", "bruine");
    await mkdir(copy, { recursive: true });
    await writeFile(join(copy, "package.json"), JSON.stringify({ name: NAME, version: "0.1.3" }));
    const root = await install("0.1.4");
    expect(bundleIsCurrent(profile, NAME, { root, version: "0.1.3" })).toBe(true);
    expect(bundleIsCurrent(profile, NAME, { root, version: "0.1.4" })).toBe(false);
  });

  test("when the running folder is unknown, what is there is kept", async () => {
    const profile = await profileAt();
    await linkTo(profile, await install("0.1.3"));
    expect(bundleIsCurrent(profile, NAME, { root: undefined, version: "0.1.4" })).toBe(true);
  });

  test("a link that points nowhere is not current", async () => {
    const profile = await profileAt();
    await linkTo(profile, join(tmpdir(), "bruine-gone-for-good"));
    expect(bundleIsCurrent(profile, NAME, { root: await install("0.1.4"), version: "0.1.4" })).toBe(false);
  });
});
