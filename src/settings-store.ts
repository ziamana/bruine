/**
 * Where bruine's settings live: the rows of the profile's own patch layer.
 *
 * Up to dsh 0.1, `$DSH_HOME/settings.yaml` was read on every boot, one top-level section per
 * entry (`llm-pi-ai:`, `agent-default-model:`). dsh 0.2 reads it no more: its Settings plugin
 * imports the file once into the profile patch (`profiles/bruine/cordis.patch.yml`, one row
 * `- id: <section>` per section), renames it `settings.yaml.imported`, and from then on the patch
 * is the configuration; `/model`'s `saveSelection` writes its row there too. bruine follows: the
 * same sections, the same shapes, kept as rows of that patch.
 *
 * The launcher imports a settings.yaml it finds before dsh starts, so bruine's own readers (the
 * setup, `/model`, the persona's model name) never see the two disagree. The user's file is kept
 * as `settings.yaml.pre-0.2`; a section bruine does not know is left in settings.yaml for dsh's
 * own importer, which checks it against the running composition.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { isMap, isSeq, parse as parseYaml, parseDocument, stringify, YAMLSeq, type Document, type YAMLMap } from "yaml";

export type SettingsDoc = Record<string, unknown>;

/** The sections bruine's settings are made of: each one the config of the dsh-base entry of that id. */
export const SETTINGS_SECTIONS = ["llm-pi-ai", "agent-default-model", "llm-deepseek"] as const;

/** Sections settings.yaml held that dsh-base 0.2 does not mount (the theme stays in bruine.json). */
const RETIRED_SECTIONS = ["ui-theme"];

/** The settings file of bruine 0.1 and dsh 0.1. */
export const LEGACY_SETTINGS = "settings.yaml";
/** Where the user's settings.yaml is kept once it has been imported. */
export const LEGACY_BACKUP = "settings.yaml.pre-0.2";

/** The marker that says the system-prompt row of the patch is bruine's (T36). */
export const PERSONA_ROW_MARKER = "# system-prompt row written by bruine (T36).";

/** A patch bruine creates: its header, and no row yet. */
export const PATCH_TEMPLATE =
  "# bruine user overrides. Edit this file, not cordis.yml.\n" +
  `${PERSONA_ROW_MARKER}\n` +
  "# Your own rows go after it; delete the marker to take the persona over.\n" +
  "[]\n";

type Read = (p: string) => string;
const readSync: Read = (p) => readFileSync(p, "utf8");

export function settingsPatchPath(dshHome: string, pathMod: typeof path = path): string {
  return pathMod.join(dshHome, "profiles", "bruine", "cordis.patch.yml");
}

export function legacySettingsPath(dshHome: string, pathMod: typeof path = path): string {
  return pathMod.join(dshHome, LEGACY_SETTINGS);
}

function tryRead(read: Read, p: string): string | undefined {
  try {
    return read(p);
  } catch {
    return undefined;
  }
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSection(id: unknown): id is (typeof SETTINGS_SECTIONS)[number] {
  return typeof id === "string" && (SETTINGS_SECTIONS as readonly string[]).includes(id);
}

/** The settings sections a patch's rows carry (a disabled row carries none). */
export function patchSections(text: string): SettingsDoc {
  const out: SettingsDoc = {};
  let rows: unknown;
  try {
    rows = parseYaml(text, { logLevel: "error" });
  } catch {
    return out;
  }
  if (!Array.isArray(rows)) return out;
  for (const row of rows) {
    if (!plainObject(row) || !isSection(row.id) || row.disabled === true) continue;
    if (plainObject(row.config)) out[row.id] = row.config;
  }
  return out;
}

/**
 * The settings, in the shape settings.yaml had (`{ "llm-pi-ai": …, "agent-default-model": … }`):
 * the patch's rows, and over them a settings.yaml not imported yet. Undefined when neither holds
 * any. Never throws.
 */
export function readSettingsDoc(dshHome: string, read: Read = readSync, pathMod: typeof path = path): SettingsDoc | undefined {
  const patch = tryRead(read, settingsPatchPath(dshHome, pathMod));
  const legacy = tryRead(read, legacySettingsPath(dshHome, pathMod));
  const doc: SettingsDoc = patch === undefined ? {} : patchSections(patch);
  if (legacy !== undefined) {
    try {
      const old: unknown = parseYaml(legacy, { logLevel: "error" });
      if (plainObject(old)) Object.assign(doc, old);
    } catch {
      // a settings.yaml that does not parse is left to dsh, which says what is wrong with it
    }
  }
  return Object.keys(doc).length > 0 ? doc : undefined;
}

/** Has bruine been set up: a settings.yaml still to import, or a settings row in the patch. */
export function hasSettings(dshHome: string, exists: (p: string) => boolean = existsSync, read: Read = readSync): boolean {
  if (exists(legacySettingsPath(dshHome))) return true;
  const patch = tryRead(read, settingsPatchPath(dshHome));
  return patch !== undefined && Object.keys(patchSections(patch)).length > 0;
}

/**
 * The patch text with each row of `rows` set to that config (a row that is not there is added),
 * or taken out when its config is undefined. The header, the comments and every other row are
 * kept as they were; a `[]` placeholder becomes a block list.
 */
export function withRows(text: string, rows: Record<string, Record<string, unknown> | undefined>): string {
  const doc = parseDocument(text, { logLevel: "error" }) as unknown as Document;
  const contents = doc.contents;
  let seq: YAMLSeq;
  if (isSeq(contents)) {
    seq = contents;
  } else {
    seq = new YAMLSeq();
    if (contents !== null && contents !== undefined) seq.commentBefore = contents.commentBefore;
    doc.contents = seq;
  }
  seq.flow = false;
  for (const [id, config] of Object.entries(rows)) {
    const at = seq.items.findIndex((item) => isMap(item) && (item.get("id") as unknown) === id);
    if (config === undefined) {
      if (at >= 0) seq.items.splice(at, 1);
      continue;
    }
    if (at >= 0) (seq.items[at] as YAMLMap).set("config", doc.createNode(config));
    else seq.items.push(doc.createNode({ id, config }));
  }
  return doc.toString({ lineWidth: 0 });
}

async function writeAtomic(file: string, content: string, mode: number): Promise<void> {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, content, { encoding: "utf8", mode });
  await rename(tmp, file);
}

/**
 * Write the settings: every section of SETTINGS_SECTIONS takes the value `doc` gives it, and a
 * section `doc` leaves out is removed (the setup writes the whole of them). A settings.yaml still
 * waiting is retired afterwards, so dsh never imports an older choice over this one.
 */
export async function writeSettingsDoc(dshHome: string, doc: SettingsDoc): Promise<void> {
  const file = settingsPatchPath(dshHome);
  await mkdir(path.dirname(file), { recursive: true });
  const current = existsSync(file) ? await readFile(file, "utf8") : PATCH_TEMPLATE;
  const rows: Record<string, Record<string, unknown> | undefined> = {};
  for (const id of SETTINGS_SECTIONS) {
    const value = doc[id];
    rows[id] = plainObject(value) ? value : undefined;
  }
  const next = withRows(current, rows);
  if (next !== current || !existsSync(file)) await writeAtomic(file, next, 0o600);
  await retireLegacy(dshHome);
}

/**
 * Move a settings.yaml aside: kept as settings.yaml.pre-0.2, and whatever section bruine does not
 * know is written back to settings.yaml for dsh to import. One that does not parse is left alone.
 */
async function retireLegacy(dshHome: string): Promise<void> {
  const file = legacySettingsPath(dshHome);
  if (!existsSync(file)) return;
  let old: unknown;
  try {
    old = parseYaml(await readFile(file, "utf8"), { logLevel: "error" });
  } catch {
    return;
  }
  const rest: Record<string, unknown> = {};
  if (plainObject(old)) {
    for (const [key, value] of Object.entries(old)) {
      if (!isSection(key) && !RETIRED_SECTIONS.includes(key)) rest[key] = value;
    }
  }
  await rename(file, path.join(dshHome, LEGACY_BACKUP));
  if (Object.keys(rest).length > 0) await writeAtomic(file, stringify(rest), 0o600);
}

/**
 * Bring a settings.yaml into the patch (once, before dsh starts). Its sections win over the
 * patch's: it is the file the user last wrote. Returns true when there was one to import.
 */
export async function importLegacySettings(dshHome: string): Promise<boolean> {
  const file = legacySettingsPath(dshHome);
  if (!existsSync(file)) return false;
  let old: unknown;
  try {
    old = parseYaml(await readFile(file, "utf8"), { logLevel: "error" });
  } catch {
    return false;
  }
  if (!plainObject(old)) return false;
  const patch = settingsPatchPath(dshHome);
  const doc: SettingsDoc = existsSync(patch) ? patchSections(await readFile(patch, "utf8")) : {};
  for (const id of SETTINGS_SECTIONS) if (old[id] !== undefined) doc[id] = old[id];
  await writeSettingsDoc(dshHome, doc);
  return true;
}
