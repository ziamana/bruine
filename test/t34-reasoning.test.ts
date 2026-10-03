/**
 * T34 — reasoning effort that really works: template detection from llama.cpp
 * /props, the compat/reasoningEfforts blocks setup writes, the runtime
 * kumo-effort plugin (levels, defaults, /effort, ctrl+e), and the T28b
 * follow-up: Auto judge and ghost suggestion send thinking OFF through the
 * same T34 mechanism.
 */
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  detectTemplateCaps,
  probeServer,
  type TemplateCaps,
} from "../src/setup/discover.js";
import { localServerSettings, reasoningSettingsFor, renderSettingsYaml } from "../src/setup/simple.js";
import { roleFromModelRef, SetupFlow } from "../src/setup/flow.js";
import {
  defaultLevelFor,
  Effort,
  effortLabel,
  hasTemplateForRoute,
  isBinaryLevels,
  normalizeLevelArg,
  savedLevelFor,
  type EffortSelection,
} from "../src/plugins/effort.js";
import { askJudge } from "../src/gate/judge.js";

/** A llama.cpp Ornith server: /v1/models plain, /props with n_ctx + template. */
function ornithFetch(url: string): [number, unknown] | undefined {
  if (url.endsWith("/v1/models")) {
    return [200, { data: [{ id: "Ornith-1.5-9B-Q4_K_M.gguf" }] }];
  }
  if (url.endsWith("/props")) {
    return [
      200,
      {
        n_ctx: 100096,
        chat_template:
          "{% if enable_thinking %}{{ ' thinking on ' }}{% endif %}{% for message in messages %}{{ message.content }}{% endfor %}",
      },
    ];
  }
  return undefined;
}

describe("detectTemplateCaps (T34)", () => {
  test("Ornith-like template: enable_thinking only", () => {
    const caps = detectTemplateCaps(
      "bla {{ enable_thinking }} bla {% if tools %}…{% endif %}",
    );
    expect(caps).toEqual({ enableThinking: true, reasoningEffort: false, preserveThinking: false });
  });

  test("Qwen 3.8-like template: reasoning_effort + preserve_thinking", () => {
    const caps = detectTemplateCaps(
      "{{ reasoning_effort }} then {{ preserve_thinking }} and {{ thinking_budget | default(0) }}",
    );
    expect(caps).toEqual({ enableThinking: false, reasoningEffort: true, preserveThinking: true });
  });

  test("template without thinking switches → undefined (keep pi-ai detection)", () => {
    expect(detectTemplateCaps("{{ messages }} {{ tools }}")).toBeUndefined();
    expect(detectTemplateCaps(undefined)).toBeUndefined();
    expect(detectTemplateCaps(42)).toBeUndefined();
  });
});

describe("probeServer template (T34)", () => {
  test("a localhost llama.cpp route carries the template + /props n_ctx", async () => {
    const found = await probeServer("127.0.0.1", 9, {
      fetchImpl: async (url) => {
        const hit = ornithFetch(url);
        if (hit === undefined) throw new Error(`unexpected ${url}`);
        return { ok: true, status: hit[0], json: async () => hit[1] };
      },
    });
    expect(found?.modelInfos).toEqual([{ id: "Ornith-1.5-9B-Q4_K_M.gguf", contextWindow: 100096 }]);
    expect(found?.template).toEqual({ enableThinking: true, reasoningEffort: false, preserveThinking: false });
  });

  test("no /props answer → no template forced (Ollama, LM Studio…)", async () => {
    const found = await probeServer("127.0.0.1", 9, {
      fetchImpl: async (url) =>
        url.endsWith("/v1/models")
          ? { ok: true, status: 200, json: async () => ({ data: [{ id: "m" }] }) }
          : { ok: false, status: 404, json: async () => ({}) },
    });
    expect(found?.template).toBeUndefined();
  });
});

describe("reasoningSettingsFor (T34)", () => {
  test("enable_thinking-only template → chat-template compat + off/on efforts", () => {
    const r = reasoningSettingsFor({ enableThinking: true, reasoningEffort: false, preserveThinking: false });
    expect(r.compat).toEqual({
      thinkingFormat: "chat-template",
      chatTemplateKwargs: { enable_thinking: { $var: "thinking.enabled" } },
    });
    // "on" rides the `low` level: keys must be pi-ai level ids.
    expect(r.reasoningEfforts).toEqual({ off: null, low: "on" });
  });

  test("reasoning_effort template → off/low/medium/high + omitWhenOff + preserve_thinking", () => {
    const caps: TemplateCaps = { enableThinking: true, reasoningEffort: true, preserveThinking: true };
    const r = reasoningSettingsFor(caps);
    expect(r.compat).toEqual({
      thinkingFormat: "chat-template",
      chatTemplateKwargs: {
        enable_thinking: { $var: "thinking.enabled" },
        reasoning_effort: { $var: "thinking.effort", omitWhenOff: true },
        preserve_thinking: true,
      },
    });
    expect(r.reasoningEfforts).toEqual({ off: null, low: "low", medium: "medium", high: "high" });
    expect("xhigh" in (r.reasoningEfforts ?? {})).toBe(false); // never xhigh by default
  });

  test("localServerSettings embeds the compat block for a template hit", () => {
    const doc = localServerSettings(
      {
        baseUrl: "http://127.0.0.1:8081/v1",
        models: ["ornith"],
        template: { enableThinking: true, reasoningEffort: true, preserveThinking: true },
      },
      "ornith",
    );
    const parsed = parseYaml(renderSettingsYaml(doc)) as any;
    const model = parsed["llm-pi-ai"].providers.local.models[0];
    expect(model.compat.thinkingFormat).toBe("chat-template");
    expect(model.compat.chatTemplateKwargs.enable_thinking).toEqual({ $var: "thinking.enabled" });
    expect(model.compat.chatTemplateKwargs.reasoning_effort).toEqual({
      $var: "thinking.effort",
      omitWhenOff: true,
    });
    expect(model.compat.chatTemplateKwargs.preserve_thinking).toBe(true);
    expect(model.reasoningEfforts).toEqual({ off: null, low: "low", medium: "medium", high: "high" });
  });

  test("no template → T19 minimal block (off + low, no compat)", () => {
    const doc = localServerSettings({ baseUrl: "http://127.0.0.1:11434/v1", models: ["m"] }, "m");
    const parsed = parseYaml(renderSettingsYaml(doc)) as any;
    const model = parsed["llm-pi-ai"].providers.local.models[0];
    expect(model.compat).toBeUndefined();
    expect(model.reasoningEfforts).toEqual({ off: null, low: "low" });
  });
});

describe("wizard buildPlan carries the template (T34)", () => {
  const discovered = {
    source: "localhost" as const,
    host: "127.0.0.1",
    port: 8081,
    baseUrl: "http://127.0.0.1:8081/v1",
    models: ["ornith"],
    modelInfos: [{ id: "ornith", contextWindow: 32768 }],
    template: { enableThinking: true, reasoningEffort: false, preserveThinking: false } satisfies TemplateCaps,
  };

  function walked(): SetupFlow {
    const flow = new SetupFlow();
    flow.submit({ discoveries: [discovered] });
    flow.submit({ roles: { main: { discovered, model: "ornith" } } });
    flow.submit({}); // keys
    flow.submit({ permissionMode: "ask" });
    flow.submit({ search: { provider: "none" } });
    flow.submit({ skills: [] });
    flow.submit({ theme: "dark" });
    flow.submit({ telemetry: false });
    return flow;
  }

  test("kumo.json models.main carries the template (round-trip on re-save)", () => {
    const plan = walked().buildPlan({ dshHome: "/h", bundledSkillsRoot: "/p", bundledSkills: [] });
    const json = JSON.parse(plan.kumoJson) as { models: Record<string, unknown> };
    expect(json.models.main).toMatchObject({
      provider: "local",
      model: "ornith",
      template: { enableThinking: true, reasoningEffort: false, preserveThinking: false },
    });
  });

  test("roleFromModelRef restores the template so Save keeps the compat block", async () => {
    const plan = walked().buildPlan({ dshHome: "/h", bundledSkillsRoot: "/p", bundledSkills: [] });
    const ref = (JSON.parse(plan.kumoJson) as any).models.main;
    // rebuild the answers the way `kumo setup` prefill does, then re-plan:
    const flow2 = new SetupFlow();
    const pick = roleFromModelRef(ref);
    expect(pick?.discovered?.template).toEqual(ref.template);
    flow2.submit({ discoveries: pick !== undefined && pick.discovered !== undefined ? [pick.discovered] : [] });
    flow2.submit({ roles: pick !== undefined ? { main: pick } : {} });
    flow2.submit({});
    flow2.submit({ permissionMode: "ask" });
    flow2.submit({ search: { provider: "none" } });
    flow2.submit({ skills: [] });
    flow2.submit({ theme: "dark" });
    flow2.submit({ telemetry: false });
    const plan2 = flow2.buildPlan({ dshHome: "/h", bundledSkillsRoot: "/p", bundledSkills: [] });
    const parsed = parseYaml(plan2.settingsYaml) as any;
    expect(parsed["llm-pi-ai"].providers.local.models[0].compat.thinkingFormat).toBe("chat-template");
  });
});

describe("kumo-effort runtime (T34)", () => {
  test("isBinaryLevels / labels", () => {
    expect(isBinaryLevels(["off", "low"])).toBe(true);
    expect(isBinaryLevels(["off", "low", "medium", "high"])).toBe(false);
    expect(effortLabel(["off", "low"], "low")).toBe("on");
    expect(effortLabel(["off", "low"], "off")).toBe("off");
    expect(effortLabel(["off", "low", "medium", "high"], "medium")).toBe("medium");
    expect(effortLabel(["off", "low", "medium", "high"], undefined)).toBe("auto");
    expect(effortLabel([], undefined)).toBe("auto");
  });

  test("defaultLevelFor: local template only; on / medium", () => {
    expect(defaultLevelFor("local", ["off", "low"], true)).toBe("low");
    expect(defaultLevelFor("local", ["off", "low", "medium", "high"], true)).toBe("medium");
    expect(defaultLevelFor("local", ["off", "low"], false)).toBeUndefined();
    expect(defaultLevelFor("openrouter", ["off", "low", "medium", "high"], true)).toBeUndefined();
    expect(defaultLevelFor("local", ["off"], true)).toBeUndefined();
  });

  test("hasTemplateForRoute / savedLevelFor (exact + glob)", () => {
    const doc = { models: { main: { provider: "local", model: "qwen3.8", template: {} } } };
    expect(hasTemplateForRoute(doc, "local", "qwen3.8")).toBe(true);
    expect(hasTemplateForRoute(doc, "local", "other")).toBe(false);
    expect(savedLevelFor({ "qwen3.8*": "high" }, "qwen3.8-9b")).toBe("high");
    expect(savedLevelFor({ exact: "low" }, "exact")).toBe("low");
    expect(savedLevelFor({ other: "low" }, "exact")).toBeUndefined();
  });

  test("normalizeLevelArg: off/on/low…, auto, unknown rejected", () => {
    expect(normalizeLevelArg(["off", "low"], "on")).toBe("low");
    expect(normalizeLevelArg(["off", "low"], "off")).toBe("off");
    expect(normalizeLevelArg(["off", "low"], "ON")).toBe("low");
    expect(normalizeLevelArg(["off", "low", "medium", "high"], "high")).toBe("high");
    expect(normalizeLevelArg(["off", "low", "medium", "high"], "on")).toBeUndefined(); // not binary
    expect(normalizeLevelArg(["off", "low"], "auto")).toBe("auto");
    expect(normalizeLevelArg(["off", "low"], "xhigh")).toBeUndefined(); // never offered
  });

  interface H {
    effort: Effort;
    holder: { current?: EffortSelection; assembled?: unknown };
    notices: string[];
    footerState: Record<string, unknown>;
    ui: Record<string, unknown>;
    llm: { resolveModelInfo: () => Promise<any> };
    savedDoc: Record<string, unknown>;
    home?: string;
    keyListener?: (data: string) => { consume?: boolean } | void;
  }

  function harness(levels: string[], savedDoc: Record<string, unknown> = {}): H {
    const holder: { current?: EffortSelection; assembled?: unknown } = {
      current: { provider: "local", model: "m1" },
    };
    const notices: string[] = [];
    const footerState: Record<string, unknown> = {};
    let keyListener: ((data: string) => { consume?: boolean } | void) | undefined;
    const ui = {
      askChoice: async () => -1,
      showNotice: (t: string) => notices.push(t),
      footer: { set: (n: Record<string, unknown>) => Object.assign(footerState, n) },
      requestRender: () => {},
      tui: { addInputListener: (fn: (data: string) => { consume?: boolean } | void) => { keyListener = fn; return () => {}; } },
    };
    const llm = { resolveModelInfo: async () => ({ reasoning: { efforts: levels.map((id) => ({ id, name: id })) } }) };
    return { effort: new Effort(), holder, notices, footerState, ui, llm, savedDoc, home: undefined, get keyListener() { return keyListener; } };
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.DSH_HOME;
  });

  async function attach(h: ReturnType<typeof harness>) {
    // kumo.json for persistence + template lookup goes to a temp home.
    const home = await mkdtemp(join(tmpdir(), "kumo-t34-"));
    await mkdir(home, { recursive: true });
    process.env.DSH_HOME = home;
    h.home = home;
    const doc = {
      models: { main: { provider: "local", model: "m1", template: { enableThinking: true } } },
      ...(h.savedDoc as object),
    };
    await writeFile(join(home, "bruine.json"), JSON.stringify(doc));
    await h.effort.attach({ agent: {}, selection: h.holder, ui: h.ui as never } as never, h.llm as never);
    return home;
  }

  test("attach applies the T34 default (binary → on, effort list → medium) + footer truth", async () => {
    const h = harness(["off", "low"]);
    await attach(h);
    expect(h.holder.current?.reasoningEffort).toBe("low");
    expect(h.footerState.effort).toBe("on");
    const h2 = harness(["off", "low", "medium", "high"]);
    await attach(h2);
    expect(h2.holder.current?.reasoningEffort).toBe("medium");
    expect(h2.footerState.effort).toBe("medium");
  });

  test("a saved level wins over the default and must exist in the model", async () => {
    const h = harness(["off", "low", "medium", "high"], { reasoningEffort: { m1: "high" } });
    await attach(h);
    expect(h.holder.current?.reasoningEffort).toBe("high");
    const h2 = harness(["off", "low", "medium", "high"], { reasoningEffort: { m1: "xhigh" } });
    await attach(h2); // saved not in levels → fall back to default
    expect(h2.holder.current?.reasoningEffort).toBe("medium");
  });

  test("cloud models: no default (provider decides), footer auto", async () => {
    const h = harness(["off", "low", "medium", "high"]);
    h.holder.current = { provider: "openrouter", model: "m1" };
    const home = await mkdtemp(join(tmpdir(), "kumo-t34-"));
    process.env.DSH_HOME = home;
    await writeFile(join(home, "bruine.json"), JSON.stringify({ models: {} }));
    await h.effort.attach({ agent: {}, selection: h.holder, ui: h.ui as never } as never, h.llm as never);
    expect(h.holder.current?.reasoningEffort).toBeUndefined();
    expect(h.footerState.effort).toBe("auto");
  });

  test("/effort high changes only selection + footer + notice (no history, no tools)", async () => {
    const h = harness(["off", "low", "medium", "high"]);
    await attach(h);
    const before = { ...h.holder.current! };
    const reply = await h.effort.runCommand("/effort high");
    expect(h.holder.current).not.toBe(before); // replaced object
    expect(h.holder.current?.reasoningEffort).toBe("high");
    expect(h.notices.at(-1)).toBe("Effort: high (next message)");
    expect(reply).toBe("Effort: high (next message)");
    expect(h.footerState.effort).toBe("high");
    // remembered per model in kumo.json:
    await h.effort.persisted;
    const doc = JSON.parse(await readFile(join(h.home!, "bruine.json"), "utf8")) as any;
    expect(doc.reasoningEffort).toEqual({ m1: "high" });
    expect(doc.models).toBeDefined(); // other keys preserved
  });

  test("/effort off on a binary model → off; /effort on → on(=low)", async () => {
    const h = harness(["off", "low"]);
    await attach(h);
    await h.effort.runCommand("/effort off");
    expect(h.holder.current?.reasoningEffort).toBe("off");
    expect(h.footerState.effort).toBe("off");
    await h.effort.runCommand("/effort on");
    expect(h.holder.current?.reasoningEffort).toBe("low");
    expect(h.notices.at(-1)).toBe("Effort: on (next message)");
    const bad = await h.effort.runCommand("/effort xhigh");
    expect(bad).toContain("Unknown effort");
    const auto = await h.effort.runCommand("/effort auto");
    expect(auto).toContain("Effort: auto");
    expect(h.holder.current?.reasoningEffort).toBeUndefined();
  });

  test("ctrl+e cycles the levels: off → low(on) → … → wrap", async () => {
    const h = harness(["off", "low"]);
    await attach(h); // default low → "on"
    h.keyListener?.("\x05"); // ctrl+e
    expect(h.holder.current?.reasoningEffort).toBe("off");
    expect(h.notices.at(-1)).toBe("Effort: off (next message)");
    h.keyListener?.("\x05");
    expect(h.holder.current?.reasoningEffort).toBe("low");
    expect(h.notices.at(-1)).toBe("Effort: on (next message)");
    // a plain keystroke is not consumed
    expect(h.keyListener?.("a")).toEqual({});
  });

  test("the picker marks the current level and applies the pick", async () => {
    const h = harness(["off", "low", "medium", "high"]);
    await attach(h);
    let asked: Array<{ value: string; label: string }> | undefined;
    (h.ui as { askChoice?: unknown }).askChoice = async (_t: string, items: Array<{ value: string; label: string }>) => {
      asked = items;
      return 2; // medium (off=0 low=1 medium=2)
    };
    const reply = await h.effort.runCommand("/effort");
    expect(asked?.map((i) => i.label)).toEqual(["off", "low", "medium (current)", "high"]);
    expect(reply).toBe("Effort: medium (next message)");
  });

  // T37: `/model` changed the route; the levels belonged to the old model.
  test("adoptRoute re-resolves the levels of the new model", async () => {
    const h = harness(["off", "low", "medium", "high"]);
    await attach(h);
    await h.effort.runCommand("/effort high");
    // The new model offers fewer levels: the stale one is dropped, not sent.
    h.llm.resolveModelInfo = (async () => ({
      reasoning: { efforts: [{ id: "off", name: "off" }, { id: "low", name: "low" }] },
    })) as never;
    h.holder.current = { provider: "local", model: "m2", reasoningEffort: "low" };
    await h.effort.adoptRoute("local", "m2");
    expect(h.effort.levels).toEqual(["off", "low"]);
    expect(h.holder.current?.reasoningEffort).toBe("low");
    expect(h.footerState.effort).toBe("on"); // off+low is a binary switch
  });

  test("adoptRoute keeps a live effort the new model still offers", async () => {
    const h = harness(["off", "low", "medium", "high"]);
    await attach(h);
    await h.effort.runCommand("/effort high");
    h.holder.current = { provider: "local", model: "m2", reasoningEffort: "high" };
    await h.effort.adoptRoute("local", "m2");
    expect(h.holder.current?.reasoningEffort).toBe("high");
  });

  test("adoptRoute on a model with no thinking drops the effort entirely", async () => {
    const h = harness(["off", "low", "medium", "high"]);
    await attach(h);
    await h.effort.runCommand("/effort high");
    h.llm.resolveModelInfo = (async () => ({})) as never;
    h.holder.current = { provider: "local", model: "m2", reasoningEffort: "high" };
    await h.effort.adoptRoute("local", "m2");
    expect(h.effort.levels).toEqual([]);
    expect(h.holder.current?.reasoningEffort).toBeUndefined();
    expect(h.footerState.effort).toBe("auto");
  });

  test("adoptRoute before attach is a no-op, not a crash", async () => {
    const { Effort: Fresh } = await import("../src/plugins/effort.js");
    const fresh = new Fresh();
    await expect(fresh.adoptRoute("local", "m2")).resolves.toBeUndefined();
  });
});

describe("judge + suggestion send thinking OFF through T34 (T28b)", () => {
  // The models a T34 setup writes always declare `off` (binary or effort
  // templates), so askJudge / triggerSuggest can turn thinking off. These
  // assert the kumo side asks for exactly the level that switches it.
  test("judge on a T34 binary route asks for off", async () => {
    let seen: any;
    const llm: any = {
      // resolveModelInfo for a reasoningEfforts { off: null, low: "on" } route:
      resolveModelInfo: async () => ({
        reasoning: { efforts: [{ id: "off", name: "Off" }, { id: "low", name: "Low" }] },
      }),
      stream: (opts: any) => {
        seen = opts;
        return (async function* () {
          yield { type: "text-delta", text: "ALLOW" };
        })();
      },
    };
    const v = await askJudge(llm, { provider: "local", model: "ornith" }, []);
    expect(v.decision).toBe("ALLOW");
    expect(seen.reasoningEffort).toBe("off");
  });
});
