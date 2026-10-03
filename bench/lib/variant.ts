/**
 * T36 — system-prompt variants. A variant is a *delta* on today's persona
 * (`bench/variants/<name>.yml`), applied through the same persona section the
 * product uses: the runner writes the composed persona into the bench home's
 * profile patch. dsh is never edited, and the baseline variant composes
 * byte-for-byte the prompt a plain `bruine` run gets.
 */
import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { composePersona, personaPatch, type Persona } from "../../src/profile.js";

export interface Variant {
  name: string;
  /** Lines appended to the persona suffix, in order. */
  add: string[];
  /** One-line note for the summary / README. */
  note?: string;
}

/** Read `bench/variants/<name>.yml`; `name` may be a path. */
export async function readVariant(variantsDir: string, name: string): Promise<Variant> {
  const path = name.includes("/") || name.endsWith(".yml") || name.endsWith(".yaml")
    ? name
    : `${variantsDir}/${name}.yml`;
  const doc = (parseYaml(await readFile(path, "utf8")) ?? {}) as Record<string, unknown>;
  const add = doc["add"];
  if (!Array.isArray(add) || add.some((line) => typeof line !== "string")) {
    throw new Error(`variant ${name}: "add" must be a list of instruction lines`);
  }
  return {
    name: typeof doc["name"] === "string" ? doc["name"] : name,
    add: add as string[],
    ...(typeof doc["note"] === "string" ? { note: doc["note"] } : {}),
  };
}

/** Names of the variant files available in `variantsDir`. */
export async function listVariants(variantsDir: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  try {
    const files = await readdir(variantsDir);
    return files.filter((f) => f.endsWith(".yml") || f.endsWith(".yaml")).sort();
  } catch {
    return [];
  }
}

/**
 * The persona for one variant: today's persona with the model's display name,
 * plus the variant's lines at the very end of the prompt (personaSuffix is the
 * last section dsh renders, so an added line is the last thing the model
 * reads).
 */
export function variantPersona(variant: Variant, modelName: string): Persona {
  const base = composePersona(modelName);
  const extra = variant.add.map((line) => line.trim()).filter((line) => line !== "");
  if (extra.length === 0) return base;
  return { personaPrefix: base.personaPrefix, personaSuffix: `${base.personaSuffix}\n\n${extra.join("\n")}` };
}

/**
 * The profile patch the bench home gets: the variant's persona, plus a session
 * log that is plain JSONL. dsh compresses that log with zstd by default, and
 * its frames are concatenated, which no in-process reader can fully decode —
 * the bench needs the rows, so it asks for plaintext through the same patch
 * layer (restating the row's own config, because a patch replaces it whole).
 */
export function variantPatch(persona: Persona): string {
  return (
    "# bruine-bench profile patch (T36). Generated per run; do not edit.\n" +
    personaPatch(persona) +
    "- id: session-persistence-jsonl\n" +
    "  config:\n" +
    "    root: !!js dshHomePath('sessions')\n" +
    "    compression: none\n"
  );
}
