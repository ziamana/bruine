#!/usr/bin/env node
import { appHome, configReadPath } from "./compat.js";
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
import { parseFlags } from "./flags.js";
import { checkForUpdate, detectInstallKind, updateCommand } from "./update.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { name: string; version: string };

// Piping into a closed reader (`bruine --help | head`) must not print a stack.
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
});

const USAGE = `bruine: interactive terminal agent on top of DeepSeek Harness (dsh)

Usage:
  bruine [args]        Start bruine. Extra args are passed through to dsh.
  bruine setup         (Re)run the setup wizard, pre-filled with current values.
  bruine skills        List the skills bruine has enabled (name, kind, source).
  bruine --continue    Resume the latest conversation in this project.
  bruine -p "task"     Run one task and print the answer (no terminal UI).
  bruine -p -          Read the task from stdin.
  bruine -p "task" --output-format json|stream-json
  bruine -p "task" --permission-mode full
  bruine update        Update bruine to the latest version (via its installer).
  bruine --version     Print the bruine version.
  bruine --help        Print this help.

Environment:
  BRUINE_HOME          Override the bruine home directory (default: .bruine
                     inside your home directory).
  BRUINE_ASCII=1       Use plain-ASCII glyphs instead of emoji/symbols.
  BRUINE_NO_ANIMATION=1
                     No motion at all: no wordmark sweep, no waiting dots, and
                     the answer arrives whole instead of being revealed.
  BRUINE_MOUSE_SELECT=0
                     Do not take the mouse: dragging selects nothing and the
                     wheel keeps scrolling the transcript. "/mouse" flips it
                     back for the rest of the session.
  BRUINE_NO_UPDATE_CHECK=1
                     Never contact the npm registry for an update check.
`;

const DSH_MISSING =
  "bruine: could not launch dsh (missing or broken install). Reinstall bruine.";

/** The bruine package directory this launcher runs from, when detectable. */
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
  headless = false,
): void {
  const marker = join(profileDir, "node_modules", pkg.name, "package.json");
  if (existsSync(marker)) return;

  const spec = selfPackageRoot() ?? `${pkg.name}@${pkg.version}`;
  if (!headless) console.log("Setting up bruine (one time)…");
  const { status, error, output } = runDsh(
    dshEntry,
    ["plugin", "--profile", "bruine", "add", spec],
    env,
    true,
  );
  if (error) {
    if (output) process.stderr.write(output);
    if (error.code === "ENOENT") console.error(DSH_MISSING);
    else console.error(`bruine: ${error.message}`);
    process.exit(1);
  }
  if (status !== 0) {
    if (output) process.stderr.write(output);
    console.error(`bruine: could not install the bruine bundle (dsh plugin exited ${status}).`);
    process.exit(1);
  }
  if (!headless) console.log("Ready.");
}

interface BruineJson {
  telemetry?: boolean;
  updateCheck?: boolean;
  tools?: "lean" | "full";
}

function readBruineJson(dshHome: string): BruineJson {
  try {
    return JSON.parse(readFileSync(configReadPath(dshHome), "utf8")) as BruineJson;
  } catch {
    return {};
  }
}

/**
 * T26 `bruine skills`: print the enabled skills with kind and source only —
 * never the skill content (some skills may hold server details).
 */
async function printSkills(dshHome: string): Promise<void> {
  const { readInstalledSkills } = await import("./setup/skills.js");
  const skills = await readInstalledSkills(join(dshHome, "skills"));
  if (skills.length === 0) {
    console.log("No skills enabled. Run `bruine setup` to pick skills.");
    return;
  }
  console.log(`Skills enabled in ${join(dshHome, "skills")}:`);
  for (const s of skills) {
    const kind = s.copied === true ? "linked-copy" : s.kind;
    console.log(`  ${s.name}  ${kind}${s.source !== "" ? `  ${s.source}` : ""}`);
  }
}

/**
 * T30 `bruine update`: detect how bruine was installed from the real path of the
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
  console.log(`bruine ${pkg.version} was installed with ${detectInstallKind(real)}.`);
  console.log(`To update, bruine runs: ${cmd.join(" ")}`);
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    console.log("bruine update needs an interactive terminal to confirm. Run the command above yourself.");
    return;
  }
  const answer = (await askLine("Update now? (y/N) ")).trim().toLowerCase();
  if (answer !== "y" && answer !== "yes") {
    console.log("bruine update: nothing changed.");
    return;
  }
  const res = spawnSync(cmd[0] as string, cmd.slice(1), {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (res.error) {
    console.error(`bruine update: ${res.error.message}`);
    return;
  }
  if (res.status !== 0) {
    console.error(`bruine update: the command exited with ${String(res.status)}.`);
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
  console.log(`bruine update: done. Now on version ${version} (was ${pkg.version}).`);
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
    console.log(`bruine ${pkg.version}`);
    process.exit(0);
  }
  if (flag === "help") {
    console.log(USAGE);
    process.exit(0);
  }

  const dshHome = appHome();

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
      console.error("bruine setup needs an interactive terminal.");
      process.exit(2);
    }
    const { runFullSetup, loadPrefill } = await import("./setup/full.js");
    const out = await runFullSetup(dshHome, { prefill: loadPrefill(dshHome) });
    console.log(
      out === "saved"
        ? "bruine: configuration saved."
        : out === "simple"
          ? "bruine: simple setup completed."
          : out === "later"
            ? "bruine: configuration postponed. Run `bruine setup` when you’re ready."
            : "bruine setup canceled.",
    );
    process.exit(out === "quit" ? 1 : 0);
  }

  const dshEntry = resolveDshEntry();
  const settings = readBruineJson(dshHome);

  const continueRequested = argv[0] === "--continue";
  const taskArgs = continueRequested ? argv.slice(1) : argv;
  const parsed = parseFlags(taskArgs);
  if (parsed.error !== undefined) {
    console.error(`bruine: ${parsed.error}`);
    process.exit(2);
  }
  const headless = parsed.headless !== undefined;
  if (headless && continueRequested) {
    console.error("bruine: --continue cannot be combined with -p");
    process.exit(2);
  }

  if (!existsSync(join(dshHome, "settings.yaml"))) {
    if (headless) {
      console.error("bruine: run `bruine setup` before using -p");
      process.exit(2);
    }
    if (process.stdin.isTTY === true && process.stdout.isTTY === true) {
      // First run in a real terminal: the product wizard (entry screen picks
      // simple or full). Files are written once, from its Save step.
      const { runFullSetup } = await import("./setup/full.js");
      const out = await runFullSetup(dshHome, {});
      if (out === "later") {
        console.log("Setup postponed. Run `bruine setup` whenever you’re ready.");
        process.exit(0);
      }
      if (out === "quit") {
        console.log("Setup canceled. Run `bruine setup` when ready.");
        process.exit(0);
      }
    } else {
      await simpleSetup(dshHome, terminalIO());
    }
  }
  // T31c: on a private/localhost default route the session-title request
  // races the first answer for the single slot; the launcher turns the LLM
  // title provider off and dsh falls back to the first-prompt title.
  const launchEnv: NodeJS.ProcessEnv = localDefaultRoute(dshHome)
    ? { ...process.env, BRUINE_TITLE_LLM: "off" }
    : { ...process.env };
  if (continueRequested) launchEnv.BRUINE_CONTINUE = "1";
  if (headless) {
    launchEnv.BRUINE_HEADLESS = "1";
    if (parsed.permission !== undefined) launchEnv.BRUINE_PERMISSION_MODE = parsed.permission;
  }
  const forwarded = headless
    ? [...parsed.passthrough, ...parsed.headless!.prompts.flatMap((prompt) => ["-p", prompt]), "--output-format", parsed.headless!.format]
    : taskArgs;
  const { command, args, env } = buildLaunch(forwarded, launchEnv, os.homedir(), {
    dshEntry,
    telemetry: settings.telemetry,
    tools: settings.tools,
  });

  const { dir } = await ensureProfile(dshHome);
  ensureBundleInstalled(dir, dshEntry, env, headless);

  // T26b: the .agents/skills migration must not need the wizard — an
  // existing user who upgrades and just runs `bruine` would otherwise silently
  // lose every skill (agentsHome no longer points at the user home). Runs
  // once before dsh starts; the skills manifest is the marker.
  const migrated = await migrateAgentsSkills({ homeSkillsDir: join(dshHome, "skills") });
  if (migrated.linked.length > 0) {
    const n = String(migrated.linked.length);
    const kept = `bruine: kept your ${n} skill${migrated.linked.length === 1 ? "" : "s"} from .agents/skills (manage them with bruine setup)`;
    const line = process.stdout.isTTY === true ? ansi.dim(kept) : kept;
    if (headless) console.error(line); else console.log(line);
  }
  if (migrated.copied.length > 0) {
    (headless ? console.error : console.log)(
      `bruine: could not link ${String(migrated.copied.length)} of those skills; they were copied instead (sources: ${migrated.copied.join(", ")}).`,
    );
  }

  // T30: the daily update check — fire-and-forget, so the UI is never
  // delayed. The cached result drives the notice (T24 style) shown by the
  // session; gated off by bruine.json updateCheck, BRUINE_NO_UPDATE_CHECK, CI,
  // or a non-TTY stdout.
  void checkForUpdate({ dshHome }).catch(() => undefined);

  // C7: no boot drawing between the launcher and the session. The wordmark is the
  // setup welcome's, and the session's own header is two plain lines; an animated
  // mark here meant the interactive screen waited on an IPC handshake before it
  // could paint, and a terminal that never answered left the mark on screen.
  delete env.BRUINE_BOOT_IPC;
  const child = spawn(command, args, { env, stdio: "inherit" });

  child.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") console.error(DSH_MISSING);
    else console.error(`bruine: ${err.message}`);
    process.exit(1);
  });

  child.on("close", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error(`bruine: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
