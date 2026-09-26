#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createInterface } from "node:readline";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { buildLaunch, flagMode, resolveDshEntry, runDsh } from "./launch.js";
import { ensureProfile } from "./profile.js";
import { simpleSetup, type SetupIO } from "./setup/simple.js";
import { migrateAgentsSkills } from "./setup/skills.js";
import { localDefaultRoute } from "./setup/discover.js";
import { ansi } from "./ui/theme.js";
import { BootLoader } from "./ui/boot-loader.js";
import { checkForUpdate, detectInstallKind, updateCommand } from "./update.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { name: string; version: string };

// Piping into a closed reader (`kumo --help | head`) must not print a stack.
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
});

const USAGE = `kumo: interactive terminal agent on top of DeepSeek Harness (dsh)

Usage:
  kumo [args]        Start kumo. Extra args are passed through to dsh.
  kumo setup         (Re)run the setup wizard, pre-filled with current values.
  kumo skills        List the skills kumo has enabled (name, kind, source).
  kumo update        Update kumo to the latest version (via its installer).
  kumo --version     Print the kumo version.
  kumo --help        Print this help.

Environment:
  KUMO_HOME          Override the kumo home directory (default: .kumo
                     inside your home directory).
  KUMO_ASCII=1       Use plain-ASCII glyphs instead of emoji/symbols.
  KUMO_NO_ANIMATION=1
                     No motion at all: no wordmark sweep, no waiting dots, and
                     the answer arrives whole instead of being revealed.
  KUMO_MOUSE_SELECT=0
                     Do not take the mouse: dragging selects nothing and the
                     wheel keeps scrolling the transcript. "/mouse" flips it
                     back for the rest of the session.
  KUMO_NO_UPDATE_CHECK=1
                     Never contact the npm registry for an update check.
`;

const DSH_MISSING =
  "kumo: could not launch dsh (missing or broken install). Reinstall kumo.";

/** The kumo package directory this launcher runs from, when detectable. */
function selfPackageRoot(): string | undefined {
  try {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      name?: string;
    };
    return manifest.name === pkg.name ? root : undefined;
  } catch {
    return undefined;
  }
}

/** The profile's bundle must be installed before dsh can boot it. */
function ensureBundleInstalled(
  profileDir: string,
  dshEntry: string | undefined,
  env: Record<string, string>,
): void {
  const marker = join(profileDir, "node_modules", pkg.name, "package.json");
  if (existsSync(marker)) return;

  const spec = selfPackageRoot() ?? `${pkg.name}@${pkg.version}`;
  console.log("Setting up kumo (one time)…");
  const { status, error, output } = runDsh(
    dshEntry,
    ["plugin", "--profile", "kumo", "add", spec],
    env,
    true,
  );
  if (error) {
    if (output) process.stderr.write(output);
    if (error.code === "ENOENT") console.error(DSH_MISSING);
    else console.error(`kumo: ${error.message}`);
    process.exit(1);
  }
  if (status !== 0) {
    if (output) process.stderr.write(output);
    console.error(`kumo: could not install the kumo bundle (dsh plugin exited ${status}).`);
    process.exit(1);
  }
  console.log("Ready.");
}

interface KumoJson {
  telemetry?: boolean;
  updateCheck?: boolean;
  tools?: "lean" | "full";
}

function readKumoJson(dshHome: string): KumoJson {
  try {
    return JSON.parse(readFileSync(join(dshHome, "kumo.json"), "utf8")) as KumoJson;
  } catch {
    return {};
  }
}

/**
 * T26 `kumo skills`: print the enabled skills with kind and source only —
 * never the skill content (some skills may hold server details).
 */
async function printSkills(dshHome: string): Promise<void> {
  const { readInstalledSkills } = await import("./setup/skills.js");
  const skills = await readInstalledSkills(join(dshHome, "skills"));
  if (skills.length === 0) {
    console.log("No skills enabled. Run `kumo setup` to pick skills.");
    return;
  }
  console.log(`Skills enabled in ${join(dshHome, "skills")}:`);
  for (const s of skills) {
    const kind = s.copied === true ? "linked-copy" : s.kind;
    console.log(`  ${s.name}  ${kind}${s.source !== "" ? `  ${s.source}` : ""}`);
  }
}

/**
 * T30 `kumo update`: detect how kumo was installed from the real path of the
 * running entry script, show the exact command, and run it only on an
 * explicit yes. A developer install (git checkout / link) is never touched.
 */
async function runUpdate(): Promise<void> {
  const entry = process.argv[1] ?? fileURLToPath(import.meta.url);
  let real = entry;
  try {
    real = realpathSync(entry);
  } catch {
    // already a real path, or unreadable: detect from what we have
  }
  const cmd = updateCommand(detectInstallKind(real));
  if (cmd === undefined) {
    console.log("Developer install: run git pull && pnpm build");
    return;
  }
  console.log(`kumo ${pkg.version} was installed with ${detectInstallKind(real)}.`);
  console.log(`To update, kumo runs: ${cmd.join(" ")}`);
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    console.log("kumo update needs an interactive terminal to confirm. Run the command above yourself.");
    return;
  }
  const answer = (await askLine("Update now? (y/N) ")).trim().toLowerCase();
  if (answer !== "y" && answer !== "yes") {
    console.log("kumo update: nothing changed.");
    return;
  }
  const res = spawnSync(cmd[0] as string, cmd.slice(1), {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (res.error) {
    console.error(`kumo update: ${res.error.message}`);
    return;
  }
  if (res.status !== 0) {
    console.error(`kumo update: the command exited with ${String(res.status)}.`);
    return;
  }
  // The new package.json is on disk already; report what it now says.
  let version = "unknown";
  try {
    const manifest = JSON.parse(
      readFileSync(join(dirname(real), "..", "package.json"), "utf8"),
    ) as { version?: string };
    version = manifest.version ?? "unknown";
  } catch {
    // the installer placed the package elsewhere; keep quiet about it
  }
  console.log(`kumo update: done. Now on version ${version} (was ${pkg.version}).`);
}

/** One visible line read from stdin (the update confirmation). */
function askLine(q: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolveAnswer) => {
    rl.question(q, (answer) => {
      rl.close();
      resolveAnswer(answer);
    });
  });
}

function terminalIO(): SetupIO {
  const isTTY = process.stdin.isTTY === true && process.stdout.isTTY === true;
  return {
    isTTY,
    write: (text) => void process.stdout.write(text),
    question: (q) =>
      new Promise<string>((resolveAnswer) => {
        if (!isTTY) {
          resolveAnswer("");
          return;
        }
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        rl.question(q, (answer) => {
          rl.close();
          resolveAnswer(answer);
        });
      }),
    secret: (q) => readSecret(q),
  };
}

/**
 * Read a secret without ever echoing it: raw mode, one "*" per typed char,
 * Backspace edits the value, Enter ends it, Ctrl+C exits 130, Escape cancels.
 * On a non-TTY stdin, one line is read silently instead.
 */
function readSecret(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  const stdin = process.stdin;
  if (stdin.isTTY !== true) {
    const rl = createInterface({ input: stdin, output: process.stdout });
    return new Promise<string>((resolve) => {
      rl.once("line", (line) => {
        rl.close();
        resolve(line);
      });
      rl.once("close", () => resolve(""));
    });
  }
  return new Promise<string>((resolve) => {
    const decoder = new TextDecoder("utf8");
    let value = "";
    const onData = (buf: Buffer) => {
      for (const ch of decoder.decode(buf, { stream: true })) {
        const code = ch.codePointAt(0) ?? 0;
        if (code === 13 || code === 10 || code === 27) {
          finish();
          return;
        }
        if (code === 3) {
          stdin.setRawMode(false);
          process.stdout.write("\n");
          process.exit(130);
        }
        if (code === 127 || code === 8) {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        if (code >= 32) {
          value += ch;
          process.stdout.write("*");
        }
      }
    };
    const finish = () => {
      stdin.setRawMode(false);
      stdin.removeListener("data", onData);
      stdin.pause();
      process.stdout.write("\n");
      resolve(value);
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  const flag = flagMode(argv);
  if (flag === "version") {
    console.log(`kumo ${pkg.version}`);
    process.exit(0);
  }
  if (flag === "help") {
    console.log(USAGE);
    process.exit(0);
  }

  const dshHome = process.env.KUMO_HOME ?? join(os.homedir(), ".kumo");

  if (argv[0] === "skills") {
    await printSkills(dshHome);
    process.exit(0);
  }

  if (argv[0] === "update") {
    await runUpdate();
    process.exit(0);
  }

  if (argv[0] === "setup") {
    if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
      console.error("kumo setup needs an interactive terminal.");
      process.exit(2);
    }
    const { runFullSetup, loadPrefill } = await import("./setup/full.js");
    const out = await runFullSetup(dshHome, { prefill: loadPrefill(dshHome) });
    console.log(
      out === "saved"
        ? "kumo: configuration saved."
        : out === "simple"
          ? "kumo: simple setup completed."
          : "kumo setup canceled.",
    );
    process.exit(out === "quit" ? 1 : 0);
  }

  const dshEntry = resolveDshEntry();
  const settings = readKumoJson(dshHome);

  if (!existsSync(join(dshHome, "settings.yaml"))) {
    if (process.stdin.isTTY === true && process.stdout.isTTY === true) {
      // First run in a real terminal: the product wizard (entry screen picks
      // simple or full). Files are written once, from its Save step.
      const { runFullSetup } = await import("./setup/full.js");
      const out = await runFullSetup(dshHome, {});
      if (out === "quit") {
        console.log("Setup canceled. Run `kumo setup` when ready.");
        process.exit(0);
      }
    } else {
      await simpleSetup(dshHome, terminalIO());
    }
  }
  // T31c: on a private/localhost default route the session-title request
  // races the first answer for the single slot; the launcher turns the LLM
  // title provider off and dsh falls back to the first-prompt title.
  const launchEnv = localDefaultRoute(dshHome)
    ? { ...process.env, KUMO_TITLE_LLM: "off" }
    : process.env;
  const { command, args, env } = buildLaunch(argv, launchEnv, os.homedir(), {
    dshEntry,
    telemetry: settings.telemetry,
    tools: settings.tools,
  });

  const { dir } = await ensureProfile(dshHome);
  ensureBundleInstalled(dir, dshEntry, env);

  // T26b: the .agents/skills migration must not need the wizard — an
  // existing user who upgrades and just runs `kumo` would otherwise silently
  // lose every skill (agentsHome no longer points at the user home). Runs
  // once before dsh starts; the skills manifest is the marker.
  const migrated = await migrateAgentsSkills({ homeSkillsDir: join(dshHome, "skills") });
  if (migrated.linked.length > 0) {
    const n = String(migrated.linked.length);
    const kept = `kumo: kept your ${n} skill${migrated.linked.length === 1 ? "" : "s"} from .agents/skills (manage them with kumo setup)`;
    console.log(process.stdout.isTTY === true ? ansi.dim(kept) : kept);
  }
  if (migrated.copied.length > 0) {
    console.log(
      `kumo: could not link ${String(migrated.copied.length)} of those skills; they were copied instead (sources: ${migrated.copied.join(", ")}).`,
    );
  }

  // T30: the daily update check — fire-and-forget, so the UI is never
  // delayed. The cached result drives the notice (T24 style) shown by the
  // session; gated off by kumo.json updateCheck, KUMO_NO_UPDATE_CHECK, CI,
  // or a non-TTY stdout.
  void checkForUpdate({ dshHome }).catch(() => undefined);

  const boot = new BootLoader(process.stdout, env);
  delete env.KUMO_BOOT_IPC;
  if (boot.enabled) env.KUMO_BOOT_IPC = "1";
  boot.start();
  const child = spawn(command, args, {
    env,
    stdio: boot.enabled ? ["inherit", "inherit", "inherit", "ipc"] : "inherit",
  });

  let readingBootKey = false;
  let changedRawMode = false;
  const stopReadingBootKey = (): void => {
    if (!readingBootKey) return;
    process.stdin.off("data", onBootKey);
    if (changedRawMode) process.stdin.setRawMode(false);
    process.stdin.pause();
    readingBootKey = false;
  };
  const onBootKey = (): void => {
    boot.skip();
    stopReadingBootKey();
  };
  const finishBoot = (): void => {
    stopReadingBootKey();
    boot.stop();
  };

  if (boot.enabled) {
    child.once("spawn", () => {
      boot.processSpawned();
      if (!boot.animated || process.stdin.isTTY !== true || typeof process.stdin.setRawMode !== "function") return;
      changedRawMode = process.stdin.isRaw !== true;
      if (changedRawMode) process.stdin.setRawMode(true);
      process.stdin.on("data", onBootKey);
      process.stdin.resume();
      readingBootKey = true;
    });
    child.on("message", (message: unknown) => {
      if (typeof message !== "object" || message === null || !("type" in message) || message.type !== "kumo:ui-ready") return;
      const candidate = "route" in message ? message.route : undefined;
      const route = typeof candidate === "object" && candidate !== null &&
        "model" in candidate && typeof candidate.model === "string" &&
        "host" in candidate && typeof candidate.host === "string"
        ? { model: candidate.model, host: candidate.host } : undefined;
      boot.skip();
      boot.processReady(route);
      stopReadingBootKey();
      finishBoot();
      child.send({ type: "kumo:boot-cleared" });
    });
  }

  child.on("error", (err: NodeJS.ErrnoException) => {
    finishBoot();
    if (err.code === "ENOENT") console.error(DSH_MISSING);
    else console.error(`kumo: ${err.message}`);
    process.exit(1);
  });

  child.on("close", (code, signal) => {
    finishBoot();
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error(`kumo: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
