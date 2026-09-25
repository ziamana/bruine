import { createRequire } from "node:module";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { name: string; version: string };

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
): Promise<{ created: boolean; dir: string }> {
  const dir = join(dshHome, "profiles", "kumo");
  const packageJsonPath = join(dir, "package.json");

  if (await exists(packageJsonPath)) {
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

  await writeAtomic(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
  await writeAtomic(
    join(dir, "cordis.patch.yml"),
    "# kumo user overrides. Edit this file, not cordis.yml.\n[]\n",
  );
  await writeAtomic(
    join(dir, "cordis.yml"),
    "# managed by dsh, do not edit\n[]\n",
  );

  return { created: true, dir };
}
