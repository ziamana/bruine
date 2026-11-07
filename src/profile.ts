import { createRequire } from "node:module";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { parseDocument, isMap, isSeq, type YAMLMap } from "yaml";
import { PATCH_TEMPLATE, PERSONA_ROW_MARKER, readSettingsDoc, withRows } from "./settings-store.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { name: string; version: string };

export interface ProfilePaths {
  dir: string;
  packageJson: string;
  patchYml: string;
  cordisYml: string;
  /** T26: the empty agentsHome bruine points skill-filesystem at (never filled). */
  agentsDir: string;
}

/** The profile layout as data; pathMod is injectable for win32 tests. */
export function profilePaths(
  dshHome: string,
  pathMod: typeof path = path,
): ProfilePaths {
  const dir = pathMod.join(dshHome, "profiles", "bruine");
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
  // Owner-only: the patch carries the settings since dsh 0.2, as settings.yaml did.
  await writeFile(tmp, content, { encoding: "utf8", mode: 0o600 });
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
 * bruine-bench system-prompt variants land. One owner, one place.
 *
 * The suffix is empty since dsh 0.2: its working-directory service tells the model where it
 * works, and the `{{cwd}}` variable the suffix used to name is gone (an unknown variable stops
 * every request before it is sent).
 */
export const PERSONA_SUFFIX = "";

/** The clause dsh 0.2 no longer resolves, wherever a persona suffix still carries it. */
const CWD_CLAUSE = /\s*Your working directory is \{\{cwd\}\}\.\s*/g;

/** The persona prefix, `%s` = model display name. */
const PERSONA_PREFIX_TEMPLATE =
  "You are bruine, a terminal coding agent powered by %s. Be short and " +
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
 * The default route's display name from the settings (the profile patch, or a
 * settings.yaml not imported yet); undefined when there are none, no default
 * route, or no model id.
 */
export function resolveModelDisplayName(
  dshHome: string,
  read: (p: string) => string = (p) => readFileSync(p, "utf8"),
  pathMod: typeof path = path,
): string | undefined {
  try {
    const doc = readSettingsDoc(dshHome, read, pathMod) as Record<string, any> | undefined;
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

/** The config of the system-prompt row bruine owns; an empty suffix is left out, as dsh asks. */
export function personaConfig(persona: Persona): Record<string, unknown> {
  return {
    includeHarnessIdentity: false,
    personaPrefix: persona.personaPrefix,
    ...(persona.personaSuffix !== "" ? { personaSuffix: persona.personaSuffix } : {}),
  };
}

/** The system-prompt row bruine owns, as patch-layer YAML (JSON-quoted text). */
export function personaPatch(persona: Persona): string {
  return (
    "- id: system-prompt\n" +
    "  config:\n" +
    "    includeHarnessIdentity: false\n" +
    `    personaPrefix: ${JSON.stringify(persona.personaPrefix)}\n` +
    (persona.personaSuffix !== "" ? `    personaSuffix: ${JSON.stringify(persona.personaSuffix)}\n` : "")
  );
}

/**
 * A patch whose system-prompt row is the user's, with the `{{cwd}}` clause taken out of its
 * suffix (the rest of their text kept; a suffix left empty is removed). Unchanged otherwise.
 */
export function withoutCwdClause(text: string): string {
  if (!text.includes("{{cwd}}")) return text;
  const doc = parseDocument(text, { logLevel: "error" });
  const seq = doc.contents;
  if (!isSeq(seq)) return text;
  let changed = false;
  for (const item of seq.items) {
    if (!isMap(item) || (item.get("id") as unknown) !== "system-prompt") continue;
    const node = item.get("config") as unknown;
    if (!isMap(node)) continue;
    const config = node as YAMLMap<string, unknown>;
    const suffix = config.get("personaSuffix") as unknown;
    if (typeof suffix !== "string" || !suffix.includes("{{cwd}}")) continue;
    const kept = suffix.replace(CWD_CLAUSE, " ").trim();
    if (kept === "") config.delete("personaSuffix");
    else config.set("personaSuffix", kept);
    changed = true;
  }
  return changed ? doc.toString({ lineWidth: 0 }) : text;
}

/** Has the user taken the persona row over (marker gone or changed)? */
export function isManagedPersonaPatch(text: string): boolean {
  if (text.includes(PERSONA_ROW_MARKER) || text.includes("# system-prompt row written by kumo (T36).")) return true;
  // bruine's own placeholder patch (`[]`): ours to write over.
  return /^\s*\[\s*\]\s*$/m.test(text);
}

/**
 * Write (or refresh) the persona row in the profile's user patch, and only that
 * row: the settings rows and the user's own rows stay as they are. A persona the
 * user took over is not rewritten, only freed of the `{{cwd}}` clause dsh 0.2
 * refuses; a broken persona must not stop the boot.
 */
async function writePersonaPatch(
  patchYml: string,
  dshHome: string,
  pathMod: typeof path = path,
): Promise<void> {
  try {
    const current = existsSync(patchYml) ? await readFile(patchYml, "utf8") : PATCH_TEMPLATE;
    let next: string;
    if (isManagedPersonaPatch(current)) {
      const modelName = resolveModelDisplayName(dshHome, (p) => readFileSync(p, "utf8"), pathMod);
      next = withRows(current, { "system-prompt": personaConfig(composePersona(modelName ?? "")) });
    } else {
      next = withoutCwdClause(current);
    }
    if (existsSync(patchYml) && current === next) return;
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
  // directory; it must exist and bruine never fills it (enabled skills live in
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
    // regenerated — only the profile directory. .env, bruine.json and
    // sessions/ live outside it and are never touched; the patch, which holds
    // the settings since dsh 0.2, is carried over.
    const keptPatch = existsSync(p.patchYml) ? await readFile(p.patchYml, "utf8") : undefined;
    await rm(dir, { recursive: true, force: true });
    if (keptPatch !== undefined) {
      await mkdir(dir, { recursive: true });
      await writeAtomic(p.patchYml, keptPatch);
    }
  }

  await mkdir(dir, { recursive: true });

  const packageJson = {
    name: "dsh-profile-bruine",
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
  // The setup can write the settings rows before the profile exists: a patch
  // that is already there is kept.
  if (!existsSync(p.patchYml)) await writeAtomic(p.patchYml, PATCH_TEMPLATE);
  await writeAtomic(
    p.cordisYml,
    "# managed by dsh, do not edit\n[]\n",
  );
  // T36: the freshly created `[]` patch carries the persona from here on.
  await writePersonaPatch(p.patchYml, dshHome, pathMod);

  return { created: true, dir };
}

/**
 * The bundles a profile boots from, linked to the copies that are already on the
 * disk: this package (where it runs from) and dsh-base (the one dsh brings). Setting
 * the profile up this way needs no network and no pnpm; `dsh plugin add` needs both,
 * and a machine with only node and npm has neither. A link that points nowhere any
 * more (the global install moved) is replaced. Returns false when a link cannot be
 * made, so the caller can fall back to dsh's own installer.
 */
export function linkProfileBundles(
  profileDir: string,
  own: { name: string; root: string },
  dshBaseDir: string,
): boolean {
  const type = process.platform === "win32" ? "junction" : "dir";
  const link = (target: string, at: string): void => {
    mkdirSync(path.dirname(at), { recursive: true });
    rmSync(at, { recursive: true, force: true });
    symlinkSync(target, at, type);
  };
  try {
    const modules = path.join(profileDir, "node_modules");
    link(own.root, path.join(modules, own.name));
    link(dshBaseDir, path.join(modules, "@deepseek-ai", "dsh-base"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the bundle the profile loads is the one that is running. The profile holds a link to
 * the install it was set up from; after an update (or a switch between a global install and a
 * checkout) that link can still point at the old copy, and the session then loads the old plugins
 * and says the old version however often it is restarted. A link to the same folder is current;
 * so is a copy dsh installed when it is the same version; anything else is relinked. When this
 * package's own folder is unknown, an existing bundle is left alone.
 */
export function bundleIsCurrent(
  profileDir: string,
  name: string,
  own: { root: string | undefined; version: string },
): boolean {
  const at = path.join(profileDir, "node_modules", name);
  const marker = path.join(at, "package.json");
  if (!existsSync(marker)) return false;
  if (own.root === undefined) return true;
  try {
    if (realpathSync(at) === realpathSync(own.root)) return true;
    if (lstatSync(at).isSymbolicLink()) return false;
    return (JSON.parse(readFileSync(marker, "utf8")) as { version?: unknown }).version === own.version;
  } catch {
    return false;
  }
}

/** Where dsh's own dsh-base lives, found through the dsh this package pins. */
export function resolveDshBaseDir(): string | undefined {
  try {
    const dshRequire = createRequire(require.resolve("@deepseek-ai/dsh/package.json"));
    return path.dirname(dshRequire.resolve("@deepseek-ai/dsh-base/package.json"));
  } catch {
    return undefined;
  }
}
