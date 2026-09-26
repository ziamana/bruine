/**
 * T36 — the summary table: pass rate ± spread per variant, median wall time
 * and median output tokens. Pure functions over result rows, so the numbers
 * can be checked without running a model.
 */
import { readHeader, readRuns, type HeaderRow, type RunRow } from "./results.js";

export interface VariantStats {
  variant: string;
  route: string;
  /** Distinct tasks that produced at least one run. */
  tasks: number;
  runs: number;
  passes: number;
  /** passes / runs, 0..1. */
  passRate: number;
  /**
   * The widest per-task disagreement across repeats, 0..1: 0 means every
   * repeat of every task agreed, 1 means at least one task flipped. It is the
   * noise floor a variant must beat to mean anything.
   */
  spread: number;
  /** Median wall seconds over all runs. */
  medianWallSec: number | null;
  /** Median output tokens over the runs that reported usage. */
  medianTokens: number | null;
  /** Timeouts and boot errors — not passes, not fails either. */
  broken: number;
  errors: string[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** Per-task pass rates, in first-seen order. */
export function byTask(runs: RunRow[]): Map<string, { passes: number; runs: number }> {
  const out = new Map<string, { passes: number; runs: number }>();
  for (const run of runs) {
    const entry = out.get(run.task) ?? { passes: 0, runs: 0 };
    entry.runs += 1;
    if (run.pass) entry.passes += 1;
    out.set(run.task, entry);
  }
  return out;
}

export function variantStats(header: HeaderRow, runs: RunRow[]): VariantStats {
  const perTask = byTask(runs);
  const passes = runs.filter((run) => run.pass).length;
  let spread = 0;
  for (const { passes: p, runs: r } of perTask.values()) {
    if (p > 0 && p < r) spread = 1;
  }
  const broken = runs.filter((run) => run.status === "timeout" || run.status === "error").length;
  const errors = [...new Set(runs.flatMap((run) => run.errors))].sort();
  return {
    variant: header.variant,
    route: header.route,
    tasks: perTask.size,
    runs: runs.length,
    passes,
    // Infrastructure errors (status "error") are excluded from the rate: they say
    // nothing about the model. Timeouts stay in: too slow is a real failure.
    passRate: (() => {
      const scored = runs.filter((run) => run.status !== "error").length;
      return scored === 0 ? 0 : passes / scored;
    })(),
    spread,
    medianWallSec: median(runs.map((run) => run.wallSec)),
    medianTokens: median(
      runs
        .map((run) => run.outputTokens)
        .filter((value): value is number => typeof value === "number"),
    ),
    broken,
    errors,
  };
}

function pct(value: number): string {
  return `${String(Math.round(value * 1000) / 10)}%`;
}

function seconds(value: number | null): string {
  if (value === null) return "-";
  return value < 90 ? `${String(Math.round(value * 10) / 10)}s` : `${String(Math.round(value / 60))}m`;
}

function tokens(value: number | null): string {
  return value === null ? "-" : String(Math.round(value));
}

/** Fixed-width table; the first column is the variant name. */
export function summaryTable(rows: VariantStats[]): string {
  const header = ["variant", "route", "pass rate", "spread", "median time", "median tokens", "runs", "broken"];
  const body = rows.map((row) => [
    row.variant,
    row.route,
    pct(row.passRate),
    `±${String(Math.round(row.spread * 1000) / 10)}pp`,
    seconds(row.medianWallSec),
    tokens(row.medianTokens),
    `${String(row.passes)}/${String(row.runs)}`,
    row.broken === 0 ? "-" : String(row.broken),
  ]);
  const widths = header.map((cell, i) =>
    Math.max(cell.length, ...body.map((line) => (line[i] ?? "").length), 3),
  );
  const line = (cells: string[]): string =>
    cells.map((cell, i) => cell.padEnd(widths[i] as number)).join("  ").trimEnd();
  const out = [line(header), line(widths.map((w) => "-".repeat(w)))];
  for (const cells of body) out.push(line(cells));
  return out.join("\n");
}

/** Per-task pass counts, with the reason each failure failed. */
export function taskTable(runs: RunRow[]): string {
  const lines: string[] = [];
  for (const [task, { passes, runs: n }] of byTask(runs)) {
    const failures = runs.filter((run) => run.task === task && !run.pass);
    const why = [
      ...new Set(failures.flatMap((run) => [...run.errors, run.note ?? ""].filter((x) => x !== ""))),
    ];
    lines.push(
      `  ${task.padEnd(24)} ${String(passes)}/${String(n)}${why.length > 0 ? `  ${why.join("; ")}` : ""}`,
    );
  }
  return lines.join("\n");
}

/** Read every results file, keeping the ones that have runs. */
export async function collectStats(
  files: string[],
): Promise<Array<{ header: HeaderRow; runs: RunRow[] }>> {
  const out: Array<{ header: HeaderRow; runs: RunRow[] }> = [];
  for (const file of files) {
    const header = await readHeader(file);
    if (header === undefined) continue;
    const runs = await readRuns(file);
    if (runs.length === 0) continue;
    out.push({ header, runs });
  }
  return out;
}
