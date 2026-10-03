/**
 * T36 — bruine-bench command line. Pure parsing: no fs, no process, so the
 * runner logic is unit-testable without a bruine or a model server.
 */
import { isAbsolute, resolve } from "node:path";

export interface BenchOptions {
  /** `--route provider/model`, read out of `--settings`. */
  route: string;
  /** settings.yaml the route comes from (bruine's own home by default). */
  settings: string;
  /** System-prompt variant file (bench/variants/<name>.yml). */
  variant: string;
  /** Repeats per task; local models are noisy, 3 is the floor. */
  repeat: number;
  /** Task ids (or paths) to run; empty = every task in bench/tasks. */
  tasks: string[];
  /** Skip (task, repeat) pairs already present in the results file. */
  resume: boolean;
  /** Wall-clock limit per task run, in minutes. */
  timeoutMinutes: number;
  /** bruine command (argv[0] plus fixed leading args). */
  bruine: string[];
  /** bench/tasks root. */
  tasksDir: string;
  /** Results directory. */
  resultsDir: string;
  /** Scratch root for the disposable task copies and bench homes. */
  workDir: string;
  /** Print the summary over every results file, not only this run. */
  summary: boolean;
  /** Stop after the first failing run (debugging). */
  bail: boolean;
  /** Print help instead of running. */
  help: boolean;
}

export const DEFAULTS = {
  variant: "dsh",
  repeat: 3,
  timeoutMinutes: 10,
  settings: "~/.bruine/settings.yaml",
  resultsDir: "bench/results",
  tasksDir: "bench/tasks",
} as const;

const USAGE = `bruine-bench (T36) — measure bruine's agent quality on tiny task repos.

Usage:
  pnpm bench -- --route <provider/model> [options]

Options:
  --route <provider/model>   Route to measure, read from the settings file
                             (e.g. local/ornith-9b). Required.
  --settings <path>          settings.yaml holding that route
                             (default: ~/.bruine/settings.yaml)
  --variant <name>           System-prompt variant from bench/variants
                             (default: ${DEFAULTS.variant})
  --repeat <n>               Repeats per task (default: ${DEFAULTS.repeat})
  --tasks <a,b,c>            Task ids or paths (default: every task)
  --timeout <minutes>        Wall-clock limit per run (default: ${DEFAULTS.timeoutMinutes})
  --resume                   Skip (task, repeat) pairs already in the results file
  --tasks-dir <path>         Task root (default: ${DEFAULTS.tasksDir})
  --results-dir <path>       Results root (default: ${DEFAULTS.resultsDir})
  --work-dir <path>          Scratch root for task copies + bench homes
  --bruine <cmd> [args…]       Replace the bruine command (tests use a fake)
  --bail                     Stop at the first failed run
  --no-summary               Do not print the summary table
  -h, --help                 This help

Output:
  <results-dir>/<date>-<route>-<variant>.jsonl  one row per run
  Summary table: pass rate ± spread, median wall time and output tokens.
`;

export function usage(): string {
  return USAGE;
}

/** `--tasks a,b,c` → ids; empty string / missing → "every task". */
export function parseTaskList(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "");
}

function needValue(argv: string[], i: number, flag: string): string {
  const value = argv[i + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value`);
  return value;
}

function positiveInt(value: string, flag: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${flag} needs a positive integer, got "${value}"`);
  return n;
}

/** `provider/model` — the provider key is everything before the last slash. */
export function parseRoute(value: string): { provider: string; model: string } {
  const raw = value.trim();
  if (raw === "") throw new Error("--route is empty (expected provider/model)");
  const at = raw.lastIndexOf("/");
  if (at <= 0 || at === raw.length - 1) {
    throw new Error(`--route must be provider/model, got "${raw}"`);
  }
  return { provider: raw.slice(0, at), model: raw.slice(at + 1) };
}

/** Route as it appears in a file name (`local/ornith-9b` → `local-ornith-9b`). */
export function routeSlug(route: string): string {
  return route.replace(/[/\\]+/g, "-").replace(/[^A-Za-z0-9._-]+/g, "-");
}

export interface ParseContext {
  /** Repo root; relative paths in the options resolve against it. */
  root: string;
  /** Default `--bruine` command (argv[0] + leading args). */
  bruine: string[];
  /** Default settings.yaml (bruine's own home). */
  settings: string;
}

export function parseOptions(argv: string[], ctx: ParseContext): BenchOptions {
  const out: BenchOptions = {
    route: "",
    settings: ctx.settings,
    variant: DEFAULTS.variant,
    repeat: DEFAULTS.repeat,
    tasks: [],
    resume: false,
    timeoutMinutes: DEFAULTS.timeoutMinutes,
    bruine: [...ctx.bruine],
    tasksDir: DEFAULTS.tasksDir,
    resultsDir: DEFAULTS.resultsDir,
    workDir: "",
    summary: true,
    bail: false,
    help: false,
  };
  const abs = (p: string): string => (isAbsolute(p) ? p : resolve(ctx.root, p));

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    switch (arg) {
      case "-h":
      case "--help":
        out.help = true;
        return out;
      case "--route":
        out.route = needValue(argv, i, arg);
        i++;
        break;
      case "--settings":
        out.settings = abs(needValue(argv, i, arg));
        i++;
        break;
      case "--variant":
        out.variant = needValue(argv, i, arg).trim();
        i++;
        break;
      case "--repeat":
        out.repeat = positiveInt(needValue(argv, i, arg), arg);
        i++;
        break;
      case "--tasks":
        out.tasks = parseTaskList(needValue(argv, i, arg));
        i++;
        break;
      case "--timeout":
        out.timeoutMinutes = positiveInt(needValue(argv, i, arg), arg);
        i++;
        break;
      case "--resume":
        out.resume = true;
        break;
      case "--tasks-dir":
        out.tasksDir = abs(needValue(argv, i, arg));
        i++;
        break;
      case "--results-dir":
        out.resultsDir = abs(needValue(argv, i, arg));
        i++;
        break;
      case "--work-dir":
        out.workDir = abs(needValue(argv, i, arg));
        i++;
        break;
      case "--bail":
        out.bail = true;
        break;
      case "--no-summary":
        out.summary = false;
        break;
      case "--kumo":
      case "--bruine": {
        const first = needValue(argv, i, arg);
        i++;
        const rest: string[] = [];
        while (i + 1 < argv.length && !(argv[i + 1] as string).startsWith("--")) {
          rest.push(argv[i + 1] as string);
          i++;
        }
        out.bruine = [first, ...rest];
        break;
      }
      default:
        throw new Error(`unknown option "${arg}" (try --help)`);
    }
  }
  return out;
}
