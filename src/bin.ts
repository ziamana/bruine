import { spawn } from "node:child_process";
import os from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { buildLaunch } from "./launch.js";
import { ensureProfile } from "./profile.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const USAGE = `kumo — interactive terminal agent on top of DeepSeek Harness (dsh)

Usage:
  kumo [args]        Start kumo. Extra args are passed through to dsh.
  kumo --version     Print the kumo version.
  kumo --help        Print this help.

Environment:
  KUMO_HOME          Override the kumo home directory (default: ~/.kumo).
`;

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
  await ensureProfile(dshHome);

  const { command, args, env } = buildLaunch(argv, process.env, os.homedir());
  const child = spawn(command, args, { env, stdio: "inherit" });

  child.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") {
      console.error(
        "kumo: DeepSeek Harness (dsh) not found. Install it: npm i -g @deepseek-ai/dsh",
      );
      process.exit(1);
    }
    console.error(`kumo: ${err.message}`);
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
