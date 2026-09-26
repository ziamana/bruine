import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { formatShell, runShell, type ShellResult } from "./shell.js";

export interface VerificationCheck { label: string; command: string }
export interface VerificationResult { check: VerificationCheck; result: ShellResult }

/** Deliberately explicit: /verify runs only conventional project checks. */
export function verificationPlan(cwd: string): VerificationCheck[] {
  const packagePath = join(cwd, "package.json");
  if (existsSync(packagePath)) {
    try {
      const doc = JSON.parse(readFileSync(packagePath, "utf8")) as {
        packageManager?: string;
        scripts?: Record<string, unknown>;
      };
      const manager = doc.packageManager?.split("@")[0] ??
        (existsSync(join(cwd, "pnpm-lock.yaml")) ? "pnpm" : existsSync(join(cwd, "yarn.lock")) ? "yarn" : "npm");
      const cli = ["pnpm", "yarn", "bun", "npm"].includes(manager) ? manager : "npm";
      const checks: VerificationCheck[] = [];
      if (typeof doc.scripts?.typecheck === "string") checks.push({ label: "Typecheck", command: `${cli} run typecheck` });
      if (typeof doc.scripts?.test === "string") checks.push({ label: "Tests", command: `${cli} test` });
      return checks;
    } catch { return []; }
  }
  if (existsSync(join(cwd, "Cargo.toml"))) return [{ label: "Tests", command: "cargo test" }];
  if (existsSync(join(cwd, "go.mod"))) return [{ label: "Tests", command: "go test ./..." }];
  return [];
}

export async function runVerification(
  cwd: string,
  run: (command: string, cwd: string) => Promise<ShellResult> = (command, dir) => runShell(command, dir),
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];
  for (const check of verificationPlan(cwd)) results.push({ check, result: await run(check.command, cwd) });
  return results;
}

export function formatVerification(results: VerificationResult[]): string {
  if (results.length === 0) return "No standard checks found. Run a project command with !command.";
  const passed = results.filter(({ result }) => result.code === 0 && !result.timedOut).length;
  return [
    `Verification: ${String(passed)}/${String(results.length)} passed`,
    ...results.map(({ check, result }) => `${check.label}: ${result.code === 0 && !result.timedOut ? "passed" : "failed"}\n${formatShell(check.command, result)}`),
  ].join("\n\n");
}
