import { appEnv, configReadPath } from "../compat.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Display preference only: summaries reuse existing arguments, never a model call. */
export function toolSummariesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (appEnv("TOOL_SUMMARIES", env) === "0") return false;
  if (appEnv("TOOL_SUMMARIES", env) === "1") return true;
  if (!env.DSH_HOME) return true;
  try {
    const doc = JSON.parse(readFileSync(configReadPath(env.DSH_HOME), "utf8")) as { toolSummaries?: unknown };
    return doc?.toolSummaries !== false;
  } catch {
    return true;
  }
}

/** Use a supplied description; a subagent's first prompt line is a useful fallback. */
export function readableToolSummary(tool: string, args: Record<string, unknown> | undefined): string | undefined {
  if (!args) return undefined;
  for (const key of ["description", "title"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  if (tool === "subagent" || tool === "subagent_fork") {
    const prompt = args.prompt;
    if (typeof prompt === "string") return prompt.split(/\r?\n/).find(line => line.trim())?.trim();
  }
  return undefined;
}
