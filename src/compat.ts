import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** New environment names win, including an explicitly empty value. */
export function appEnv(suffix: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env[`BRUINE_${suffix}`] ?? env[`KUMO_${suffix}`];
}

/** Choose one application home without migrating or deleting user data. */
export function appHome(
  env: NodeJS.ProcessEnv = process.env,
  userHome: string = homedir(),
  pathMod: typeof path = path,
  exists: (file: string) => boolean = existsSync,
): string {
  const explicit = appEnv("HOME", env);
  if (explicit !== undefined) return explicit;
  const current = pathMod.join(userHome, ".bruine");
  const legacy = pathMod.join(userHome, ".kumo");
  return exists(current) ? current : exists(legacy) ? legacy : current;
}

/** Plugins honor the home the launcher already handed to dsh. */
export function runtimeHome(env: NodeJS.ProcessEnv = process.env, pathMod: typeof path = path): string {
  return appEnv("HOME", env) ?? env.DSH_HOME ?? appHome(env, homedir(), pathMod);
}

/** Read the old file only when the canonical file is absent. Writes use currentPath. */
export function compatReadPath(currentPath: string, legacyPath: string): string {
  return existsSync(currentPath) || !existsSync(legacyPath) ? currentPath : legacyPath;
}

export function configWritePath(home: string): string { return path.join(home, "bruine.json"); }
export function configReadPath(home: string): string {
  return compatReadPath(configWritePath(home), path.join(home, "kumo.json"));
}

export const SKILLS_MANIFEST_NAME = ".bruine-installed.json";
export function manifestReadPath(skillsDir: string, pathMod: typeof path = path): string {
  return compatReadPath(pathMod.join(skillsDir, SKILLS_MANIFEST_NAME), pathMod.join(skillsDir, ".kumo-installed.json"));
}
