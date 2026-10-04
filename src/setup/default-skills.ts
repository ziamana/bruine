/**
 * The skills a fresh bruine starts with: every one it ships except the ones that only matter to
 * a few (remotion makes videos). They are on from the first launch, whatever route the setup
 * took, and the user turns off the ones they do not want in `bruine setup`. Whoever has chosen
 * their skills before (a `skills` list in bruine.json, or a manifest of what is installed) is
 * never touched.
 */
import { configReadPath, configWritePath, manifestReadPath } from "../compat.js";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeAtomic } from "./simple.js";
import { readBundledSkills, scanFoundSkills, syncSkills } from "./skills.js";

/** Shipped skills that start switched off. */
export const NOT_BY_DEFAULT: readonly string[] = ["remotion", "remotion-best-practices"];

/** The shipped skills that start on. */
export function defaultSkills(bundled: readonly { name: string }[]): string[] {
  return bundled.map((s) => s.name).filter((name) => !NOT_BY_DEFAULT.includes(name));
}

/**
 * Turn the default skills on when the user has never chosen any. Returns the names it installed
 * and, among them, the ones kept from `.agents/skills` (both empty when it did nothing). Also keeps the skills the user already has in the `.agents/skills` folder of their home,
 * as the setup's skills step does.
 */
export async function ensureDefaultSkills(opts: {
  dshHome: string;
  bundledRoot: string;
  home?: string;
}): Promise<{ installed: string[]; kept: string[] }> {
  const homeSkillsDir = join(opts.dshHome, "skills");
  let doc: Record<string, unknown> = {};
  try {
    doc = JSON.parse(await readFile(configReadPath(opts.dshHome), "utf8")) as Record<string, unknown>;
  } catch {
    doc = {};
  }
  const nothing = { installed: [], kept: [] };
  if (Array.isArray(doc.skills)) return nothing;
  if (existsSync(manifestReadPath(homeSkillsDir))) return nothing;

  const bundled = await readBundledSkills(opts.bundledRoot);
  if (bundled.length === 0) return nothing;
  const shipped = new Set(bundled.map((s) => s.name));
  const home = opts.home ?? homedir();
  const mine = (await scanFoundSkills(home)).filter((s) => s.source === "agents" && !shipped.has(s.name));
  const chosen = [...defaultSkills(bundled), ...mine.map((s) => s.name)];

  const result = await syncSkills({ homeSkillsDir, bundledRoot: opts.bundledRoot, chosen, home });
  doc.skills = chosen;
  await writeAtomic(configWritePath(opts.dshHome), `${JSON.stringify(doc, null, 2)}\n`);
  return { installed: result.installed, kept: mine.map((s) => s.name).filter((n) => result.installed.includes(n)) };
}
