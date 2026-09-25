import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { describe, expect, test } from "vitest";
import { ensureProfile, profilePaths } from "../src/profile.js";

describe("profilePaths (T14.4)", () => {
  test("win32 home uses backslash separators", () => {
    const p = profilePaths("C:\\Users\\x", path.win32);
    expect(p.dir).toBe("C:\\Users\\x\\profiles\\kumo");
    expect(p.packageJson).toBe("C:\\Users\\x\\profiles\\kumo\\package.json");
    expect(p.patchYml).toBe("C:\\Users\\x\\profiles\\kumo\\cordis.patch.yml");
  });

  test("posix home uses slash separators", () => {
    const p = profilePaths("/home/x");
    expect(p.cordisYml).toBe("/home/x/profiles/kumo/cordis.yml");
  });
});

describe("ensureProfile", () => {
  test("creates the profile with 3 files on an empty home", async () => {
    const home = await mkdtemp(join(tmpdir(), "kumo-profile-"));
    const result = await ensureProfile(home);

    expect(result.created).toBe(true);
    expect(result.dir).toBe(join(home, "profiles", "kumo"));

    const packageJson = JSON.parse(
      await readFile(join(result.dir, "package.json"), "utf8"),
    );
    expect(packageJson.name).toBe("dsh-profile-kumo");
    expect(packageJson.dsh.profile.bundles).toEqual([
      "@deepseek-ai/dsh-base",
      "kumo-cli",
    ]);
    expect(packageJson.dsh.profile.patchReload).toBe("startup");

    const patch = await readFile(join(result.dir, "cordis.patch.yml"), "utf8");
    expect(patch).toContain("# kumo user overrides. Edit this file, not cordis.yml.");
    expect(patch.trimEnd().endsWith("[]")).toBe(true);

    const managed = await readFile(join(result.dir, "cordis.yml"), "utf8");
    expect(managed).toContain("# managed by dsh, do not edit");
    expect(managed.trimEnd().endsWith("[]")).toBe(true);
  });

  test("second call is idempotent and preserves user edits", async () => {
    const home = await mkdtemp(join(tmpdir(), "kumo-profile-"));
    await ensureProfile(home);

    const patchPath = join(home, "profiles", "kumo", "cordis.patch.yml");
    await writeFile(patchPath, "# my custom overrides\n- foo\n");

    const result = await ensureProfile(home);
    expect(result.created).toBe(false);

    const patch = await readFile(patchPath, "utf8");
    expect(patch).toBe("# my custom overrides\n- foo\n");
  });
});
