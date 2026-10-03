/**
 * T36 — the bench home. One disposable `KUMO_HOME` per run: the route under
 * test, Full access mode (the task copy is disposable), no search, and the
 * variant's persona in the profile patch. Bundles are symlinked from this
 * checkout, so a run needs no network and no npm install.
 */
import { cp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { ensureProfile, type Persona } from "../../src/profile.js";
import { renderSettingsYaml } from "../../src/setup/simple.js";
import { variantPatch } from "./variant.js";
import { routeKeyEnv, routeModelName, type ProviderRoute } from "./route.js";

const require = createRequire(import.meta.url);

export interface BenchHomeOptions {
  /** Disposable home for this run (removed and rebuilt). */
  home: string;
  /** The kumo checkout: bundles are linked from here, `dist/bin.js` runs it. */
  repoRoot: string;
  route: ProviderRoute;
  /** Route model id, as spelled in the settings file. */
  model: string;
  persona: Persona;
  /** `lean` (default) or `full` tool catalog. */
  tools?: "lean" | "full";
  /** API key values for the route's `apiKeyEnv` (from the user's own .env). */
  env?: Record<string, string>;
  /**
   * An empty directory used as HOME for the run. kumo's `.agents/skills`
   * migration and anything else home-relative would otherwise change the
   * prompt (or the file system) of the machine the bench runs on.
   */
  fakeHome?: string;
}

/** The bench home as a plain object — the fs writes live in `writeBenchHome`. */
export function benchHomeSettings(
  opts: Pick<BenchHomeOptions, "route" | "model">,
): Record<string, unknown> {
  const provider = opts.route.provider;
  return {
    "llm-pi-ai": {
      // The route is copied verbatim, so the model, its compat block and its
      // context window are exactly the user's.
      providers: { [provider]: { ...opts.route.config } },
    },
    "agent-default-model": { provider, model: opts.model },
  };
}

export function benchHomeKumoJson(
  opts: Pick<BenchHomeOptions, "route" | "model">,
): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    // T16: Full access. The bench repo is a throwaway copy, and a prompt would
    // stall every run; the gate still logs what ran.
    permissionMode: "full",
    access: "full",
    search: { provider: "none" },
    updateCheck: false,
    telemetry: false,
    models: {
      main: {
        provider: opts.route.provider,
        model: opts.model,
        name: routeModelName(opts.route, opts.model),
      },
      fast: { provider: opts.route.provider, model: opts.model },
    },
  };
  return doc;
}

/**
 * Environment for one kumo run: the process environment minus every kumo/dsh
 * and credential variable, plus the bench home and this route's key only.
 * A leaked `KUMO_*` or a second route's key must not change what is measured.
 */
export function benchEnv(
  opts: Pick<BenchHomeOptions, "home" | "route" | "tools" | "repoRoot" | "env" | "fakeHome">,
  base: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    if (/(API_KEY|TOKEN|SECRET|PASSWORD|^DSH_|^KUMO_)/i.test(key)) continue;
    out[key] = value;
  }
  out["KUMO_HOME"] = opts.home;
  out["DSH_HOME"] = opts.home;
  out["DSH_TELEMETRY_DISABLED"] = "1";
  out["KUMO_NO_UPDATE_CHECK"] = "1";
  out["KUMO_NO_ANIMATION"] = "1";
  out["KUMO_ASCII"] = "1";
  // Read by the bundle patch (lean unless the bench asks for the full catalog).
  out["KUMO_TOOLS"] = opts.tools === "full" ? "full" : "lean";
  out["CI"] = "1";
  // Where check.sh finds the shared test helpers (node-tests.sh, py-tests.sh).
  out["KUMO_BENCH_TOOLS"] = join(opts.repoRoot, "bench", "tools");
  // An empty HOME: no user skills, no user settings, no .npmrc.
  if (opts.fakeHome !== undefined) {
    out["HOME"] = opts.fakeHome;
    out["USERPROFILE"] = opts.fakeHome;
  }
  // Local servers ignore the key's value; a cloud route gets the real one.
  const keyEnv = routeKeyEnv(opts.route);
  out[keyEnv ?? "KUMO_LOCAL_API_KEY"] = opts.env?.[keyEnv ?? "KUMO_LOCAL_API_KEY"] ?? "bench";
  return out;
}

/** Where dsh keeps the session log inside a bench home. */
export function sessionsRoot(home: string): string {
  return join(home, "sessions");
}

/**
 * Build (or rebuild) the bench home: settings, kumo.json, .env, the profile,
 * the variant persona, and the two bundle symlinks that let dsh boot the
 * checkout offline. `home` is removed first: nothing survives between runs.
 */
export async function writeBenchHome(opts: BenchHomeOptions): Promise<{ profileDir: string }> {
  const { home, repoRoot } = opts;
  await rm(home, { recursive: true, force: true });
  await mkdir(home, { recursive: true });

  const settings = benchHomeSettings(opts);
  await writeFile(join(home, "settings.yaml"), renderSettingsYaml(settings), "utf8");
  await writeFile(join(home, "bruine.json"), `${JSON.stringify(benchHomeKumoJson(opts), null, 2)}\n`, "utf8");
  const env = opts.env ?? {};
  const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  await writeFile(join(home, ".env"), `${lines.join("\n")}\n`, "utf8");

  // The profile: same generator the product uses, so the bench boots exactly
  // the same bundle stack.
  const { dir: profileDir } = await ensureProfile(home);
  // …then the variant persona replaces the generated persona row.
  await writeFile(join(profileDir, "cordis.patch.yml"), variantPatch(opts.persona), "utf8");

  await linkBundles(profileDir, repoRoot);
  if (opts.fakeHome !== undefined) await mkdir(opts.fakeHome, { recursive: true });
  return { profileDir };
}

/**
 * dsh needs the profile's `node_modules/<bundle>` to exist before it boots;
 * a real install would hit the network. Both bundles are symlinked to the
 * checkout's own copies (the e2e harness does the same).
 */
export async function linkBundles(profileDir: string, repoRoot: string): Promise<void> {
  const modules = join(profileDir, "node_modules");
  await mkdir(join(modules, "@deepseek-ai"), { recursive: true });
  const type = process.platform === "win32" ? "junction" : "dir";
  const own = (require(join(repoRoot, "package.json")) as { name: string }).name;
  await symlink(repoRoot, join(modules, own), type);
  const dshRequire = createRequire(require.resolve("@deepseek-ai/dsh/package.json", { paths: [repoRoot] }));
  const dshBase = dirname(dshRequire.resolve("@deepseek-ai/dsh-base/package.json"));
  await symlink(dshBase, join(modules, "@deepseek-ai", "dsh-base"), type);
}

/** Copy a task directory into a fresh scratch dir, git-initialised. */
export async function stageTask(
  taskDir: string,
  target: string,
  git: (cmd: string[], cwd: string) => void,
): Promise<string> {
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await cp(taskDir, target, {
    recursive: true,
    filter: (src) => {
      const name = basename(src);
      return name !== "node_modules" && name !== ".git";
    },
  });
  // A baseline commit lets the agent diff, and lets a trap task be checked by
  // content hash rather than by "the file is still there".
  git(["init", "-q"], target);
  git(["add", "-A"], target);
  git(["-c", "user.email=bench@kumo.invalid", "-c", "user.name=kumo-bench", "commit", "-q", "-m", "bench baseline"], target);
  return resolve(target);
}
