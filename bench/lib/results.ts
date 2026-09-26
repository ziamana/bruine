/**
 * T36 — the results file: one JSONL per (date, route, variant), a header row
 * with the server's /props, then one row per run. Append-only, so a killed
 * overnight run resumes where it stopped, and the header guard keeps two
 * different server presets from ever landing in the same file.
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Persona } from "../../src/profile.js";
import type { ServerProps } from "./route.js";

export type RunStatus = "pass" | "fail" | "timeout" | "error";

export interface HeaderRow {
  kind: "header";
  /** ISO date (YYYY-MM-DD) the run started. */
  date: string;
  route: string;
  variant: string;
  variantNote?: string;
  repeat: number;
  timeoutMinutes: number;
  /** Tools catalog under test. */
  tools: string;
  /** dsh/kumo version that produced the run. */
  kumo: string;
  node: string;
  /** The persona the variant composed, for the record. */
  persona: Persona;
  /** Server facts: model, n_ctx, template hash. */
  props: ServerProps & { ok: boolean };
  /**
   * Sampler state. dsh 0.1.5-rc.3 sends no temperature/seed (the pi-ai
   * profile has no knob for it), so the bench records the absence instead of
   * pretending a run is reproducible.
   */
  sampler: { temperature: number | null; seed: number | null; fixed: boolean; note: string };
}

export interface RunRow {
  kind: "run";
  task: string;
  taskKind: string;
  repeat: number;
  status: RunStatus;
  pass: boolean;
  /** Wall-clock seconds for the kumo run (not the check). */
  wallSec: number;
  outputTokens: number | null;
  inputTokens: number | null;
  toolCalls: number | null;
  errors: string[];
  /** check.sh exit code; 70 = the check could not run here. */
  checkExit: number | null;
  /** What check.sh said it was checking (node-test, unittest, …). */
  checkMode: string;
  timedOut: boolean;
  /** Why a run has no pass/fail verdict (boot failure, unreadable log…). */
  note?: string;
}

export type ResultRow = HeaderRow | RunRow;

/** `<date>-<route>-<variant>.jsonl`; the route slug has no slashes. */
export function resultsFileName(date: string, routeSlug: string, variant: string): string {
  return `${date}-${routeSlug}-${variant}.jsonl`;
}

export function resultsPath(resultsDir: string, date: string, routeSlug: string, variant: string): string {
  return join(resultsDir, resultsFileName(date, routeSlug, variant));
}

/** Stable identity of the server preset a file describes. */
export function propsKey(header: HeaderRow): string {
  const p = header.props;
  return JSON.stringify([header.route, p.model ?? null, p.nCtx ?? null, p.templateHash ?? null]);
}

export async function readRows(path: string): Promise<ResultRow[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return [];
  }
  const rows: ResultRow[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      rows.push(JSON.parse(trimmed) as ResultRow);
    } catch {
      // a half-written last line after a kill: ignore it, the run re-runs
    }
  }
  return rows;
}

export async function readHeader(path: string): Promise<HeaderRow | undefined> {
  return (await readRows(path)).find((row): row is HeaderRow => row.kind === "header");
}

export async function readRuns(path: string): Promise<RunRow[]> {
  return (await readRows(path)).filter((row): row is RunRow => row.kind === "run");
}

/** `<task>#<repeat>` keys already recorded — what `--resume` skips. */
export function doneKeys(runs: RunRow[]): Set<string> {
  return new Set(runs.map((run) => `${run.task}#${String(run.repeat)}`));
}

/**
 * Write the header unless the file already has one. A header describing
 * another server preset is refused: mixing presets is how a benchmark lies.
 */
export async function ensureHeader(path: string, header: HeaderRow): Promise<"written" | "kept"> {
  const existing = await readHeader(path);
  if (existing !== undefined) {
    if (propsKey(existing) !== propsKey(header)) {
      throw new Error(
        `${path} already holds runs of a different server preset ` +
          `(${propsKey(existing)} ≠ ${propsKey(header)}). Use a new --results-dir ` +
          `or a different date so the two are never compared.`,
      );
    }
    return "kept";
  }
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(header)}\n`, "utf8");
  return "written";
}

export async function appendRun(path: string, row: RunRow): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(row)}\n`, "utf8");
}
