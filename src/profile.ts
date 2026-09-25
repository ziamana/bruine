import { createRequire } from "node:module";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { name: string; version: string };

export interface ProfilePaths {
  dir: string;
  packageJson: string;
  patchYml: string;
  cordisYml: string;
}

/** The profile layout as data; pathMod is injectable for win32 tests. */
export function profilePaths(
  dshHome: string,
  pathMod: typeof path = path,
): ProfilePaths {
  const dir = pathMod.join(dshHome, "profiles", "kumo");
  return {
    dir,
    packageJson: pathMod.join(dir, "package.json"),
    patchYml: pathMod.join(dir, "cordis.patch.yml"),
    cordisYml: pathMod.join(dir, "cordis.yml"),
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, path);
}

export async function ensureProfile(
  dshHome: string,
  pathMod: typeof path = path,
): Promise<{ created: boolean; dir: string }> {
  const p = profilePaths(dshHome, pathMod);
  const dir = p.dir;

  if (await exists(p.packageJson)) {
    return { created: false, dir };
  }

  await mkdir(dir, { recursive: true });

  const packageJson = {
    name: "dsh-profile-kumo",
    private: true,
    dependencies: {
      "kumo-cli": pkg.version,
    },
    dsh: {
      profile: {
        bundles: ["@deepseek-ai/dsh-base", pkg.name],
        patchReload: "startup",
      },
    },
  };

  await writeAtomic(p.packageJson, `${JSON.stringify(packageJson, null, 2)}\n`);
  await writeAtomic(
    p.patchYml,
    "# kumo user overrides. Edit this file, not cordis.yml.\n[]\n",
  );
  await writeAtomic(
    p.cordisYml,
    "# managed by dsh, do not edit\n[]\n",
  );

  return { created: true, dir };
}
