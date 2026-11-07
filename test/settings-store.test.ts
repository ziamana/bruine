import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { parse as parseYaml } from "yaml";
import { ensureProfile, withoutCwdClause } from "../src/profile.js";
import {
  hasSettings,
  importLegacySettings,
  LEGACY_BACKUP,
  PATCH_TEMPLATE,
  patchSections,
  readSettingsDoc,
  settingsPatchPath,
  withRows,
  writeSettingsDoc,
} from "../src/settings-store.js";

const homes: string[] = [];
const home = (files: Record<string, string> = {}): string => {
  const dir = mkdtempSync(join(tmpdir(), "bruine-store-"));
  homes.push(dir);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
};
afterEach(() => { for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true }); });

const LOCAL = {
  "llm-pi-ai": { providers: { local: { api: "openai-completions", baseURL: "http://127.0.0.1:8080/v1", apiKeyEnv: "BRUINE_LOCAL_API_KEY", models: [{ id: "qwen", name: "Qwen" }] } } },
  "agent-default-model": { provider: "local", model: "qwen" },
};
const legacyYaml =
  "llm-pi-ai:\n  providers:\n    local:\n      baseURL: http://127.0.0.1:8080/v1\n      models:\n        - id: qwen\n          name: Qwen\n" +
  "agent-default-model:\n  provider: local\n  model: qwen\nui-theme:\n  preference: light\n";
const rows = (dir: string) => parseYaml(readFileSync(settingsPatchPath(dir), "utf8")) as Array<Record<string, any>>;

describe("withRows: one row changed, the rest of the patch as it was", () => {
  test("a [] placeholder becomes a block list under the same header", () => {
    const out = withRows(PATCH_TEMPLATE, { "agent-default-model": { provider: "local", model: "qwen" } });
    expect(out.startsWith("# bruine user overrides. Edit this file, not cordis.yml.\n# system-prompt row written by bruine (T36).")).toBe(true);
    expect(parseYaml(out)).toEqual([{ id: "agent-default-model", config: { provider: "local", model: "qwen" } }]);
  });

  test("an existing row keeps its name, a removed one goes, a user row and its !!js tag stay", () => {
    const text = "# mine\n- id: web\n  config:\n    root: !!js process.cwd()\n" +
      "- id: agent-default-model\n  name: \"@deepseek-ai/dsh-agent-default-model\"\n  config:\n    provider: a\n    model: b\n" +
      "- id: llm-pi-ai\n  config:\n    providers: {}\n";
    const out = withRows(text, { "agent-default-model": { provider: "c", model: "d" }, "llm-pi-ai": undefined });
    expect(out).toContain("root: !!js process.cwd()");
    expect(out).toContain("# mine");
    expect(out).toContain('name: "@deepseek-ai/dsh-agent-default-model"');
    expect(out).not.toContain("llm-pi-ai");
    expect(patchSections(out)).toEqual({ "agent-default-model": { provider: "c", model: "d" } });
  });

  test("writing the same rows twice changes nothing the second time", () => {
    const once = withRows(PATCH_TEMPLATE, LOCAL);
    expect(withRows(once, LOCAL)).toBe(once);
  });
});

describe("the settings live in the profile patch (dsh 0.2)", () => {
  test("written, read back in the settings.yaml shape, and counted as set up", async () => {
    const dir = home();
    expect(hasSettings(dir)).toBe(false);
    expect(readSettingsDoc(dir)).toBeUndefined();
    await writeSettingsDoc(dir, LOCAL);
    expect(readSettingsDoc(dir)).toEqual(LOCAL);
    expect(hasSettings(dir)).toBe(true);
    expect(existsSync(join(dir, "settings.yaml"))).toBe(false);
  });

  test("a section the doc leaves out is removed, and only bruine's sections are written", async () => {
    const dir = home();
    await writeSettingsDoc(dir, { ...LOCAL, "ui-theme": { preference: "light" } });
    await writeSettingsDoc(dir, { "agent-default-model": { provider: "deepseek-official", model: "deepseek-flash" } });
    expect(rows(dir).map((r) => r.id)).toEqual(["agent-default-model"]);
  });

  test("a disabled row carries no settings", () => {
    expect(patchSections("- id: agent-default-model\n  disabled: true\n  config:\n    provider: a\n    model: b\n")).toEqual({});
  });
});

describe("a settings.yaml from bruine 0.1", () => {
  test("is read before it is imported, and wins over the patch", () => {
    const dir = home({ "settings.yaml": legacyYaml, "profiles/bruine/cordis.patch.yml": "- id: agent-default-model\n  config:\n    provider: old\n    model: old\n" });
    expect(readSettingsDoc(dir)?.["agent-default-model"]).toEqual({ provider: "local", model: "qwen" });
    expect(hasSettings(dir)).toBe(true);
  });

  test("is imported into the patch once, kept as settings.yaml.pre-0.2, the theme left to bruine.json", async () => {
    const dir = home({ "settings.yaml": legacyYaml });
    expect(await importLegacySettings(dir)).toBe(true);
    expect(existsSync(join(dir, "settings.yaml"))).toBe(false);
    expect(readFileSync(join(dir, LEGACY_BACKUP), "utf8")).toBe(legacyYaml);
    expect(patchSections(readFileSync(settingsPatchPath(dir), "utf8"))).toEqual({
      "llm-pi-ai": { providers: { local: { baseURL: "http://127.0.0.1:8080/v1", models: [{ id: "qwen", name: "Qwen" }] } } },
      "agent-default-model": { provider: "local", model: "qwen" },
    });
    expect(await importLegacySettings(dir)).toBe(false);
  });

  test("a section bruine does not know is left in settings.yaml for dsh's own importer", async () => {
    const dir = home({ "settings.yaml": `${legacyYaml}shell:\n  executable: /bin/zsh\n` });
    await importLegacySettings(dir);
    expect(parseYaml(readFileSync(join(dir, "settings.yaml"), "utf8"))).toEqual({ shell: { executable: "/bin/zsh" } });
  });

  test("one that does not parse is left alone", async () => {
    const dir = home({ "settings.yaml": "agent-default-model: [unclosed\n" });
    expect(await importLegacySettings(dir)).toBe(false);
    expect(readFileSync(join(dir, "settings.yaml"), "utf8")).toBe("agent-default-model: [unclosed\n");
  });

  test("a setup run before the import retires it, so dsh never brings the old choice back", async () => {
    const dir = home({ "settings.yaml": legacyYaml });
    await writeSettingsDoc(dir, { "agent-default-model": { provider: "openrouter", model: "openrouter/auto" } });
    expect(existsSync(join(dir, "settings.yaml"))).toBe(false);
    expect(readSettingsDoc(dir)).toEqual({ "agent-default-model": { provider: "openrouter", model: "openrouter/auto" } });
  });
});

describe("the persona row and the settings rows share the patch", () => {
  test("ensureProfile keeps a patch the setup wrote first, and the persona names its model", async () => {
    const dir = home();
    await writeSettingsDoc(dir, LOCAL);
    await ensureProfile(dir);
    const text = readFileSync(settingsPatchPath(dir), "utf8");
    expect(patchSections(text)).toEqual(LOCAL);
    const persona = rows(dir).find((r) => r.id === "system-prompt");
    expect(persona?.config.personaPrefix).toContain("powered by Qwen");
    expect(persona?.config).not.toHaveProperty("personaSuffix");
  });

  test("a boot refreshes the persona without touching the settings rows", async () => {
    const dir = home();
    await ensureProfile(dir);
    await writeSettingsDoc(dir, LOCAL);
    await ensureProfile(dir);
    expect(patchSections(readFileSync(settingsPatchPath(dir), "utf8"))).toEqual(LOCAL);
    expect(rows(dir).filter((r) => r.id === "system-prompt")).toHaveLength(1);
  });

  test("a 0.1 persona row loses its {{cwd}} suffix on the next boot", async () => {
    const dir = home({
      "profiles/bruine/package.json": JSON.stringify({ dependencies: { "@ziamana/bruine": "0.1.8" } }),
      "profiles/bruine/cordis.patch.yml": `${PATCH_TEMPLATE.replace("[]\n", "")}- id: system-prompt\n  config:\n    includeHarnessIdentity: false\n    personaPrefix: "You are bruine."\n    personaSuffix: "Your working directory is {{cwd}}."\n`,
    });
    await ensureProfile(dir);
    expect(readFileSync(settingsPatchPath(dir), "utf8")).not.toContain("{{cwd}}");
  });

  test("a persona the user took over keeps its text, without the {{cwd}} clause", () => {
    const text = "# mine\n- id: system-prompt\n  config:\n    personaPrefix: Hi\n    personaSuffix: \"Your working directory is {{cwd}}. Answer in French.\"\n";
    const out = withoutCwdClause(text);
    expect(out).toContain("# mine");
    expect((parseYaml(out) as any)[0].config).toEqual({ personaPrefix: "Hi", personaSuffix: "Answer in French." });
    expect(withoutCwdClause("- id: web\n")).toBe("- id: web\n");
  });
});
