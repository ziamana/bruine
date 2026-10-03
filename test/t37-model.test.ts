/**
 * T37/T38/T39 — `/model`, `/provider`, the route switch and the details that
 * make it honest: the picker reads dsh's own catalogue, the switch reaches the
 * next request through dsh's selection ref, and a route that settings.yaml
 * never declared is accepted but announced.
 */
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { providerLine as providerLineOf } from "../src/plugins/model.js";

const SETTINGS = [
  "llm-pi-ai:",
  "  providers:",
  "    local:",
  "      displayName: Local Server",
  "      api: openai-completions",
  "      baseURL: 'http://127.0.0.1:8081/v1'",
  "      apiKeyEnv: BRUINE_LOCAL_API_KEY",
  "      models:",
  "        - id: 'Ornith.gguf'",
  "          name: 'Ornith 1.5 9B'",
  "          contextWindow: 100096",
  "        - id: 'qwen3.8-27b'",
  "          contextWindow: 32768",
  "    openrouter:",
  "      apiKeyEnv: OPENROUTER_API_KEY",
  "      models:",
  "        - id: 'qwen/qwen3-32b'",
  "agent-default-model:",
  "  provider: 'local'",
  "  model: 'Ornith.gguf'",
  "",
].join("\n");

interface H {
  picker: any;
  holder: { current?: { provider: string; model: string; reasoningEffort?: string } };
  notices: string[];
  footerState: Record<string, unknown>;
  headerResets: number;
  saved: Array<{ provider: string; model: string }>;
  asked: Array<{ title: string; items: Array<{ value: string; label: string }>; initial?: number }>;
  /** Index the fake askChoice returns, per call. */
  picks: number[];
  ui: Record<string, unknown>;
  llm: Record<string, unknown>;
  effort: { adopted: string[]; adoptRoute(p: string, m: string): Promise<void> };
  keyListener?: (data: string) => { consume?: boolean } | void;
}

function harness(opts: { picks?: number[]; models?: Record<string, Array<{ id: string; name?: string }>> } = {}): H {
  const holder: H["holder"] = { current: { provider: "local", model: "Ornith.gguf" } };
  const notices: string[] = [];
  const footerState: Record<string, unknown> = {};
  const saved: Array<{ provider: string; model: string }> = [];
  const asked: H["asked"] = [];
  const h: H = {
    picker: undefined,
    holder,
    notices,
    footerState,
    headerResets: 0,
    saved,
    asked,
    picks: opts.picks ?? [],
    ui: {},
    llm: {},
    effort: {
      adopted: [],
      adoptRoute: async function (this: { adopted: string[] }, p: string, m: string) {
        this.adopted.push(`${p}/${m}`);
      },
    },
  };
  let keyListener: ((data: string) => { consume?: boolean } | void) | undefined;
  h.ui = {
    askChoice: async (title: string, items: Array<{ value: string; label: string }>, o?: { initial?: number }) => {
      asked.push({ title, items, ...(o?.initial !== undefined ? { initial: o.initial } : {}) });
      return h.picks.shift() ?? -1;
    },
    showNotice: (t: string) => notices.push(t),
    footer: { set: (n: Record<string, unknown>) => Object.assign(footerState, n) },
    requestRender: () => {},
    resetRouteCache: () => {
      h.headerResets += 1;
    },
    tui: {
      addInputListener: (fn: (data: string) => { consume?: boolean } | void) => {
        keyListener = fn;
        return () => {};
      },
    },
  };
  Object.defineProperty(h, "keyListener", { get: () => keyListener });
  const catalog = opts.models ?? {
    local: [
      { id: "Ornith.gguf" },
      { id: "qwen3.8-27b" },
      { id: "loaded-only-model" },
    ],
    openrouter: [{ id: "qwen/qwen3-32b" }],
  };
  h.llm = {
    listProviders: () => [
      { id: "local", name: "Local Server" },
      { id: "openrouter", name: "OpenRouter" },
    ],
    listConfigurableProviders: () => [
      { provider: "deepseek-official", displayName: "DeepSeek" },
      { provider: "openrouter", displayName: "OpenRouter" },
    ],
    listModels: async (provider: string) => catalog[provider] ?? [],
    resolveModelInfo: async (provider: string, model: string) => ({
      // settings.yaml wins where it declared a window; this fills the blanks.
      context: { contextWindow: model === "qwen3.8-27b" ? 8192 : 0 },
      reasoning: { efforts: [{ id: "off" }, { id: "medium" }] },
      provider,
    }),
  };
  return h;
}

async function attach(h: H, opts: { env?: string; settings?: string } = {}): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "bruine-t37-"));
  await mkdir(home, { recursive: true });
  process.env.DSH_HOME = home;
  if (opts.settings !== undefined) await writeFile(join(home, "settings.yaml"), opts.settings);
  if (opts.env !== undefined) await writeFile(join(home, ".env"), opts.env);
  const { ModelPicker } = await import("../src/plugins/model.js");
  h.picker = new ModelPicker();
  await h.picker.attach({ agent: {}, selection: h.holder, ui: h.ui } as never, h.llm as never, {
    saveSelection: async (next: { provider: string; model: string }) => {
      h.saved.push(next);
    },
  });
  h.picker.setEffort(h.effort as never);
  return home;
}

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.DSH_HOME;
});

describe("route arguments (T37)", () => {
  test("the provider is the longest known prefix, so a model id may hold slashes", async () => {
    const { parseRouteArg } = await import("../src/plugins/model.js");
    expect(parseRouteArg("local/qwen3.8-27b", ["local", "openrouter"])).toEqual({
      provider: "local",
      model: "qwen3.8-27b",
    });
    expect(parseRouteArg("openrouter/qwen/qwen3-32b", ["local", "openrouter"])).toEqual({
      provider: "openrouter",
      model: "qwen/qwen3-32b",
    });
    // "open" must not shadow a longer provider id.
    expect(parseRouteArg("openrouter/x", ["open", "openrouter"])).toEqual({ provider: "openrouter", model: "x" });
    expect(parseRouteArg("openrouter", ["openrouter"])).toEqual({ provider: "openrouter", model: "" });
    expect(parseRouteArg("  ", ["local"])).toBeUndefined();
    // Unknown provider: split at the first slash so the refusal names it.
    expect(parseRouteArg("nope/x", ["local"])).toEqual({ provider: "nope", model: "x" });
  });

  test("routeKey is the inverse", async () => {
    const { routeKey, parseRouteArg } = await import("../src/plugins/model.js");
    const ref = { provider: "openrouter", model: "qwen/qwen3-32b" };
    expect(parseRouteArg(routeKey(ref), ["openrouter"])).toEqual(ref);
  });
});

describe("provider rows (T39)", () => {
  test("live providers first, each merged with settings.yaml", async () => {
    const { buildProviderRows } = await import("../src/plugins/model.js");
    const rows = buildProviderRows(
      {
        listProviders: () => [
          { id: "local", name: "Local Server" },
          { id: "openrouter", name: "OpenRouter" },
        ],
        listConfigurableProviders: () => [{ provider: "deepseek-official", displayName: "DeepSeek" }],
      },
      [
        { id: "local", displayName: "Local Server", baseUrl: "http://127.0.0.1:8081/v1", apiKeyEnv: "BRUINE_LOCAL_API_KEY", models: [{ id: "Ornith.gguf" }] },
        { id: "openrouter", apiKeyEnv: "OPENROUTER_API_KEY", models: [{ id: "qwen/qwen3-32b" }] },
      ],
    );
    expect(rows.map((r) => r.id)).toEqual(["local", "openrouter"]);
    expect(rows[0]).toMatchObject({ live: true, label: "Local Server", baseUrl: "http://127.0.0.1:8081/v1", apiKeyEnv: "BRUINE_LOCAL_API_KEY" });
  });

  // The measured reason the dormant directory is opt-in: pi-ai ships ~60 of them.
  test("dormant providers stay out of the picker unless asked for", async () => {
    const { buildProviderRows, dormantCount } = await import("../src/plugins/model.js");
    const llm = {
      listProviders: () => [{ id: "local", name: "Local Server" }],
      listConfigurableProviders: () => [
        { provider: "deepseek-official", displayName: "DeepSeek" },
        { provider: "openai", displayName: "OpenAI" },
        { provider: "local" },
      ],
    };
    const settings = [{ id: "local", models: [{ id: "Ornith.gguf" }] }];
    expect(buildProviderRows(llm, settings).map((r) => r.id)).toEqual(["local"]);
    expect(buildProviderRows(llm, settings, true).map((r) => r.id)).toEqual(["local", "deepseek-official", "openai"]);
    // "local" is already known, so it is not counted twice.
    expect(dormantCount(llm, ["local"])).toBe(2);
    expect(dormantCount({ listConfigurableProviders: () => { throw new Error("no directory"); } }, [])).toBe(0);
  });

  test("a settings.yaml provider is offered even when dsh has not mounted it", async () => {
    const { buildProviderRows } = await import("../src/plugins/model.js");
    const rows = buildProviderRows({ listProviders: () => [] }, [{ id: "local-2", models: [{ id: "m" }] }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "local-2", live: false });
  });

  test("a configuration diagnostic dsh reports is carried on the row", async () => {
    const { buildProviderRows } = await import("../src/plugins/model.js");
    const rows = buildProviderRows(
      { listProviders: () => [], listConfigurableProviders: () => [{ provider: "openai", displayName: "OpenAI", error: "missing apiKeyEnv" }] },
      [],
      true,
    );
    expect(rows[0]).toMatchObject({ label: "OpenAI", error: "missing apiKeyEnv" });
    expect(providerLineOf(rows[0]!, undefined, false)).toContain("missing apiKeyEnv");
  });

  test("a runtime that throws is not a crash", async () => {
    const { buildProviderRows } = await import("../src/plugins/model.js");
    const rows = buildProviderRows(
      {
        listProviders: () => {
          throw new Error("no runtime");
        },
        listConfigurableProviders: () => {
          throw new Error("no directory");
        },
      },
      [{ id: "local", models: [] }],
    );
    expect(rows.map((r) => r.id)).toEqual(["local"]);
  });

  test("the /provider line says endpoint, key state, model count and the current route", async () => {
    const { providerLine } = await import("../src/plugins/model.js");
    const row = {
      id: "local",
      label: "Local Server",
      live: true,
      baseUrl: "http://127.0.0.1:8081/v1",
      apiKeyEnv: "BRUINE_LOCAL_API_KEY",
      models: [{ id: "a" }, { id: "b" }],
    };
    const line = providerLine(row, { provider: "local", model: "a" }, true);
    expect(line).toContain("(current route)");
    expect(line).toContain("http://127.0.0.1:8081/v1");
    expect(line).toContain("key BRUINE_LOCAL_API_KEY set");
    expect(line).toContain("2 model(s)");
    expect(providerLine(row, undefined, false)).toContain("no BRUINE_LOCAL_API_KEY");
    expect(providerLine({ id: "deepseek-official", label: "DeepSeek", live: false, models: [] }, undefined, false)).toContain(
      "not configured",
    );
  });

  test("`/provider` lists every provider and never writes anything", async () => {
    const h = harness();
    const home = await attach(h, { settings: SETTINGS, env: "BRUINE_LOCAL_API_KEY=e2e\n" });
    const before = await readFile(join(home, "settings.yaml"), "utf8");
    const out = h.picker.runProviderCommand();
    expect(out).toContain("Providers (2):");
    expect(out).toContain("Local Server [local] (current route)");
    expect(out).toContain("http://127.0.0.1:8081/v1");
    expect(out).toContain("key BRUINE_LOCAL_API_KEY set");
    expect(out).toContain("no OPENROUTER_API_KEY");
    // The dormant directory is counted, not dumped.
    expect(out).toContain("+ 1 more bruine can add");
    expect(out).toContain("/provider all lists them");
    expect(out).toContain("In use: local/Ornith.gguf");
    expect(await readFile(join(home, "settings.yaml"), "utf8")).toBe(before);
    // `/provider all` is the full list, dormant routes included.
    const all = h.picker.runProviderCommand("/provider all");
    expect(all).toContain("DeepSeek [deepseek-official] · not configured");
  });

  test("a key in the process environment counts as set", async () => {
    const h = harness();
    await attach(h, { settings: SETTINGS });
    vi.stubEnv("OPENROUTER_API_KEY", "sk-test");
    expect(h.picker.runProviderCommand()).toContain("key OPENROUTER_API_KEY set");
  });
});

describe("model rows (T37)", () => {
  // Measured on the real harness: dsh-llm-pi-ai `modelOf()` throws
  // UNKNOWN_MODEL for a pair the profile does not configure, so an undeclared
  // model can never be dispatched. Only declared models are offered.
  test("only declared models are offered; the rest are reported, not offered", async () => {
    const { buildModelRows } = await import("../src/plugins/model.js");
    const out = buildModelRows(
      [
        { id: "Ornith.gguf", name: "Ornith 1.5 9B", contextWindow: 100096 },
        { id: "qwen3.8-27b", contextWindow: 32768 },
      ],
      [{ id: "qwen3.8-27b" }, { id: "loaded-only-model" }],
      { provider: "local", model: "qwen3.8-27b" },
    );
    expect(out.rows.map((r) => r.id)).toEqual(["Ornith.gguf", "qwen3.8-27b"]);
    expect(out.rows[1]).toMatchObject({ current: true });
    expect(out.undeclared).toEqual(["loaded-only-model"]);
  });

  test("the label is the pretty name, the window, then the marker", async () => {
    const { modelRowLabel } = await import("../src/plugins/model.js");
    expect(modelRowLabel({ id: "Ornith.gguf", name: "Ornith 1.5 9B", contextWindow: 100096, current: true })).toBe(
      "Ornith 1.5 9B 100k ctx (current)",
    );
    expect(modelRowLabel({ id: "/m/Ornith.gguf", current: false })).toBe("Ornith");
  });

  test("the adapter's own window fills in for a declared model settings.yaml left blank", async () => {
    const h = harness();
    // Same document as SETTINGS, but qwen3.8-27b declares no window.
    await attach(h, {
      settings: SETTINGS.split("\n")
        .filter((line) => !line.includes("contextWindow: 32768"))
        .join("\n"),
    });
    const out = await h.picker.modelRows("local");
    expect(out.rows.find((r: { id: string }) => r.id === "qwen3.8-27b")?.contextWindow).toBe(8192);
  });

  test("a dead server leaves the declared models on offer", async () => {
    const h = harness();
    await attach(h, { settings: SETTINGS });
    h.llm.listModels = async () => {
      throw new Error("ECONNREFUSED");
    };
    const out = await h.picker.modelRows("local");
    expect(out.rows.map((r: { id: string }) => r.id)).toEqual(["Ornith.gguf", "qwen3.8-27b"]);
    expect(out.undeclared).toEqual([]);
  });

  test("a server model bruine never recorded is named, with the fix in one command", async () => {
    const h = harness({ picks: [0, 0] });
    await attach(h, { settings: SETTINGS });
    await h.picker.runCommand("/model");
    expect(h.notices.join("\n")).toContain(
      "Local Server also serves 1 model(s) bruine has not recorded (loaded-only-model): run bruine setup",
    );
  });
});

describe("the picker (T37)", () => {
  test("provider then model; the current one is marked and the cursor starts there", async () => {
    const h = harness({ picks: [0, 1] });
    await attach(h, { settings: SETTINGS });
    const reply = await h.picker.runCommand("/model");
    expect(h.asked).toHaveLength(2);
    expect(h.asked[0]!.title).toBe("Model · provider");
    expect(h.asked[0]!.initial).toBe(0);
    expect(h.asked[0]!.items[0]!.label).toContain("(current route)");
    expect(h.asked[1]!.title).toBe("Model · Local Server");
    expect(h.asked[1]!.items.map((i) => i.label)).toEqual([
      "Ornith 1.5 9B 100k ctx (current)",
      "qwen3.8-27b 33k ctx",
    ]);
    expect(reply).toContain("Model: qwen3.8-27b (local)");
  });

  test("escape at the first step changes nothing", async () => {
    const h = harness({ picks: [-1] });
    await attach(h, { settings: SETTINGS });
    expect(await h.picker.runCommand("/model")).toBe("Model: unchanged.");
    expect(h.saved).toEqual([]);
    expect(h.holder.current).toEqual({ provider: "local", model: "Ornith.gguf" });
  });

  test("escape at the model step changes nothing", async () => {
    const h = harness({ picks: [0, -1] });
    await attach(h, { settings: SETTINGS });
    expect(await h.picker.runCommand("/model")).toBe("Model: unchanged.");
    expect(h.holder.current?.model).toBe("Ornith.gguf");
  });

  test("picking the model already in use is a no-op, not a rewrite", async () => {
    const h = harness({ picks: [0, 0] });
    await attach(h, { settings: SETTINGS });
    expect(await h.picker.runCommand("/model")).toContain("unchanged");
    expect(h.saved).toEqual([]);
  });

  test("a declared route dsh has not mounted points at bruine setup", async () => {
    const h = harness({ picks: [2] }); // local-2, the unmounted one
    // settings.yaml declares a second route the runtime never mounted.
    await attach(h, {
      settings: [
        "llm-pi-ai:",
        "  providers:",
        "    local:",
        "      displayName: Local Server",
        "      models:",
        "        - id: 'Ornith.gguf'",
        "    local-2:",
        "      displayName: Spare",
        "      models:",
        "        - id: 'other'",
        "agent-default-model:",
        "  provider: 'local'",
        "  model: 'Ornith.gguf'",
        "",
      ].join("\n"),
    });
    expect(h.picker.providerRows().map((r: { id: string }) => r.id)).toEqual(["local", "openrouter", "local-2"]);
    const reply = await h.picker.runCommand("/model");
    expect(reply).toBe("Spare is not configured yet. Run bruine setup to add it.");
    expect(h.asked).toHaveLength(1);
  });

  test("a live provider with no model configured points at bruine setup", async () => {
    const h = harness({ picks: [0] });
    await attach(h, { settings: "llm-pi-ai:\n  providers: {}\n" });
    const reply = await h.picker.runCommand("/model");
    expect(reply).toBe("Local Server has no model configured. Run bruine setup.");
  });

  test("with no askChoice (non-TTY) the same facts come back as text", async () => {
    const h = harness();
    await attach(h, { settings: SETTINGS });
    h.ui = { ...h.ui, askChoice: undefined };
    await h.picker.attach({ agent: {}, selection: h.holder, ui: h.ui } as never, h.llm as never, undefined);
    const out = await h.picker.runCommand("/model");
    expect(out).toContain("Providers:");
    expect(out).toContain("Local Server [local] (current route)");
    expect(out).toContain('Use "/model <provider>/<model>" to switch.');
  });

  test("no provider at all points at bruine setup", async () => {
    const h = harness();
    await attach(h, { settings: "agent-default-model:\n  provider: local\n  model: m\n" });
    h.llm.listProviders = () => [];
    h.llm.listConfigurableProviders = () => [];
    expect(await h.picker.runCommand("/model")).toBe("No provider is configured. Run bruine setup.");
    expect(h.picker.runProviderCommand()).toBe("No provider is configured. Run bruine setup.");
  });
});

describe("the switch (T37)", () => {
  test("/model <provider>/<model> sets the route without a picker", async () => {
    const h = harness();
    await attach(h, { settings: SETTINGS });
    const reply = await h.picker.runCommand("/model local/qwen3.8-27b");
    expect(h.asked).toEqual([]);
    expect(h.holder.current).toEqual({ provider: "local", model: "qwen3.8-27b" });
    expect(h.saved).toEqual([{ provider: "local", model: "qwen3.8-27b" }]);
    expect(reply).toBe("Model: qwen3.8-27b (local) · next message");
  });

  test("an unknown provider is refused, naming what is configured", async () => {
    const h = harness();
    await attach(h, { settings: SETTINGS });
    const reply = await h.picker.runCommand("/model grok/x");
    expect(reply).toContain('Unknown provider "grok"');
    expect(reply).toContain("local, openrouter");
    expect(h.holder.current?.model).toBe("Ornith.gguf");
  });

  test("a bare provider name asks for a model instead of guessing", async () => {
    const h = harness();
    await attach(h, { settings: SETTINGS });
    expect(await h.picker.runCommand("/model local")).toContain('Pick a model on local');
  });

  test("a model the route never declared is refused, not offered as a broken switch", async () => {
    const h = harness();
    await attach(h, { settings: SETTINGS });
    const reply = await h.picker.runCommand("/model local/loaded-only-model");
    expect(h.holder.current).toEqual({ provider: "local", model: "Ornith.gguf" });
    expect(h.saved).toEqual([]);
    expect(reply).toBe('Model "loaded-only-model" is not configured on local. Run bruine setup to record it.');
  });

  test("the footer follows the route: pretty name, window, and a cleared context", async () => {
    const h = harness();
    await attach(h, { settings: SETTINGS });
    h.footerState.contextUsed = 4321;
    h.footerState.modelName = "Ornith 1.5 9B";
    h.footerState.contextWindow = 100096;
    await h.picker.runCommand("/model local/qwen3.8-27b");
    expect(h.footerState).toMatchObject({
      model: "qwen3.8-27b",
      provider: "local",
      modelName: undefined,
      contextWindow: 32768,
      contextUsed: 0,
    });
    await h.picker.runCommand("/model local/Ornith.gguf");
    expect(h.footerState).toMatchObject({ modelName: "Ornith 1.5 9B", contextWindow: 100096 });
  });

  test("the memoized header host is dropped on every switch", async () => {
    const h = harness();
    await attach(h, { settings: SETTINGS });
    await h.picker.runCommand("/model local/qwen3.8-27b");
    expect(h.headerResets).toBe(1);
  });

  test("the effort plugin is handed the new route so its levels are not stale", async () => {
    const h = harness();
    await attach(h, { settings: SETTINGS });
    await h.picker.runCommand("/model local/qwen3.8-27b");
    expect(h.effort.adopted).toEqual(["local/qwen3.8-27b"]);
  });

  test("a live effort survives a switch to a model that offers it, and is dropped otherwise", async () => {
    const h = harness();
    await attach(h, { settings: SETTINGS });
    h.holder.current = { provider: "local", model: "Ornith.gguf", reasoningEffort: "medium" };
    // Same levels for both models: the choice carries over.
    await h.picker.runCommand("/model local/qwen3.8-27b");
    expect(h.holder.current?.reasoningEffort).toBe("medium");
    // A route with no thinking switch must not inherit the effort.
    h.llm.resolveModelInfo = async () => ({ context: { contextWindow: 4096 } });
    await h.picker.runCommand("/model openrouter/qwen/qwen3-32b");
    expect(h.holder.current).toEqual({ provider: "openrouter", model: "qwen/qwen3-32b" });
    expect(h.holder.current?.reasoningEffort).toBeUndefined();
  });

  test("both the route taken and the one left are remembered, other keys kept", async () => {
    const h = harness();
    const home = await attach(h, { settings: SETTINGS });
    await writeFile(join(home, "bruine.json"), JSON.stringify({ permissionMode: "ask" }));
    await h.picker.runCommand("/model local/qwen3.8-27b");
    await h.picker.persisted;
    const doc = JSON.parse(await readFile(join(home, "bruine.json"), "utf8"));
    expect(doc.permissionMode).toBe("ask");
    // Newest first, and the model we came from is there: f2 needs it.
    expect(doc.recentModels).toEqual(["local/qwen3.8-27b", "local/Ornith.gguf"]);
  });

  test("one switch is enough for f2 to walk back (the measured bug)", async () => {
    const h = harness();
    const home = await attach(h, { settings: SETTINGS });
    await h.picker.runCommand("/model local/qwen3.8-27b");
    await h.picker.persisted;
    expect(JSON.parse(await readFile(join(home, "bruine.json"), "utf8")).recentModels).toHaveLength(2);
    await h.picker.cycleRecent(1);
    expect(h.holder.current?.model).toBe("Ornith.gguf");
  });

  test("a refused switch records nothing and writes no file", async () => {
    const h = harness();
    const home = await attach(h, { settings: SETTINGS });
    await h.picker.runCommand("/model local/never-declared");
    await h.picker.persisted;
    expect(existsSync(join(home, "bruine.json"))).toBe(false);
  });

  test("before the session exists the command says so instead of throwing", async () => {
    const h = harness();
    const { ModelPicker } = await import("../src/plugins/model.js");
    const bare = new ModelPicker();
    await bare.attach(undefined, undefined, undefined);
    expect(bare.ready).toBe(false);
    expect(await bare.runCommand("/model")).toBe("Model: not ready yet.");
    expect(h.asked).toEqual([]);
  });
});

describe("recent routes, f2 (T38)", () => {
  test("f2 walks the remembered routes, and the API walks back", async () => {
    const h = harness();
    const home = await attach(h, { settings: SETTINGS });
    await writeFile(
      join(home, "bruine.json"),
      JSON.stringify({ recentModels: ["local/qwen3.8-27b", "local/Ornith.gguf"] }),
    );
    h.holder.current = { provider: "local", model: "qwen3.8-27b" };
    // Recents are newest-first, so one step lands on the previous route.
    await h.picker.cycleRecent(1);
    expect(h.holder.current?.model).toBe("Ornith.gguf");
    await h.picker.cycleRecent(-1);
    expect(h.holder.current?.model).toBe("qwen3.8-27b");
  });

  test("the key listener claims f2 and nothing else", async () => {
    const h = harness();
    await attach(h, { settings: SETTINGS });
    // pi-tui 0.85.1 has no shift+f2 sequence, so no reverse bind is claimed.
    expect(h.keyListener?.("\x1bOQ")).toEqual({ consume: true });
    expect(h.keyListener?.("\x1b[12~")).toEqual({ consume: true });
    expect(h.keyListener?.("\x1b[1;2Q")).toEqual({});
    expect(h.keyListener?.("x")).toEqual({});
  });

  test("a remembered route that can no longer be dispatched is dropped", async () => {
    const h = harness();
    const home = await attach(h, { settings: SETTINGS });
    await writeFile(
      join(home, "bruine.json"),
      JSON.stringify({ recentModels: ["local/qwen3.8-27b", "local/gone", "not-a-provider"] }),
    );
    h.holder.current = { provider: "local", model: "Ornith.gguf" };
    // "not-a-provider" is not a route, and "local/gone" is not a model this
    // route configures: neither can be dispatched, so neither is cycled to.
    expect(await h.picker.cycleRecent(1)).toBe("No other recent model yet: switch with /model first.");
    expect(h.holder.current?.model).toBe("Ornith.gguf");
  });

  test("f2 on a fresh install says what to do instead of doing nothing", async () => {
    const h = harness();
    await attach(h, { settings: SETTINGS });
    expect(await h.picker.cycleRecent(1)).toBe("No other recent model yet: switch with /model first.");
    expect(h.notices).toContain("No other recent model yet: switch with /model first.");
  });
});

describe("wiring (T37)", () => {
  test("the plugin registers /model and /provider in dsh's commands service", async () => {
    const { apply, name } = await import("../src/plugins/model.js");
    expect(name).toBe("bruine-model");
    const registered: Array<{ name: string; description: string }> = [];
    const ctx = {
      get: (service: string) =>
        service === "commands"
          ? { register: (d: { name: string; description: string }) => registered.push(d) }
          : service === "bruineRepl"
            ? { agent: {}, selection: {}, ui: undefined }
            : undefined,
      inject: () => {},
      provide: () => {},
    };
    apply(ctx as never);
    expect(registered.map((r) => r.name)).toEqual(["model", "provider"]);
    expect(registered[0]!.description).toMatch(/Switch the model/);
    expect(registered[1]!.description).toMatch(/List every provider/);
  });

  test("env key names are read without ever exposing a value", async () => {
    const { readEnvKeys } = await import("../src/plugins/model.js");
    const home = await mkdtemp(join(tmpdir(), "bruine-t37-env-"));
    await writeFile(join(home, ".env"), "# a comment\nBRUINE_LOCAL_API_KEY=secret\n\nexport OPENROUTER_API_KEY='x'\nbad line\n");
    const keys = readEnvKeys(home);
    expect([...keys].sort()).toEqual(["BRUINE_LOCAL_API_KEY", "OPENROUTER_API_KEY"]);
    expect([...keys].some((k) => k.includes("secret"))).toBe(false);
    expect(readEnvKeys(join(home, "nope"))).toEqual(new Set());
  });

  test("the whole thing needs no home at all (an empty settings.yaml is legal)", async () => {
    const h = harness();
    await attach(h, { settings: "" });
    expect(existsSync(join(process.env.DSH_HOME as string, "settings.yaml"))).toBe(true);
    expect(h.picker.providerRows().map((r: { id: string }) => r.id)).toEqual(["local", "openrouter"]);
  });
});

describe("Space Bunny Free in /model", () => {
  const freeRowLabel = /Space Bunny Free/;

  test("a home that never added it is offered it as the last row of the provider list", async () => {
    const h = harness({ picks: [-1] });
    await attach(h, { settings: SETTINGS });
    await h.picker.runCommand("/model");
    const items = h.asked[0]!.items;
    expect(items[items.length - 1]!.label).toMatch(freeRowLabel);
    expect(items.slice(0, -1).every((i) => !freeRowLabel.test(i.label))).toBe(true);
  });

  test("a home that already has the route is not offered it twice", async () => {
    const h = harness({ picks: [-1] });
    await attach(h, {
      settings: SETTINGS.replace("agent-default-model:", [
        "    opencode-zen:",
        "      baseURL: 'https://opencode.ai/zen/v1'",
        "      models:",
        "        - id: 'space-bunny-free'",
        "agent-default-model:",
      ].join("\n")),
    });
    await h.picker.runCommand("/model");
    expect(h.asked[0]!.items.some((i) => freeRowLabel.test(i.label))).toBe(false);
  });

  test("picking it tells the user where their code goes, and writes nothing on a no", async () => {
    const h = harness({ picks: [2, 0] }); // the free row, then "No"
    const home = await attach(h, { settings: SETTINGS });
    const before = await readFile(join(home, "settings.yaml"), "utf8");
    const reply = await h.picker.runCommand("/model");
    expect(reply).toBe("Space Bunny Free: not added.");
    expect(h.asked[1]!.title).toMatch(/sent to/i);
    expect(h.asked[1]!.title).toMatch(/end without notice/i);
    expect(await readFile(join(home, "settings.yaml"), "utf8")).toBe(before);
    expect(existsSync(join(home, ".env"))).toBe(false);
    expect(h.saved).toEqual([]);
  });

  test("a yes adds the route and its public key, keeps everything else, and switches to it once it is mounted", async () => {
    const h = harness({ picks: [2, 1] });
    const mounted: Array<{ id: string; name?: string }> = [
      { id: "local", name: "Local Server" },
      { id: "openrouter", name: "OpenRouter" },
    ];
    (h.llm as { listProviders: () => unknown }).listProviders = () => mounted;
    (h.llm as { listModels: (p: string) => Promise<unknown> }).listModels = async (p: string) => (p === "opencode-zen" ? [{ id: "space-bunny-free" }] : []);
    const home = await attach(h, { settings: SETTINGS });
    // dsh hot-reloads settings.yaml: the route appears a moment after the write.
    setTimeout(() => mounted.push({ id: "opencode-zen", name: "OpenCode Zen" }), 250);
    const reply = await h.picker.runCommand("/model");
    const yaml = await readFile(join(home, "settings.yaml"), "utf8");
    expect(yaml).toContain("opencode-zen:");
    expect(yaml).toContain("https://opencode.ai/zen/v1");
    expect(yaml).toContain("Authorization: Bearer public");
    expect(yaml).not.toContain("apiKeyEnv: BRUINE_ZEN_API_KEY");
    expect(yaml).toContain("space-bunny-free");
    expect(yaml).toContain("xhigh");
    expect(yaml).toContain("Ornith.gguf"); // what was there is still there
    expect(yaml).toContain("agent-default-model:");
    // No key variable: nothing to write to .env, and nothing the running session could miss.
    expect(existsSync(join(home, ".env"))).toBe(false);
    expect(h.holder.current).toMatchObject({ provider: "opencode-zen", model: "space-bunny-free" });
    expect(reply).toMatch(/space-bunny-free/);
    expect(process.env.BRUINE_ZEN_API_KEY).toBeUndefined();
  });

  test("if the runtime does not mount the route in time, the user is told the one command that finishes it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const h = harness({ picks: [2, 1] });
      await attach(h, { settings: SETTINGS });
      let reply: string | undefined;
      const pending = h.picker.runCommand("/model").then((r: string) => { reply = r; });
      // The poll starts after the file writes finish, which is real I/O: turn the clock until it ends.
      for (let i = 0; i < 200 && reply === undefined; i += 1) {
        await vi.advanceTimersByTimeAsync(100);
        await new Promise((resolve) => setImmediate(resolve));
      }
      await pending;
      expect(reply).toMatch(/\/reload/);
      expect(reply).toMatch(/space-bunny/);
      expect(h.holder.current).toMatchObject({ provider: "local" });
    } finally {
      vi.useRealTimers();
    }
  });

  test("/model space-bunny does the same by name, and is refused without a terminal to ask in", async () => {
    const h = harness({ picks: [0] });
    const home = await attach(h, { settings: SETTINGS });
    expect(await h.picker.runCommand("/model space-bunny")).toBe("Space Bunny Free: not added.");
    expect(existsSync(join(home, ".env"))).toBe(false);
    const quiet = harness();
    (quiet.ui as { askChoice?: unknown }).askChoice = undefined;
    await attach(quiet, { settings: SETTINGS });
    expect(await quiet.picker.runCommand("/model space-bunny")).toMatch(/needs a yes or no/);
  });

  test("a route an earlier version wrote (a key variable, two levels) is mended when the picker starts", async () => {
    const h = harness({ picks: [-1] });
    const home = await attach(h, {
      settings: SETTINGS.replace("agent-default-model:", [
        "    opencode-zen:",
        "      displayName: OpenCode Zen",
        "      api: openai-completions",
        "      baseURL: 'https://opencode.ai/zen/v1'",
        "      apiKeyEnv: BRUINE_ZEN_API_KEY",
        "      models:",
        "        - id: space-bunny-free",
        "          reasoningEfforts:",
        "            off: null",
        "            low: low",
        "agent-default-model:",
      ].join("\n")),
    });
    await vi.waitFor(async () => expect(await readFile(join(home, "settings.yaml"), "utf8")).toContain("Authorization: Bearer public"));
    const yaml = await readFile(join(home, "settings.yaml"), "utf8");
    expect(yaml).not.toContain("apiKeyEnv: BRUINE_ZEN_API_KEY");
    expect(yaml).toContain("xhigh");
    expect(yaml).toContain("Ornith.gguf");
  });

  test("the plain listing says how to add it", async () => {
    const h = harness();
    (h.ui as { askChoice?: unknown }).askChoice = undefined;
    await attach(h, { settings: SETTINGS });
    const text = await h.picker.runCommand("/model");
    expect(text).toMatch(/\/model space-bunny/);
  });
});
