/**
 * T36 — bruine-bench runner tests. Everything here runs without a model server:
 * the bruine process is `bench/tools/fake-bruine.mjs`, which writes the session log
 * dsh would have written and "solves" the task the way the test asks it to.
 */
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { parseOptions, parseRoute, routeSlug, usage } from "../bench/lib/options.js";
import { buildPlan, listTasks, readTaskPrompt, resolveTasks, taskKind, type Task } from "../bench/lib/tasks.js";
import { pickRoute, readSettingsRoutes, routeKeyEnv, routeModelName } from "../bench/lib/route.js";
import { readVariant, variantPersona, variantPatch } from "../bench/lib/variant.js";
import { benchEnv, benchHomeBruineJson, benchHomeSettings, sessionsRoot, writeBenchHome } from "../bench/lib/home.js";
import { metricsFromRows, readRunMetrics, readSessionRows } from "../bench/lib/session.js";
import { appendRun, doneKeys, ensureHeader, readHeader, readRuns, resultsPath, type HeaderRow, type RunRow } from "../bench/lib/results.js";
import { summaryTable, taskTable, variantStats } from "../bench/lib/summary.js";
import { runCheck, runBruine } from "../bench/lib/exec.js";
import { composePersona, isManagedPersonaPatch, modelDisplayName, resolveModelDisplayName } from "../src/profile.js";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tasksDir = join(root, "bench", "tasks");
const variantsDir = join(root, "bench", "variants");
const fakeBruine = join(root, "bench", "tools", "fake-bruine.mjs");
/**
 * `--import` takes a specifier, not a path: a bare `D:\...` is read as a URL
 * with the scheme `d:` and node throws ERR_UNSUPPORTED_ESM_URL_SCHEME.
 */
const tsHooks = pathToFileURL(join(root, "bench", "ts-hooks.mjs")).href;

const SETTINGS = [
  "llm-pi-ai:",
  "  providers:",
  "    local:",
  "      displayName: Local Server",
  "      api: openai-completions",
  "      baseURL: http://127.0.0.1:8081/v1",
  "      apiKeyEnv: BRUINE_LOCAL_API_KEY",
  "      models:",
  "        - id: /models/ornith-9b-q4.gguf",
  "          name: Ornith 9B",
  "          contextWindow: 32768",
  "agent-default-model:",
  "  provider: local",
  "  model: /models/ornith-9b-q4.gguf",
  "",
].join("\n");

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/** Run the bench CLI end to end with the fake bruine. */
async function runBench(args: string[], env: Record<string, string> = {}): Promise<{ code: number; out: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [
        "--experimental-strip-types",
        // The bench runs from source; this is the same hook `pnpm bench` uses.
        "--import",
        tsHooks,
        join(root, "bench", "run.ts"),
        ...args,
      ],
      { cwd: root, env: { ...process.env, ...env }, timeout: 120_000 },
    );
    return { code: 0, out: `${stdout}${stderr}` };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("bench options", () => {
  const ctx = { root, bruine: ["node", "dist/bin.js"], settings: "/home/x/.bruine/settings.yaml" };

  test("defaults: dsh variant, three repeats, ten minutes", () => {
    const opts = parseOptions(["--route", "local/ornith"], ctx);
    expect(opts.variant).toBe("dsh");
    expect(opts.repeat).toBe(3);
    expect(opts.timeoutMinutes).toBe(10);
    expect(opts.tasks).toEqual([]);
    expect(opts.resume).toBe(false);
    expect(opts.bruine).toEqual(["node", "dist/bin.js"]);
  });

  test("--tasks takes a comma list, --repeat and --timeout numbers", () => {
    const opts = parseOptions(
      ["--route", "local/ornith", "--tasks", "a, b ,c", "--repeat", "2", "--timeout", "5", "--resume"],
      ctx,
    );
    expect(opts.tasks).toEqual(["a", "b", "c"]);
    expect(opts.repeat).toBe(2);
    expect(opts.timeoutMinutes).toBe(5);
    expect(opts.resume).toBe(true);
  });

  test("--bruine replaces the whole command", () => {
    const opts = parseOptions(["--route", "local/x", "--bruine", "node", "fake.mjs", "--repeat", "1"], ctx);
    expect(opts.bruine).toEqual(["node", "fake.mjs"]);
  });

  test("relative paths resolve against the repo root", () => {
    const opts = parseOptions(["--route", "local/x", "--results-dir", "out/bench"], ctx);
    expect(opts.resultsDir).toBe(join(root, "out/bench"));
  });

  test("a bad value is refused, never guessed", () => {
    expect(() => parseOptions(["--route", "local/x", "--repeat", "0"], ctx)).toThrow(/positive integer/);
    expect(() => parseOptions(["--route", "local/x", "--repeat"], ctx)).toThrow(/needs a value/);
    expect(() => parseOptions(["--nope"], ctx)).toThrow(/unknown option/);
  });

  test("--help prints the usage and stops", () => {
    expect(parseOptions(["--help"], ctx).help).toBe(true);
    expect(usage()).toContain("--route");
  });

  test("a route is provider/model, the model may contain a slash", () => {
    expect(parseRoute("local/ornith-9b")).toEqual({ provider: "local", model: "ornith-9b" });
    expect(parseRoute("local/models/ornith-9b-q4.gguf")).toEqual({
      provider: "local/models",
      model: "ornith-9b-q4.gguf",
    });
    expect(() => parseRoute("ornith")).toThrow(/provider\/model/);
    expect(routeSlug("local/ornith-9b")).toBe("local-ornith-9b");
  });
});

describe("bench tasks", () => {
  test("the set is twenty tasks in the documented mix", async () => {
    const tasks = await listTasks(tasksDir);
    expect(tasks.length).toBe(20);
    const byKind = new Map<string, number>();
    for (const task of tasks) byKind.set(taskKind(task.id), (byKind.get(taskKind(task.id)) ?? 0) + 1);
    expect(Object.fromEntries(byKind)).toEqual({
      bugfix: 6,
      feature: 4,
      refactor: 3,
      read: 3,
      shell: 2,
      trap: 2,
    });
  });

  test("every task ships a prompt and a check", async () => {
    // Same discovery as the runner: task directories only (bench/tasks/.gitignore is not a task).
    const tasks = await listTasks(tasksDir);
    expect(tasks.length).toBe(20);
    for (const task of tasks) {
      const dir = task.id;
      const prompt = await readTaskPrompt(task);
      expect(prompt.length, dir).toBeGreaterThan(20);
      expect(existsSync(join(task.dir, "check.sh")), dir).toBe(true);
    }
  });

  test("--tasks accepts ids and paths, and refuses a missing task", async () => {
    const byId = await resolveTasks(tasksDir, ["bug-range-end"]);
    expect(byId[0]?.id).toBe("bug-range-end");
    const byPath = await resolveTasks(tasksDir, [join(tasksDir, "read-default-port")]);
    expect(byPath[0]?.id).toBe("read-default-port");
    await expect(resolveTasks(tasksDir, ["nope"])).rejects.toThrow(/not found/);
  });

  test("the plan is task-major, and --resume drops finished runs", () => {
    const tasks: Task[] = [
      { id: "a", dir: "/a" },
      { id: "b", dir: "/b" },
    ];
    expect(buildPlan(tasks, 2).map((run) => run.key)).toEqual(["a#1", "a#2", "b#1", "b#2"]);
    const plan = buildPlan(tasks, 3, new Set(["a#2", "b#1"]));
    expect(plan.map((run) => run.key)).toEqual(["a#1", "a#3", "b#2", "b#3"]);
  });
});

describe("bench persona (T36: the model display name, not the file path)", () => {
  test("a settings name wins, else the id without its path and .gguf", () => {
    expect(modelDisplayName("/models/ornith-9b-q4.gguf", "Ornith 9B")).toBe("Ornith 9B");
    expect(modelDisplayName("/models/ornith-9b-q4.gguf")).toBe("ornith-9b-q4");
    expect(modelDisplayName("qwen3.8-27b")).toBe("qwen3.8-27b");
  });

  test("the persona names the model, and never a path", () => {
    const persona = composePersona("Ornith 9B");
    expect(persona.personaPrefix).toContain("powered by Ornith 9B");
    expect(persona.personaPrefix).not.toContain("{{model}}");
    expect(persona.personaSuffix).toBe("Your working directory is {{cwd}}.");
  });

  test("a name with braces is refused rather than breaking dsh interpolation", () => {
    expect(composePersona("{{model}}").personaPrefix).not.toContain("{{");
  });

  test("the display name is read from settings.yaml, and never throws", () => {
    const read = () => SETTINGS;
    expect(resolveModelDisplayName("/home/x/.bruine", read)).toBe("Ornith 9B");
    expect(resolveModelDisplayName("/home/x/.bruine", () => "{{{ not yaml")).toBeUndefined();
  });

  test("a patch the user took over is left alone", () => {
    expect(isManagedPersonaPatch("# bruine user overrides. Edit this file, not cordis.yml.\n[]\n")).toBe(true);
    expect(isManagedPersonaPatch("# bruine user overrides.\n# system-prompt row written by bruine (T36).\n")).toBe(true);
    expect(isManagedPersonaPatch("# mine\n- id: something-else\n")).toBe(false);
  });
});

describe("bench route", () => {
  test("the route is read out of a real settings.yaml", async () => {
    const dir = await tempDir("bruine-bench-settings-");
    const path = join(dir, "settings.yaml");
    await writeFile(path, SETTINGS, "utf8");
    const routes = await readSettingsRoutes(path);
    const route = pickRoute(routes, "local", "/models/ornith-9b-q4.gguf");
    expect(routeModelName(route, "/models/ornith-9b-q4.gguf")).toBe("Ornith 9B");
    expect(routeKeyEnv(route)).toBe("BRUINE_LOCAL_API_KEY");
    expect(route.config["baseURL"]).toBe("http://127.0.0.1:8081/v1");
    await rm(dir, { recursive: true, force: true });
  });

  test("an unknown provider names the ones that exist", async () => {
    const dir = await tempDir("bruine-bench-settings-");
    const path = join(dir, "settings.yaml");
    await writeFile(path, SETTINGS, "utf8");
    const routes = await readSettingsRoutes(path);
    expect(() => pickRoute(routes, "openrouter", "auto")).toThrow(/known: local/);
    await rm(dir, { recursive: true, force: true });
  });
});

describe("bench variants", () => {
  test("the baseline adds nothing, so dsh is today's prompt", async () => {
    const variant = await readVariant(variantsDir, "dsh");
    expect(variant.add).toEqual([]);
    expect(variantPersona(variant, "Ornith 9B")).toEqual(composePersona("Ornith 9B"));
  });

  test("a variant appends its lines to the persona suffix", async () => {
    const variant = await readVariant(variantsDir, "verify");
    const persona = variantPersona(variant, "Ornith 9B");
    expect(persona.personaPrefix).toBe(composePersona("Ornith 9B").personaPrefix);
    expect(persona.personaSuffix).toContain("run the project's tests");
    expect(persona.personaSuffix.indexOf("Your working directory")).toBeLessThan(
      persona.personaSuffix.indexOf("run the project's tests"),
    );
  });

  test("all is the three instructions together", async () => {
    const all = await readVariant(variantsDir, "all");
    expect(all.add.length).toBe(3);
    for (const name of ["verify", "plan", "style"]) {
      const one = await readVariant(variantsDir, name);
      expect(all.add, name).toContain(one.add[0] as string);
    }
  });

  test("the patch bruine writes carries the composed persona", async () => {
    const patch = variantPatch(variantPersona(await readVariant(variantsDir, "plan"), "Ornith 9B"));
    expect(patch).toContain("- id: system-prompt");
    expect(patch).toContain("includeHarnessIdentity: false");
    expect(patch).toContain("Ornith 9B");
    expect(patch).toContain("todo_write list");
  });
});

describe("bench home", () => {
  const route = {
    provider: "local",
    config: { baseURL: "http://127.0.0.1:8081/v1", apiKeyEnv: "BRUINE_LOCAL_API_KEY", models: [] },
  };

  test("the bench home is the route under test, in full access mode", () => {
    const settings = benchHomeSettings({ route, model: "ornith" });
    expect(settings["agent-default-model"]).toEqual({ provider: "local", model: "ornith" });
    expect((settings["llm-pi-ai"] as { providers: Record<string, unknown> }).providers["local"]).toEqual(
      route.config,
    );
    const bruineJson = benchHomeBruineJson({ route, model: "ornith" });
    expect(bruineJson["permissionMode"]).toBe("full");
    expect((bruineJson["search"] as { provider: string }).provider).toBe("none");
  });

  test("the environment is scrubbed: no inherited route, no stray bruine home", () => {
    const env = benchEnv(
      { home: "/tmp/bench-home", route, tools: "lean", repoRoot: "/repo" },
      {
        PATH: "/usr/bin",
        OPENAI_API_KEY: "secret",
        DSH_HOME: "/home/x/.dsh",
        BRUINE_HOME: "/home/x/.bruine",
        BRUINE_TOOLS: "full",
      },
    );
    expect(env["PATH"]).toBe("/usr/bin");
    expect(env["OPENAI_API_KEY"]).toBeUndefined();
    expect(env["DSH_HOME"]).toBe("/tmp/bench-home");
    expect(env["BRUINE_HOME"]).toBe("/tmp/bench-home");
    expect(env["BRUINE_TOOLS"]).toBe("lean");
    expect(env["BRUINE_BENCH_TOOLS"]).toBe(join("/repo", "bench", "tools"));
    expect(env["BRUINE_LOCAL_API_KEY"]).toBe("bench");
  });

  test("writing the home links the bundles offline and installs the variant persona", async () => {
    const home = await tempDir("bruine-bench-home-");
    await writeBenchHome({
      home,
      repoRoot: root,
      route,
      model: "ornith",
      persona: variantPersona(await readVariant(variantsDir, "style"), "Ornith 9B"),
    });
    const settings = await readFile(join(home, "settings.yaml"), "utf8");
    expect(settings).toContain("127.0.0.1:8081");
    const patch = await readFile(join(home, "profiles", "bruine", "cordis.patch.yml"), "utf8");
    expect(patch).toContain("Ornith 9B");
    expect(patch).toContain("Match the existing code style");
    expect(existsSync(join(home, "profiles", "bruine", "node_modules", "bruine", "package.json"))).toBe(true);
    expect(existsSync(join(home, "profiles", "bruine", "node_modules", "@deepseek-ai", "dsh-base", "package.json"))).toBe(true);
    await rm(home, { recursive: true, force: true });
  });
});

describe("bench session metrics", () => {
  test("tokens, tool calls and turn errors come from the durable log", () => {
    const metrics = metricsFromRows([
      { type: "turn/start", data: {} },
      { type: "tool/call", data: { callId: "a", name: "read" } },
      { type: "tool/call", data: { callId: "b", name: "bash" } },
      { type: "assistant/message", data: { usage: { inputTokens: 10, outputTokens: 20 } } },
      { type: "assistant/message", data: { usage: { inputTokens: 5, outputTokens: 7 } } },
      { type: "turn/end", data: { reason: { kind: "error", error: { code: "server_overloaded" } } } },
    ]);
    expect(metrics.outputTokens).toBe(27);
    expect(metrics.inputTokens).toBe(15);
    expect(metrics.toolCalls).toBe(2);
    expect(metrics.errors).toEqual(["error:server_overloaded"]);
  });

  test("edit calls and the ones the tool refused are counted, other tools' errors are not", () => {
    const result = (id: string, isError: boolean) => ({
      type: "tool/result",
      data: { message: { content: [{ type: "tool-result", toolCallId: id, isError }] } },
    });
    const metrics = metricsFromRows([
      { type: "tool/call", data: { callId: "e1", name: "edit" } },
      { type: "tool/call", data: { callId: "e2", name: "edit" } },
      { type: "tool/call", data: { callId: "r1", name: "read_image" } },
      { type: "tool/call", data: { callId: "b1", name: "bash" } },
      result("e1", false),
      result("e2", true),
      result("r1", true),
      result("b1", true),
    ]);
    expect(metrics.editCalls).toBe(2);
    expect(metrics.editErrors).toBe(1);
    expect(metrics.toolCalls).toBe(4);
  });

  test("a log the run never wrote yields nulls, never zeros", () => {
    const metrics = metricsFromRows([]);
    expect(metrics.editCalls).toBeNull();
    expect(metrics.outputTokens).toBeNull();
    expect(metrics.toolCalls).toBeNull();
  });

  test("a zstd log is read, a broken line is skipped", async () => {
    const home = await tempDir("bruine-bench-sessions-");
    const dir = join(home, "sessions", "--bench--", "session-1");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "v3.jsonl"),
      `${JSON.stringify({ type: "tool/call", seq: 0, data: { callId: "a", name: "read" } })}\n{ truncated\n`,
      "utf8",
    );
    const metrics = await readRunMetrics(join(home, "sessions"));
    expect(metrics.toolCalls).toBe(1);
    expect(metrics.events).toBe(1);
    const rows = await readSessionRows(join(dir, "v3.jsonl"));
    expect(rows.rows.length).toBe(1);
    await rm(home, { recursive: true, force: true });
  });

  test("no session log at all is reported, not scored", async () => {
    const home = await tempDir("bruine-bench-sessions-");
    const metrics = await readRunMetrics(sessionsRoot(home));
    expect(metrics.toolCalls).toBeNull();
    expect(metrics.unreadable).toContain("no session log");
    await rm(home, { recursive: true, force: true });
  });
});

describe("bench results", () => {
  const header = (over: Partial<HeaderRow> = {}): HeaderRow => ({
    kind: "header",
    date: "2026-09-26",
    route: "local/ornith",
    variant: "dsh",
    repeat: 1,
    timeoutMinutes: 10,
    tools: "lean",
    bruine: "bruine 0.0.1",
    node: "v22.0.0",
    persona: composePersona("Ornith 9B"),
    props: { ok: true, baseUrl: "http://127.0.0.1:8081/v1", model: "ornith", nCtx: 32768, templateHash: "abc123" },
    sampler: { temperature: null, seed: null, fixed: false, note: "dsh sends none" },
    ...over,
  });

  test("the file name carries date, route and variant", () => {
    expect(resultsPath("/r", "2026-09-26", "local-ornith", "verify")).toBe(
      join("/r", "2026-09-26-local-ornith-verify.jsonl"),
    );
  });

  test("runs on another server preset are refused, not appended", async () => {
    const dir = await tempDir("bruine-bench-results-");
    const file = resultsPath(dir, "2026-09-26", "local-ornith", "dsh");
    expect(await ensureHeader(file, header())).toBe("written");
    expect(await ensureHeader(file, header())).toBe("kept");
    const other = header({ props: { ok: true, nCtx: 4096, templateHash: "abc123", model: "ornith" } });
    await expect(ensureHeader(file, other)).rejects.toThrow(/different server preset/);
    await rm(dir, { recursive: true, force: true });
  });

  test("the header records the persona, the /props and the sampler state", async () => {
    const dir = await tempDir("bruine-bench-results-");
    const file = resultsPath(dir, "2026-09-26", "local-ornith", "plan");
    await ensureHeader(
      file,
      header({
        variant: "plan",
        persona: variantPersona(await readVariant(variantsDir, "plan"), "Ornith 9B"),
      }),
    );
    const read = await readHeader(file);
    expect(read?.props.nCtx).toBe(32768);
    expect(read?.props.templateHash).toBe("abc123");
    expect(read?.sampler.fixed).toBe(false);
    expect(read?.persona.personaSuffix).toContain("todo_write");
    await rm(dir, { recursive: true, force: true });
  });

  test("a half-written last line is ignored, so a kill loses nothing else", async () => {
    const dir = await tempDir("bruine-bench-results-");
    const file = resultsPath(dir, "2026-09-26", "local-ornith", "dsh");
    await ensureHeader(file, header());
    await appendRun(file, {
      kind: "run",
      task: "a",
      taskKind: "other",
      repeat: 1,
      status: "pass",
      pass: true,
      wallSec: 1,
      outputTokens: 2,
      inputTokens: 3,
      toolCalls: 4,
      errors: [],
      checkExit: 0,
      checkMode: "node-test",
      timedOut: false,
    });
    await writeFile(file, `${(await readFile(file, "utf8")).trimEnd()}\n{"kind":"run","tas`, "utf8");
    const runs = await readRuns(file);
    expect(runs.length).toBe(1);
    expect([...doneKeys(runs)]).toEqual(["a#1"]);
    await rm(dir, { recursive: true, force: true });
  });
});

describe("bench summary", () => {
  const header: HeaderRow = {
    kind: "header",
    date: "2026-09-26",
    route: "local/ornith",
    variant: "dsh",
    repeat: 2,
    timeoutMinutes: 10,
    tools: "lean",
    bruine: "bruine 0.0.1",
    node: "v22",
    persona: composePersona("Ornith 9B"),
    props: { ok: true, nCtx: 32768 },
    sampler: { temperature: null, seed: null, fixed: false, note: "" },
  };
  const run = (over: Partial<RunRow>): RunRow => ({
    kind: "run",
    task: "a",
    taskKind: "bugfix",
    repeat: 1,
    status: "pass",
    pass: true,
    wallSec: 10,
    outputTokens: 100,
    inputTokens: 1,
    toolCalls: 3,
    errors: [],
    checkExit: 0,
    checkMode: "node-test",
    timedOut: false,
    ...over,
  });

  test("pass rate, spread, medians", () => {
    const stats = variantStats(header, [
      run({}),
      run({ repeat: 2, pass: false, status: "fail", wallSec: 30, outputTokens: 300 }),
      run({ task: "b", wallSec: 20, outputTokens: 200 }),
      run({ task: "b", repeat: 2, wallSec: 40, outputTokens: null }),
    ]);
    expect(stats.runs).toBe(4);
    expect(stats.passes).toBe(3);
    expect(stats.passRate).toBeCloseTo(0.75);
    expect(stats.spread).toBe(1); // task "a" disagreed between its repeats
    expect(stats.medianWallSec).toBe(25);
    expect(stats.medianTokens).toBe(200);
  });

  test("a clean run reports no spread and no broken runs", () => {
    const stats = variantStats(header, [run({}), run({ repeat: 2 }), run({ task: "b" })]);
    expect(stats.spread).toBe(0);
    expect(stats.broken).toBe(0);
    expect(stats.passRate).toBe(1);
  });

  test("refused edits are summed over the runs that counted them, old result rows are left out", () => {
    const stats = variantStats(header, [
      run({ editCalls: 10, editErrors: 2 }),
      run({ repeat: 2, editCalls: 5, editErrors: 0 }),
      run({ task: "b" }),
    ]);
    expect(stats.editFails).toEqual({ errors: 2, calls: 15 });
    expect(variantStats(header, [run({})]).editFails).toBeNull();
    expect(summaryTable([stats])).toContain("2/15");
  });

  test("timeouts are neither passes nor plain failures", () => {
    const stats = variantStats(header, [run({ status: "timeout", pass: false, timedOut: true })]);
    expect(stats.broken).toBe(1);
    expect(stats.passes).toBe(0);
  });

  test("the table prints one row per variant with the numbers asked for", () => {
    const stats = variantStats(header, [run({})]);
    const table = summaryTable([stats, { ...stats, variant: "verify" }]);
    expect(table).toContain("variant");
    expect(table).toContain("pass rate");
    expect(table).toContain("median time");
    expect(table).toContain("median tokens");
    expect(table).toContain("100%");
    expect(table.split("\n")).toHaveLength(4);
  });

  test("the drill-down names the tasks that failed and why", () => {
    const text = taskTable([run({ pass: false, status: "fail", errors: ["check: 1 test failed"] })]);
    expect(text).toContain("a");
    expect(text).toContain("check: 1 test failed");
  });
});

describe("bench exec", () => {
  test("the wall clock stops a bruine that never comes back", async () => {
    const dir = await tempDir("bruine-bench-exec-");
    const log = join(dir, "run.log");
    const result = await runBruine({
      command: [process.execPath, fakeBruine],
      prompt: "do the thing",
      cwd: dir,
      env: { ...process.env, FAKE_BRUINE_HANG: "1" },
      timeoutMs: 1200,
      logPath: log,
    });
    expect(result.timedOut).toBe(true);
    expect(result.wallSec).toBeGreaterThan(1);
    expect(result.wallSec).toBeLessThan(20);
    expect(await readFile(log, "utf8")).toContain("saw a 12-char prompt");
    await rm(dir, { recursive: true, force: true });
  });

  test("a spawn that does not exist is an error, not a silent pass", async () => {
    const dir = await tempDir("bruine-bench-exec-");
    const result = await runBruine({
      command: [join(dir, "no-such-binary")],
      prompt: "x",
      cwd: dir,
      env: {},
      timeoutMs: 5000,
      logPath: join(dir, "run.log"),
    });
    expect(result.exitCode).toBeNull();
    expect(result.errors[0]).toContain("spawn failed");
    await rm(dir, { recursive: true, force: true });
  });

  test("check.sh: 0 is a pass, non-zero a failure, 70 'cannot check here'", async () => {
    const dir = await tempDir("bruine-bench-check-");
    const write = async (body: string, name = "check.sh"): Promise<string> => {
      const path = join(dir, name);
      await writeFile(path, body, "utf8");
      return path;
    };
    await write("#!/usr/bin/env sh\necho bruine-bench-check-mode: node-test\nexit 0\n");
    expect(runCheck(dir).passed).toBe(true);
    expect(runCheck(dir).mode).toBe("node-test");
    await write("#!/usr/bin/env sh\necho bruine-bench-check-mode: unittest\nexit 1\n");
    expect(runCheck(dir).passed).toBe(false);
    await write("#!/usr/bin/env sh\nexit 70\n");
    const unknown = runCheck(dir);
    expect(unknown.passed).toBeNull();
    expect(unknown.exitCode).toBe(70);
    await rm(dir, { recursive: true, force: true });
  });
});

describe("bench end to end (fake bruine)", () => {
  test("one task, one repeat: a row is written, the summary prints, --resume skips", async () => {
    const results = await tempDir("bruine-bench-e2e-results-");
    const work = await tempDir("bruine-bench-e2e-work-");
    const home = await tempDir("bruine-bench-e2e-home-");
    const settings = join(home, "settings.yaml");
    await writeFile(settings, SETTINGS, "utf8");
    const task = join(work, "task", "demo");
    await mkdir(task, { recursive: true });
    await writeFile(
      join(task, "task.md"),
      "Add a `solved.txt` file that says `done`.",
      "utf8",
    );
    await writeFile(
      join(task, "check.sh"),
      "#!/usr/bin/env sh\nset -eu\necho bruine-bench-check-mode: file-report\n[ \"$(cat solved.txt 2>/dev/null)\" = done ]\n",
      "utf8",
    );

    const args = [
      "--route",
      "local/ornith-9b-q4.gguf",
      "--settings",
      settings,
      "--variant",
      "verify",
      "--tasks",
      task,
      "--repeat",
      "1",
      "--results-dir",
      results,
      "--work-dir",
      join(work, "run"),
      "--bruine",
      process.execPath,
      fakeBruine,
    ];
    const first = await runBench([...args], { FAKE_BRUINE_SOLVE: "solved.txt", FAKE_BRUINE_CONTENT: "done" });
    expect(first.out, first.out).toContain("PASS");
    expect(first.out).toContain("verify");

    const file = resultsPath(results, new Date().toISOString().slice(0, 10), "local-ornith-9b-q4.gguf", "verify");
    const runs = await readRuns(file);
    expect(runs.length).toBe(1);
    expect(runs[0]?.pass).toBe(true);
    expect(runs[0]?.status).toBe("pass");
    expect(runs[0]?.outputTokens).toBe(1234);
    expect(runs[0]?.toolCalls).toBe(3);
    expect(runs[0]?.checkMode).toBe("file-report");
    expect(runs[0]?.wallSec).toBeGreaterThanOrEqual(0); // the fake bruine is instant
    const head = await readHeader(file);
    expect(head?.props.ok).toBe(false); // no server answered /props here
    expect(head?.variantNote).toBe("run the project's tests before saying done");
    expect(head?.persona.personaSuffix).toContain("run the project's tests");

    // A second invocation without --resume runs again; with it, nothing is left.
    const again = await runBench([...args], { FAKE_BRUINE_SOLVE: "solved.txt", FAKE_BRUINE_CONTENT: "done" });
    expect(again.out).toContain("PASS");
    expect((await readRuns(file)).length).toBe(2);

    const resumed = await runBench([...args, "--resume"], { FAKE_BRUINE_SOLVE: "solved.txt", FAKE_BRUINE_CONTENT: "done" });
    expect(resumed.out).toContain("nothing to do");
    expect((await readRuns(file)).length).toBe(2);

    // The task was copied and git-initialised in the scratch dir, not edited
    // where it lives; the bench home and its linked bundles are beside it.
    const staged = join(work, "run", "task", "demo-r1");
    expect(existsSync(join(staged, ".git"))).toBe(true);
    expect(existsSync(join(work, "run", "home", "demo-r1", "settings.yaml"))).toBe(true);
    expect(existsSync(join(task, "solved.txt"))).toBe(false);
    for (const dir of [results, work, home]) await rm(dir, { recursive: true, force: true });
    // Three full bench runs, each spawning node and a shell for check.sh: well
    // past vitest's 5s default on a Windows runner.
  }, 60_000);

  test("a bruine that fails is recorded as a failure, with its own words", async () => {
    const results = await tempDir("bruine-bench-e2e-results-");
    const home = await tempDir("bruine-bench-e2e-home-");
    const settings = join(home, "settings.yaml");
    await writeFile(settings, SETTINGS, "utf8");
    const task = join(results, "task");
    await mkdir(task, { recursive: true });
    await writeFile(join(task, "task.md"), "do it", "utf8");
    await writeFile(join(task, "check.sh"), "#!/usr/bin/env sh\nexit 1\n", "utf8");

    const out = await runBench(
      [
        "--route",
        "local/ornith-9b-q4.gguf",
        "--settings",
        settings,
        "--tasks",
        task,
        "--repeat",
        "1",
        "--results-dir",
        results,
        "--work-dir",
        join(results, "run"),
        "--bruine",
        process.execPath,
        fakeBruine,
      ],
      { FAKE_BRUINE_ERROR: "1" },
    );
    expect(out.out).toContain("fail");
    const file = resultsPath(results, new Date().toISOString().slice(0, 10), "local-ornith-9b-q4.gguf", "dsh");
    const runs = await readRuns(file);
    expect(runs[0]?.pass).toBe(false);
    expect(runs[0]?.errors.join(" ")).toContain("fake_error");
    for (const dir of [results, home]) await rm(dir, { recursive: true, force: true });
  });

  // On Windows child.kill("SIGINT") ends the process without running its
  // handler, so the interruption cannot be simulated here; a real Ctrl+C in a
  // Windows console still reaches node's SIGINT handler.
  test.skipIf(process.platform === "win32")("an interrupted run is recorded as nothing, so --resume redoes it", async () => {
    const results = await tempDir("bruine-bench-int-results-");
    const home = await tempDir("bruine-bench-int-home-");
    const settings = join(home, "settings.yaml");
    await writeFile(settings, SETTINGS, "utf8");
    const task = join(results, "task");
    await mkdir(task, { recursive: true });
    await writeFile(join(task, "task.md"), "take your time", "utf8");
    await writeFile(join(task, "check.sh"), "#!/usr/bin/env sh\nexit 0\n", "utf8");
    const args = [
      "--route", "local/ornith-9b-q4.gguf",
      "--settings", settings,
      "--tasks", task,
      "--repeat", "1",
      "--timeout", "5",
      "--results-dir", results,
      "--work-dir", join(results, "run"),
      "--bruine", process.execPath, fakeBruine,
    ];
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", "--import", tsHooks, join(root, "bench", "run.ts"), ...args],
      { cwd: root, env: { ...process.env, FAKE_BRUINE_HANG: "1" } },
    );
    let out = "";
    child.stdout.on("data", (d) => { out += String(d); });
    child.stderr.on("data", (d) => { out += String(d); });
    // Interrupt while the fake bruine is still working.
    await new Promise((r) => setTimeout(r, 1500));
    child.kill("SIGINT");
    const code = await new Promise((r) => child.on("close", (c) => r(c)));
    expect(code).toBe(130);
    expect(out).toContain("interrupted");
    const file = resultsPath(results, new Date().toISOString().slice(0, 10), "local-ornith-9b-q4.gguf", "dsh");
    expect(await readHeader(file)).toBeDefined();
    expect(await readRuns(file)).toEqual([]);
    for (const dir of [results, home]) await rm(dir, { recursive: true, force: true });
  });

  test("an unknown route stops before anything runs", async () => {
    const home = await tempDir("bruine-bench-e2e-home-");
    const settings = join(home, "settings.yaml");
    await writeFile(settings, SETTINGS, "utf8");
    const out = await runBench([
      "--route",
      "openrouter/auto",
      "--settings",
      settings,
      "--repeat",
      "1",
    ]);
    expect(out.code).not.toBe(0);
    expect(out.out).toContain("known: local");
    await rm(home, { recursive: true, force: true });
  });
});

describe("BOS review of the first real run (2026-09-26)", () => {
  test("route alias: local/ornith resolves to the one matching model id", async () => {
    const { pickRoute } = await import("../bench/lib/route.js");
    const models = [{ id: "/m/Ornith-1.5-9B.gguf", name: "Ornith 1.5 9B" }, { id: "/m/Qwen3.8-27B.gguf" }];
    const routes = { providers: { local: {} }, defaultRoute: undefined, modelsOf: () => models } as any;
    expect(pickRoute(routes, "local", "ornith").modelId).toBe("/m/Ornith-1.5-9B.gguf");
    expect(pickRoute(routes, "local", "/m/Qwen3.8-27B.gguf").modelId).toBe("/m/Qwen3.8-27B.gguf");
    expect(() => pickRoute(routes, "local", "gguf")).toThrow(/several/);
    expect(() => pickRoute(routes, "local", "llama")).toThrow(/no model/);
  });
  test("infrastructure errors are excluded from the pass rate", async () => {
    const { variantStats } = await import("../bench/lib/summary.js");
    const row = (task: string, status: string, pass: boolean) => ({ kind: "run", task, repeat: 1, status, pass, wallSec: 1, outputTokens: 10, toolCalls: 1, errors: [] }) as any;
    const s = variantStats({ variant: "dsh", route: "local/x" } as any, [row("a", "pass", true), row("b", "error", false), row("c", "fail", false)]);
    expect(s.passRate).toBe(0.5);
    expect(s.broken).toBe(1);
  });
});
