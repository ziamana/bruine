#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { buildLaunch } from "./launch.js";
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
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.includes("--version") || argv.includes("-V")) {
    console.log(`kumo ${pkg.version}`);
    process.exit(0);
  }
  if (argv.includes("--help") || argv.includes("-h")) {
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
