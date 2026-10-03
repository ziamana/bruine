import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { appEnv, appHome, configReadPath, configWritePath, manifestReadPath } from "../src/compat.js";
import { composePersona, ensureProfile } from "../src/profile.js";
import { setUpdateCheck } from "../src/update.js";
const dirs: string[] = [];
function temp(): string { const dir = mkdtempSync(join(tmpdir(), "bruine-compat-")); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

test.each([
  [{ BRUINE_HOME: "new", KUMO_HOME: "old" }, [], "new"],
  [{ KUMO_HOME: "old" }, [], "old"],
  [{}, [".bruine"], ".bruine"],
  [{}, [".kumo"], ".kumo"],
  [{}, [".bruine", ".kumo"], ".bruine"],
  [{}, [], ".bruine"],
  [{ BRUINE_HOME: "custom" }, [".bruine", ".kumo"], "custom"],
] as const)("application home precedence (%j, %j)", (env, present, expected) => {
  const home = temp();
  for (const name of present) mkdirSync(join(home, name));
  const actual = appHome(env, home);
  expect(actual).toBe(expected.startsWith(".") ? join(home, expected) : expected);
});
test("environment fallback preserves precedence and explicit empty values", () => {
  expect(appEnv("ASCII", { KUMO_ASCII: "1" })).toBe("1");
  expect(appEnv("ASCII", { BRUINE_ASCII: "0", KUMO_ASCII: "1" })).toBe("0");
  expect(appEnv("ASCII", { BRUINE_ASCII: "", KUMO_ASCII: "1" })).toBe("");
  expect(appEnv("ASCII", {})).toBeUndefined();
});
test("config reads prefer the new file and writes preserve the old config", async () => {
  const home = temp(); const old = join(home, "kumo.json");
  writeFileSync(old, '{"telemetry":false,"keep":"legacy"}');
  expect(configReadPath(home)).toBe(old);
  expect(configWritePath(home)).toBe(join(home, "bruine.json"));
  await setUpdateCheck(home, false);
  expect(JSON.parse(readFileSync(configReadPath(home), "utf8"))).toEqual({ telemetry: false, keep: "legacy", updateCheck: false });
  expect(readFileSync(old, "utf8")).toBe('{"telemetry":false,"keep":"legacy"}');
  writeFileSync(join(home, "bruine.json"), '{"keep":"new"}');
  expect(JSON.parse(readFileSync(configReadPath(home), "utf8"))).toEqual({ keep: "new" });
});
test("skills manifests prefer the canonical file and fall back to the old marker", () => {
  const home = temp(); const old = join(home, ".kumo-installed.json");
  writeFileSync(old, "{}"); expect(manifestReadPath(home)).toBe(old);
  const current = join(home, ".bruine-installed.json");
  writeFileSync(current, "{}"); expect(manifestReadPath(home)).toBe(current);
});
test("both commands use the same launcher and the persona keeps its detection phrase", () => {
  const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));
  expect(pkg.bin).toMatchObject({ bruine: "dist/bin.js", kumo: "dist/bin.js" });
  expect(composePersona("Qwen").personaPrefix).toContain("You are bruine, a terminal coding agent");
});
test("creating the new profile preserves an existing old profile", async () => {
  const home = temp(); const legacy = join(home, "profiles", "kumo");
  mkdirSync(legacy, { recursive: true }); writeFileSync(join(legacy, "cordis.patch.yml"), "# custom legacy patch\n[]\n");
  const result = await ensureProfile(home);
  expect(result.dir).toBe(join(home, "profiles", "bruine"));
  expect(readFileSync(join(legacy, "cordis.patch.yml"), "utf8")).toBe("# custom legacy patch\n[]\n");
});
