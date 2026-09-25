/**
 * Skill installation (T21.6, T26): every skill the user enables lives in
 * `$DSH_HOME/skills/<name>/` (where dsh's user-dsh skill source reads them).
 *
 * - shipped skills: copied from the kumo package;
 * - skills found under another agent's folder (T26): a LINK, not a copy, so
 *   editing the skill there updates it in kumo (junction on Windows, dir
 *   elsewhere); if linking fails, a copy is installed and reported.
 *
 * kumo becomes the only source of truth for USER skills: the bundle patch
 * points skill-filesystem's agentsHome at `$DSH_HOME/agents` (a dir kumo
 * never fills), so the user home `.agents/skills` is no longer read implicitly.
 *
 * Everything kumo installs is tracked in `.kumo-installed.json`; nothing kumo
 * did not create is ever touched. Privacy: only `name` and `description` of a
 * foreign SKILL.md's frontmatter are read for display — never print, log or
 * send a skill body during setup.
 */
import { cp, lstat, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path, { dirname, join } from "node:path";

export interface SkillMeta {
  name: string;
  description: string;
  dir: string;
}

/** A skill folder found under another agent's directory (T26). */
export interface FoundSkill extends SkillMeta {
  /** Which agent owns the source folder: "agents", "claude", … */
  source: string;
  /** Other agent labels that carry a skill with the same name. */
  alsoIn: string[];
}

/** One manifest row: what kumo created in `$DSH_HOME/skills/<name>`. */
export interface InstalledSkillEntry {
  name: string;
  kind: "shipped" | "linked";
  /** Directory the copy/link points at (empty for pre-T26 rows). */
  source: string;
  /** Symlink was impossible (old manifest layout / exotic filesystem): a copy stands in. */
  copied?: boolean;
}

export type InstalledSkills = Record<string, InstalledSkillEntry>;

export const SKILLS_MANIFEST = ".kumo-installed.json";

/** Skill folders of the other agents on this computer, in precedence order. */
export const SKILL_SOURCES: ReadonlyArray<{ label: string; rel: string[] }> = [
  { label: "agents", rel: [".agents", "skills"] },
  { label: "claude", rel: [".claude", "skills"] },
  { label: "opencode", rel: [".config", "opencode", "skills"] },
  { label: "pi", rel: [".pi", "agent", "skills"] },
  { label: "codex", rel: [".codex", "skills"] },
];

/** A skill name must be a single safe path segment (a folder name). */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

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

/** One `SKILL.md` directory under `root`, as name/description metadata. */
async function readSkillDir(dir: string, fallbackName: string): Promise<SkillMeta | undefined> {
  const skillPath = join(dir, "SKILL.md");
  if (!existsSync(skillPath)) return undefined;
  const fm = parseSkillFrontmatter(await readFile(skillPath, "utf8"));
  const name = fm.name ?? fallbackName;
  if (!SAFE_NAME.test(name)) return undefined;
  return { name, description: fm.description ?? "", dir };
}

/** The skills shipped inside the kumo package (dirs with a SKILL.md). */
export async function readBundledSkills(bundledRoot: string): Promise<SkillMeta[]> {
  const out: SkillMeta[] = [];
  if (!existsSync(bundledRoot)) return out;
  for (const entry of await readdir(bundledRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skill = await readSkillDir(join(bundledRoot, entry.name), entry.name);
    if (skill !== undefined) out.push(skill);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Scan a skill root and list the skill folders in it: a folder counts only
 * if it has a `SKILL.md` with a `name`. Folders another agent *symlinked*
 * into the root count too — that is a common install shape.
 */
async function readSkillsUnder(root: string): Promise<SkillMeta[]> {
  const out: SkillMeta[] = [];
  if (!existsSync(root)) return out;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const skillPath = join(root, entry.name, "SKILL.md");
    if (!existsSync(skillPath)) continue;
    const fm = parseSkillFrontmatter(await readFile(skillPath, "utf8"));
    // T26: unlike bundled skills, a foreign folder without a frontmatter
    // `name` does not count as a skill.
    if (fm.name === undefined || !SAFE_NAME.test(fm.name)) continue;
    out.push({ name: fm.name, description: fm.description ?? "", dir: join(root, entry.name) });
  }
  return out;
}

/**
 * Scan the given homes for skill folders of the other agents (T26). The same
 * name in several places yields ONE item: source = first in SKILL_SOURCES
 * order, the others listed in `alsoIn`. Sorted by name.
 */
export async function scanFoundSkills(
  home: string,
  pathMod: typeof path = path,
): Promise<FoundSkill[]> {
  const byName = new Map<string, FoundSkill>();
  for (const src of SKILL_SOURCES) {
    const root = pathMod.join(home, ...src.rel);
    for (const skill of await readSkillsUnder(root)) {
      const existing = byName.get(skill.name);
      if (existing !== undefined) {
        if (!existing.alsoIn.includes(src.label) && existing.source !== src.label) {
          existing.alsoIn.push(src.label);
        }
        continue;
      }
      byName.set(skill.name, {
        name: skill.name,
        description: skill.description,
        dir: skill.dir,
        source: src.label,
        alsoIn: [],
      });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Project skill roots (always available, never managed by kumo, T26 group 3). */
export async function scanProjectSkills(
  cwd: string,
  pathMod: typeof path = path,
): Promise<SkillMeta[]> {
  const out: SkillMeta[] = [];
  const seen = new Set<string>();
  for (const rel of [
    [".agents", "skills"],
    [".dsh", "skills"],
  ]) {
    for (const skill of await readSkillsUnder(pathMod.join(cwd, ...rel))) {
      if (seen.has(skill.name)) continue;
      seen.add(skill.name);
      out.push(skill);
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function readManifest(manifestPath: string): Promise<InstalledSkills> {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
  const out: InstalledSkills = {};
  for (const [name, value] of Object.entries(raw ?? {})) {
    if (Array.isArray(value)) {
      // Pre-T26 shape: `{ name: [files] }` — a shipped copy.
      out[name] = { name, kind: "shipped", source: "" };
      continue;
    }
    if (value === null || typeof value !== "object") continue;
    const v = value as Partial<InstalledSkillEntry>;
    out[name] = {
      name,
      kind: v.kind === "linked" ? "linked" : "shipped",
      source: typeof v.source === "string" ? v.source : "",
      ...(v.copied === true ? { copied: true } : {}),
    };
  }
  return out;
}

/** What `kumo skills` prints; sorted by name. Missing manifest → empty. */
export async function readInstalledSkills(homeSkillsDir: string): Promise<InstalledSkillEntry[]> {
  const manifest = await readManifest(join(homeSkillsDir, SKILLS_MANIFEST));
  return Object.values(manifest).sort((a, b) => a.name.localeCompare(b.name));
}

/** Remove one kumo-created entry. A link is unlinked, never followed. */
async function removeEntry(homeSkillsDir: string, entry: InstalledSkillEntry): Promise<void> {
  const dest = join(homeSkillsDir, entry.name);
  if (entry.kind === "linked" && entry.copied !== true) {
    try {
      const st = await lstat(dest);
      if (st.isSymbolicLink()) {
        await rm(dest, { force: true });
        return;
      }
    } catch {
      // gone already
    }
  }
  await rm(dest, { recursive: true, force: true });
}

/** The link type for this platform (junction on Windows, dir elsewhere). */
function defaultLink(target: string, linkPath: string): Promise<void> {
  return symlink(target, linkPath, process.platform === "win32" ? "junction" : "dir");
}

/**
 * Install `chosen` and remove previously-installed skills that are no longer
 * chosen — never touching skill directories kumo did not install. Chosen
 * names resolve to a shipped copy first, then to a skill found under another
 * agent's home (`home`, default `os.homedir()`) as a link.
 */
export async function syncSkills(opts: {
  homeSkillsDir: string;
  bundledRoot: string;
  chosen: string[];
  /** The user home whose agent skill dirs are scanned for non-shipped picks. */
  home?: string;
  pathMod?: typeof path;
  /** Injectable symlink call (tests exercise the copy fallback). */
  link?: (target: string, linkPath: string) => Promise<void>;
}): Promise<{ installed: string[]; removed: string[]; copied: string[] }> {
  const pathMod = opts.pathMod ?? path;
  const manifestPath = pathMod.join(opts.homeSkillsDir, SKILLS_MANIFEST);
  const manifest = await readManifest(manifestPath);
  const removed: string[] = [];
  for (const name of Object.keys(manifest)) {
    if (opts.chosen.includes(name)) continue;
    const entry = manifest[name];
    if (entry === undefined) continue;
    await removeEntry(opts.homeSkillsDir, entry);
    delete manifest[name];
    removed.push(name);
  }

  const bundled = await readBundledSkills(opts.bundledRoot);
  const found = await scanFoundSkills(opts.home ?? homedir(), pathMod);
  const installed: string[] = [];
  const copied: string[] = [];
  await mkdir(opts.homeSkillsDir, { recursive: true });
  for (const name of opts.chosen) {
    const shipped = bundled.find((s) => s.name === name);
    const external = shipped === undefined ? found.find((s) => s.name === name) : undefined;
    if (shipped === undefined && external === undefined) continue; // unknown name: never invented
    const srcDir = (shipped ?? external)!.dir;
    const want: InstalledSkillEntry =
      shipped !== undefined
        ? { name, kind: "shipped", source: srcDir }
        : { name, kind: "linked", source: srcDir };
    const prev = manifest[name];
    if (
      prev !== undefined &&
      prev.kind === want.kind &&
      prev.source === want.source &&
      existsSync(pathMod.join(opts.homeSkillsDir, name))
    ) {
      continue; // already installed identically: leave the user's copy/link (and edits) alone
    }
    if (prev !== undefined) await removeEntry(opts.homeSkillsDir, prev);
    const dest = pathMod.join(opts.homeSkillsDir, name);
    if (want.kind === "shipped") {
      await cp(srcDir, dest, { recursive: true, force: true });
    } else {
      try {
        await (opts.link ?? defaultLink)(srcDir, dest);
      } catch {
        await cp(srcDir, dest, { recursive: true, force: true });
        want.copied = true;
        copied.push(name);
      }
    }
    manifest[name] = want;
    installed.push(name);
  }
  await mkdir(dirname(manifestPath), { recursive: true });
  const tmp = `${manifestPath}.tmp`;
  await writeFile(tmp, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(tmp, manifestPath);
  return { installed, removed, copied };
}

/**
 * T26b: the launch-time migration for users who upgrade without re-running
 * the wizard. When no manifest exists yet (kumo never picked skills) and the
 * user home has valid skills under its `.agents/skills`, link them all, so
 * the pre-T26 implicit load keeps working. The manifest is the marker: this
 * runs at most once, and an existing manifest — even an empty one, meaning
 * "the user chose nothing" — stops it forever.
 */
export async function migrateAgentsSkills(opts: {
  homeSkillsDir: string;
  home?: string;
  pathMod?: typeof path;
  link?: (target: string, linkPath: string) => Promise<void>;
}): Promise<{ linked: string[]; copied: string[] }> {
  const pathMod = opts.pathMod ?? path;
  const home = opts.home ?? homedir();
  if (existsSync(pathMod.join(opts.homeSkillsDir, SKILLS_MANIFEST))) {
    return { linked: [], copied: [] };
  }
  const inAgents = (await scanFoundSkills(home, pathMod)).filter((s) => s.source === "agents");
  if (inAgents.length === 0) return { linked: [], copied: [] }; // nothing to keep: no marker invented
  const result = await syncSkills({
    homeSkillsDir: opts.homeSkillsDir,
    bundledRoot: "",
    chosen: inAgents.map((s) => s.name),
    home,
    pathMod,
    ...(opts.link !== undefined ? { link: opts.link } : {}),
  });
  return { linked: result.installed, copied: result.copied };
}
