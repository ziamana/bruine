#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { buildLaunch, flagMode } from "./launch.js";
import { ensureProfile } from "./profile.js";
import { simpleSetup, type SetupIO } from "./setup/simple.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { name: string; version: string };

const USAGE = `kumo — interactive terminal agent on top of DeepSeek Harness (dsh)

Usage:
  kumo [args]        Start kumo. Extra args are passed through to dsh.
  kumo --version     Print the kumo version.
  kumo --help        Print this help.

Environment:
  KUMO_HOME          Override the kumo home directory (default: ~/.kumo).
`;

const DSH_MISSING =
  "kumo: DeepSeek Harness (dsh) not found. Install it: npm i -g @deepseek-ai/dsh";

/** The kumo-cli package directory this launcher runs from, when detectable. */
function selfPackageRoot(): string | undefined {
  try {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      name?: string;
    };
    return manifest.name === "kumo-cli" ? root : undefined;
  } catch {
    return undefined;
  }
}

/** The profile's bundle must be installed before dsh can boot it. */
function ensureBundleInstalled(profileDir: string, env: Record<string, string>): void {
  const marker = join(profileDir, "node_modules", pkg.name, "package.json");
  if (existsSync(marker)) return;

  const spec = selfPackageRoot() ?? `${pkg.name}@${pkg.version}`;
  console.log(`kumo: first run — installing the kumo bundle into ${profileDir}…`);
  const result = spawnSync("dsh", ["plugin", "--profile", "kumo", "add", spec], {
    stdio: "inherit",
    env,
  });
  if (result.error) {
    if ((result.error as NodeJS.ErrnoException).code === "ENOENT") console.error(DSH_MISSING);
    else console.error(`kumo: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`kumo: could not install the kumo bundle (dsh plugin exited ${result.status}).`);
    process.exit(1);
  }
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
  const { command, args, env } = buildLaunch(argv, process.env, os.homedir());

  await simpleSetup(dshHome, terminalIO());
  const { dir } = await ensureProfile(dshHome);
  ensureBundleInstalled(dir, env);

  const child = spawn(command, args, { env, stdio: "inherit" });

  child.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") console.error(DSH_MISSING);
    else console.error(`kumo: ${err.message}`);
    process.exit(1);
  });

  child.on("close", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error(`kumo: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
