import { createRequire } from "node:module";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { name: string; version: string };

export interface ProfilePaths {
  dir: string;
  packageJson: string;
  patchYml: string;
  cordisYml: string;
  /** T26: the empty agentsHome kumo points skill-filesystem at (never filled). */
  agentsDir: string;
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
    agentsDir: pathMod.join(dshHome, "agents"),
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

/**
 * A profile is legacy when its dependency list does not reference this
 * package's current name (T20.3 migration after the npm rename).
 */
async function isLegacyProfile(packageJsonPath: string): Promise<boolean> {
  try {
    const manifest = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      dependencies?: Record<string, unknown>;
    };
    const deps = manifest?.dependencies ?? {};
    return Object.keys(deps).length > 0 && !(pkg.name in deps);
  } catch {
    return false;
  }
}

/**
 * T36 — the persona, composed at boot instead of shipped as one frozen string.
 *
 * dsh's prompt variable `{{model}}` is the raw route model id, which for a
 * local llama.cpp route is the full `.gguf` file path, so the model used to
 * announce itself to the user with a file path instead of a name. The persona
 * now carries the model's display name (settings.yaml `name:`, else the id
 * without its directory and `.gguf` suffix — the same rule the footer uses), and
 * it is written into the profile's own patch layer, which is also where the
 * kumo-bench system-prompt variants land. One owner, one place.
 */
export const PERSONA_SUFFIX = "Your working directory is {{cwd}}.";

/** The persona prefix, `%s` = model display name. */
const PERSONA_PREFIX_TEMPLATE =
  "You are kumo, a terminal coding agent powered by %s. Be short and " +
  "direct: answer first, detail only when asked. Reply in the user's " +
  "language. Never use emojis. Only mention tools you actually have.";

export interface Persona {
  personaPrefix: string;
  personaSuffix: string;
}

/**
 * A display name that is safe to paste into a prompt: braces would be read as
 * a `{{variable}}` reference and dsh throws on an unknown one.
 */
function safeModelName(name: string): boolean {
  return name !== "" && !name.includes("{{") && !name.includes("}}");
}

/** settings.yaml `name:`, else the id without its directory / `.gguf`. */
export function modelDisplayName(id: string, name?: string): string {
  if (name !== undefined && name.trim() !== "") return name.trim();
  if (id === "") return "";
  const base = id.split(/[\\/]/).at(-1) ?? id;
  return base.replace(/\.gguf$/i, "");
}

/** The persona for one model display name (empty name = no name known). */
export function composePersona(modelName: string): Persona {
  const name = safeModelName(modelName.trim()) ? modelName.trim() : "a local model";
  return {
    personaPrefix: PERSONA_PREFIX_TEMPLATE.replace("%s", name),
    personaSuffix: PERSONA_SUFFIX,
  };
}

/**
 * The default route's display name from `$DSH_HOME/settings.yaml`; undefined
 * when there is no settings file, no default route, or no model id.
 */
export function resolveModelDisplayName(
  dshHome: string,
  read: (p: string) => string = (p) => readFileSync(p, "utf8"),
  pathMod: typeof path = path,
): string | undefined {
  try {
    const doc = parseYaml(read(pathMod.join(dshHome, "settings.yaml"))) as Record<string, any>;
    const def = doc?.["agent-default-model"];
    const id = def?.model;
    if (typeof id !== "string" || id === "") return undefined;
    const entry = (doc?.["llm-pi-ai"]?.providers?.[def?.provider]?.models ?? []).find(
      (m: any) => m !== null && typeof m === "object" && m.id === id,
    );
    return modelDisplayName(id, typeof entry?.name === "string" ? entry.name : undefined);
  } catch {
    return undefined;
  }
}

/** Marker that says the system-prompt row in the user patch is kumo's. */
const PERSONA_ROW_MARKER = "# system-prompt row written by kumo (T36).";
const PERSONA_PATCH_HEADER =
  "# kumo user overrides. Edit this file, not cordis.yml.\n" +
  `${PERSONA_ROW_MARKER}\n` +
  "# Your own rows go after it; delete the marker to take the persona over.\n";

/** The system-prompt row kumo owns, as patch-layer YAML (JSON-quoted text). */
export function personaPatch(persona: Persona): string {
  return (
    "- id: system-prompt\n" +
    "  config:\n" +
    "    includeHarnessIdentity: false\n" +
    `    personaPrefix: ${JSON.stringify(persona.personaPrefix)}\n` +
    `    personaSuffix: ${JSON.stringify(persona.personaSuffix)}\n`
  );
}

/** Has the user taken the persona row over (marker gone or changed)? */
export function isManagedPersonaPatch(text: string): boolean {
  if (text.includes(PERSONA_ROW_MARKER)) return true;
  // kumo's own placeholder patch (`[]`): ours to write over.
  return /^\s*\[\s*\]\s*$/m.test(text);
}

/**
 * Write (or refresh) the persona row in the profile's user patch. A patch the
 * user took over is never rewritten; a broken persona must not stop the boot.
 */
async function writePersonaPatch(
  patchYml: string,
  dshHome: string,
  pathMod: typeof path = path,
): Promise<void> {
  try {
    if (existsSync(patchYml) && !isManagedPersonaPatch(await readFile(patchYml, "utf8"))) return;
    const modelName = resolveModelDisplayName(
      dshHome,
      (p) => readFileSync(p, "utf8"),
      pathMod,
    );
    const persona = composePersona(modelName ?? "");
    const next = `${PERSONA_PATCH_HEADER}${personaPatch(persona)}`;
    const current = existsSync(patchYml) ? await readFile(patchYml, "utf8") : "";
    if (current === next) return;
    await writeAtomic(patchYml, next);
  } catch {
    // the persona is a nicety; dsh's own default stays in place
  }
}

export async function ensureProfile(
  dshHome: string,
  pathMod: typeof path = path,
): Promise<{ created: boolean; dir: string }> {
  const p = profilePaths(dshHome, pathMod);
  const dir = p.dir;

  // T26: the bundle patch points skill-filesystem's agentsHome at this
  // directory; it must exist and kumo never fills it (enabled skills live in
  // $DSH_HOME/skills). Created on every run so existing homes catch up.
  await mkdir(p.agentsDir, { recursive: true });

  if (await existsSync(p.packageJson)) {
    if (!(await isLegacyProfile(p.packageJson))) {
      // T36: the persona carries the route's display name, so it is refreshed
      // on every boot (a route switch must not keep the previous model name).
      await writePersonaPatch(p.patchYml, dshHome, pathMod);
      return { created: false, dir };
    }
    // T20.3 migration: a profile generated before the package rename is
    // regenerated — only the profile directory. settings.yaml, .env,
    // kumo.json and sessions/ live outside it and are never touched.
    await rm(dir, { recursive: true, force: true });
  }

  await mkdir(dir, { recursive: true });

  const packageJson = {
    name: "dsh-profile-kumo",
    private: true,
    dependencies: {
      [pkg.name]: pkg.version,
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
  // T36: the freshly created `[]` patch carries the persona from here on.
  await writePersonaPatch(p.patchYml, dshHome, pathMod);

  return { created: true, dir };
}
