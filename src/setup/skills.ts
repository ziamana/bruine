/**
 * Shipped skills management (T21.6): chosen skills are copied into
 * `$DSH_HOME/skills/<name>/` (where dsh's user-dsh skill source reads them).
 * Removal only ever touches directories kumo itself installed, tracked in
 * `skills/.kumo-installed.json`.
 */
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export interface SkillMeta {
  name: string;
  description: string;
  dir: string;
}

export const SKILLS_MANIFEST = ".kumo-installed.json";

/** Parses the `name:` / `description:` keys of a SKILL.md frontmatter block. */
export function parseSkillFrontmatter(md: string): { name?: string; description?: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  if (m === null || m[1] === undefined) return {};
  const out: { name?: string; description?: string } = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (kv === null || kv[1] === undefined || kv[2] === undefined) continue;
    if (kv[1] === "name") out.name = kv[2].replaceAll(/^["']|["']$/g, "");
    if (kv[1] === "description") out.description = kv[2].replaceAll(/^["']|["']$/g, "");
  }
  return out;
}

/** The skills shipped inside the kumo package (dirs with a SKILL.md). */
export async function readBundledSkills(bundledRoot: string): Promise<SkillMeta[]> {
  const out: SkillMeta[] = [];
  if (!existsSync(bundledRoot)) return out;
  for (const entry of await readdir(bundledRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(bundledRoot, entry.name);
    const skillPath = join(dir, "SKILL.md");
    if (!existsSync(skillPath)) continue;
    const fm = parseSkillFrontmatter(await readFile(skillPath, "utf8"));
    out.push({
      name: fm.name ?? entry.name,
      description: fm.description ?? "",
      dir,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function readManifest(path: string): Promise<Record<string, string[]>> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, string[]>;
  } catch {
    return {};
  }
}

/**
 * Install `chosen` and remove previously-installed skills that are no longer
 * chosen — never touching skill directories kumo did not install.
 */
export async function syncSkills(opts: {
  homeSkillsDir: string;
  bundledRoot: string;
  chosen: string[];
}): Promise<{ installed: string[]; removed: string[] }> {
  const manifestPath = join(opts.homeSkillsDir, SKILLS_MANIFEST);
  const manifest = await readManifest(manifestPath);
  const removed: string[] = [];
  for (const name of Object.keys(manifest)) {
    if (opts.chosen.includes(name)) continue;
    for (const file of manifest[name] ?? []) {
      await rm(join(opts.homeSkillsDir, name, file), { force: true });
    }
    await rm(join(opts.homeSkillsDir, name), { recursive: true, force: true });
    delete manifest[name];
    removed.push(name);
  }
  const installed: string[] = [];
  const bundled = await readBundledSkills(opts.bundledRoot);
  for (const skill of bundled) {
    if (!opts.chosen.includes(skill.name)) continue;
    const dest = join(opts.homeSkillsDir, skill.name);
    await mkdir(dest, { recursive: true });
    const files: string[] = [];
    for (const entry of await readdir(skill.dir, { withFileTypes: true })) {
      await cp(join(skill.dir, entry.name), join(dest, entry.name), {
        recursive: true,
        force: true,
      });
      files.push(entry.name);
    }
    manifest[skill.name] = files;
    installed.push(skill.name);
  }
  await mkdir(dirname(manifestPath), { recursive: true });
  const tmp = `${manifestPath}.tmp`;
  await writeFile(tmp, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(manifestPath, await readFile(tmp, "utf8"), "utf8");
  await rm(tmp, { force: true });
  return { installed, removed };
}
