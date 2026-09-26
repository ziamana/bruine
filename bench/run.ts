#!/usr/bin/env node
/**
 * T36 — kumo-bench: measure agent quality before touching the system prompt.
 *
 * Each run: a task repo is copied to a scratch dir, kumo is launched headless
 * against a disposable KUMO_HOME holding the route under test, the wall clock
 * is capped, and the task's `check.sh` decides pass/fail. Every run appends one
 * JSONL row; the summary prints pass rate, median time and tokens per variant.
 *
 *   pnpm bench -- --route local/ornith-9b --variant dsh --tasks read-default-port,bug-range-off-by-one --repeat 1
 */
import { readFile, readdir, rm, mkdir, mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { parseOptions, parseRoute, routeSlug, usage, type BenchOptions } from "./lib/options.js";
import { buildPlan, readTaskPrompt, resolveTasks, taskKind, type PlannedRun } from "./lib/tasks.js";
import { pickRoute, readSettingsRoutes, routeKeyEnv, routeModelName, serverPropsFor } from "./lib/route.js";
import { readVariant, variantPersona } from "./lib/variant.js";
import { benchEnv, sessionsRoot, stageTask, writeBenchHome } from "./lib/home.js";
import { readRunMetrics } from "./lib/session.js";
import { logErrors, runCheck, runKumo } from "./lib/exec.js";
import { appendRun, doneKeys, ensureHeader, readRuns, resultsPath, type HeaderRow, type RunRow } from "./lib/results.js";
import { collectStats, summaryTable, variantStats } from "./lib/summary.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { name: string; version: string };

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** `~/.kumo/settings.yaml`, the file a real kumo install writes. */
function defaultSettingsPath(): string {
  const home = process.env.KUMO_HOME ?? join(homedir(), ".kumo");
  return join(home, "settings.yaml");
}

/** API key values for the route, from the user's own kumo home `.env`. */
async function routeSecrets(settingsPath: string, envName: string | undefined): Promise<Record<string, string>> {
  if (envName === undefined) return {};
  const envPath = join(dirname(settingsPath), ".env");
  if (!existsSync(envPath)) return {};
  const text = await readFile(envPath, "utf8");
  for (const line of text.split("\n")) {
    const at = line.indexOf("=");
    if (at <= 0) continue;
    if (line.slice(0, at).trim() === envName) return { [envName]: line.slice(at + 1).trim() };
  }
  return {};
}

function git(args: string[], cwd: string): void {
  spawnSync("git", args, { cwd, stdio: "ignore" });
}

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** The tool catalog every run uses (lean = the default kumo catalog). */
const BENCH_TOOLS = "lean" as const;

/** One row per run, from what the kumo run and the check produced. */
function rowFor(
  plan: PlannedRun,
  wallSec: number,
  timedOut: boolean,
  metrics: Awaited<ReturnType<typeof readRunMetrics>>,
  check: ReturnType<typeof runCheck>,
  kumoErrors: string[],
): RunRow {
  const errors = [
    ...new Set([
      ...kumoErrors,
      ...metrics.errors,
      ...(check.passed === false && check.detail !== "" ? [`check: ${check.detail}`] : []),
    ]),
  ];
  const notes = [
    ...(metrics.unreadable === undefined ? [] : [metrics.unreadable]),
    ...(check.passed === null ? [`check could not run on this machine (exit ${String(check.exitCode)})`] : []),
  ];
  const status = timedOut
    ? "timeout"
    : check.passed === true
      ? "pass"
      : check.passed === false
        ? "fail"
        : "error";
  return {
    kind: "run",
    task: plan.task.id,
    taskKind: taskKind(plan.task.id),
    repeat: plan.repeat,
    status,
    pass: check.passed === true,
    wallSec: Math.round(wallSec * 10) / 10,
    outputTokens: metrics.outputTokens,
    inputTokens: metrics.inputTokens,
    toolCalls: metrics.toolCalls,
    errors,
    checkExit: check.exitCode,
    checkMode: check.mode,
    timedOut,
    ...(notes.length > 0 ? { note: notes.join("; ") } : {}),
  };
}

async function main(): Promise<number> {
  const opts = parseOptions(process.argv.slice(2), {
    root: repoRoot,
    kumo: [process.execPath, join(repoRoot, "dist", "bin.js")],
    settings: defaultSettingsPath(),
  });
  if (opts.help || process.argv.length <= 2) {
    say(usage());
    return opts.help ? 0 : 2;
  }
  if (opts.route.trim() === "") {
    say("kumo-bench: --route <provider/model> is required (try --help).");
    return 2;
  }

  const { provider, model } = parseRoute(opts.route);
  const routes = await readSettingsRoutes(opts.settings);
  const route = pickRoute(routes, provider, model);
  const variant = await readVariant(join(repoRoot, "bench", "variants"), opts.variant);
  const modelName = routeModelName(route, model);
  const persona = variantPersona(variant, modelName);
  const tasks = await resolveTasks(opts.tasksDir, opts.tasks);
  const props = await serverPropsFor(route, model);
  const secrets = await routeSecrets(opts.settings, routeKeyEnv(route));

  const date = new Date().toISOString().slice(0, 10);
  const slug = routeSlug(opts.route);
  const file = resultsPath(opts.resultsDir, date, slug, variant.name);
  const existing = await readRuns(file);
  const done = opts.resume ? doneKeys(existing) : new Set<string>();
  const plan = buildPlan(tasks, opts.repeat, done);

  const header: HeaderRow = {
    kind: "header",
    date,
    route: opts.route,
    variant: variant.name,
    ...(variant.note !== undefined ? { variantNote: variant.note } : {}),
    repeat: opts.repeat,
    timeoutMinutes: opts.timeoutMinutes,
    tools: BENCH_TOOLS,
    kumo: `${pkg.name} ${pkg.version}`,
    node: process.version,
    persona,
    props,
    sampler: {
      temperature: null,
      seed: null,
      fixed: false,
      note: "dsh 0.1.5-rc.3 sends no temperature/seed (no knob in its pi-ai profile); repeats exist for that reason",
    },
  };
  await ensureHeader(file, header);

  say(`kumo-bench: route ${opts.route} · variant ${variant.name} · ${String(plan.length)} run(s) · ${opts.repeat} repeat(s) · ${String(opts.timeoutMinutes)} min limit`);
  say(`  model: ${modelName}`);
  say(`  server: ${props.ok ? `n_ctx ${String(props.nCtx ?? "?")}${props.templateHash === undefined ? "" : ` · template ${props.templateHash}`}` : "no /props (preset unrecorded)"}`);
  say(`  results: ${file}`);
  if (props.ok !== true) {
    say("  warning: the server did not report /props; this run cannot be compared with a differently-configured server.");
  }
  if (plan.length === 0) {
    say("  nothing to do (every requested run is already in the results file).");
    return 0;
  }

  const workRoot = opts.workDir === "" ? await mkdtemp(join(tmpdir(), "kumo-bench-")) : opts.workDir;
  await mkdir(workRoot, { recursive: true });
  const keepWork = opts.workDir !== "";
  say(`  work: ${workRoot}`);
  let stopped = false;
  for (const [index, run] of plan.entries()) {
    const slot = `${run.task.id}-r${String(run.repeat)}`;
    const taskDir = join(workRoot, "task", slot);
    const home = join(workRoot, "home", slot);
    const fakeHome = join(workRoot, "fake-home");
    await stageTask(run.task.dir, taskDir, git);
    await writeBenchHome({
      home,
      fakeHome,
      repoRoot,
      route,
      model,
      persona,
      tools: BENCH_TOOLS,
      env: secrets,
    });
    const benchEnvironment = benchEnv({ home, route, tools: BENCH_TOOLS, repoRoot, fakeHome, env: secrets });
    const logPath = join(workRoot, "logs", `${slot}.log`);
    await mkdir(dirname(logPath), { recursive: true });
    const kumoRun = await runKumo({
      command: opts.kumo,
      prompt: await readTaskPrompt(run.task),
      cwd: taskDir,
      env: benchEnvironment,
      timeoutMs: opts.timeoutMinutes * 60_000,
      logPath,
    });
    if (kumoRun.interrupted) {
      // No row: an interrupted run has no verdict, and `--resume` must redo it.
      say(`  ${slot.padEnd(28)} interrupted — not recorded; rerun with --resume`);
      stopped = true;
      break;
    }
    const metrics = await readRunMetrics(sessionsRoot(home));
    const check = runCheck(taskDir, { env: benchEnvironment });
    const kumoErrors = kumoRun.errors.length > 0 ? kumoRun.errors : await logErrors(`${logPath}.err`, 3);
    const row = rowFor(run, kumoRun.wallSec, kumoRun.timedOut, metrics, check, kumoErrors);
    await appendRun(file, row);
    const mark = row.pass ? "PASS" : row.status === "fail" ? "fail" : row.status.toUpperCase();
    say(
      `  [${String(index + 1).padStart(2, " ")}/${String(plan.length)}] ${slot.padEnd(28)} ${mark.padEnd(7)} ` +
        `${String(row.wallSec).padStart(6)}s  ${row.outputTokens === null ? "  n/a" : `${String(row.outputTokens).padStart(6)}`} tok  ` +
        `${row.toolCalls === null ? " n/a" : `${String(row.toolCalls).padStart(3)}`} tools  ${row.checkMode}` +
        (row.errors.length > 0 ? `  (${row.errors[0]})` : ""),
    );
    if (opts.bail && !row.pass) {
      stopped = true;
      say("  bail: stopping at the first run without a pass.");
      break;
    }
  }
  if (!keepWork) await rm(workRoot, { recursive: true, force: true });

  if (opts.summary) {
    const files = existsSync(opts.resultsDir)
      ? (await readdir(opts.resultsDir)).filter((f) => f.endsWith(".jsonl")).map((f) => join(opts.resultsDir, f))
      : [];
    const collected = await collectStats(files);
    say("");
    say(summaryTable(collected.map(({ header: h, runs }) => variantStats(h, runs))));
    say("");
    say("pass rate = passes/runs · spread = a task flipped between repeats · times and tokens are medians over all runs");
  }
  // 130 = interrupted (the shell's own code for SIGINT), 1 = stopped early.
  return stopped ? 130 : 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`kumo-bench: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
