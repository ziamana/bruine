import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, test } from "vitest";
import { SetupFlow, requiredKeyEnvs, type SetupAnswers } from "../src/setup/flow.js";
import { loadPrefill } from "../src/setup/full.js";
import type { Discovered } from "../src/setup/discover.js";

const server1: Discovered = {
  source: "localhost",
  host: "127.0.0.1",
  port: 8080,
  baseUrl: "http://127.0.0.1:8080/v1",
  models: ["m1", "nomic-embed"],
  modelInfos: [
    { id: "m1", contextWindow: 100096 }, // n_ctx from the server, never n_ctx_train
    { id: "nomic-embed" },
  ],
};

function walkedFlow(): SetupFlow {
  const flow = new SetupFlow();
  flow.submit({ discoveries: [server1] }); // models
  return flow;
}

async function freshStepFlow(): Promise<SetupFlow> {
  const flow = walkedFlow();
  flow.submit({ roles: { main: { discovered: server1, model: "m1" } } }); // roles
  flow.submit({}); // keys — nothing required
  return flow;
}

describe("SetupFlow step machine (T21)", () => {
  test("steps advance in order; Esc on step 5 returns to step 4 keeping values", async () => {
    let flow = await freshStepFlow();
    expect(flow.step).toBe("mode");
    flow.submit({ permissionMode: "auto" });
    expect(flow.step).toBe("search"); // step 5 of 9
    // Esc → back one step, previous values kept:
    expect(flow.back()).toBe(true);
    expect(flow.step).toBe("mode");
    expect(flow.answers.permissionMode).toBe("auto");
    // forward again with the kept answer
    flow.submit({ permissionMode: "auto" });
    flow.submit({ search: { provider: "none" } });
    flow.submit({ skills: [] });
    flow.submit({ theme: "dark" });
    flow.submit({ telemetry: false });
    expect(flow.step).toBe("summary");
    expect(flow.atSummary).toBe(true);
    expect(flow.back()).toBe(true);
    expect(flow.step).toBe("telemetry");
  });

  test("roles without a main model never advance", () => {
    const flow = walkedFlow();
    expect(() => flow.submit({ roles: {} })).toThrow(/main/i);
    expect(flow.step).toBe("roles");
  });

  test("cancel blocks Save and writes nothing", async () => {
    const home = await mkdtemp(join(tmpdir(), "kumo-flow-"));
    const flow = walkedFlow();
    flow.cancel();
    await expect(
      flow.save({ dshHome: home, bundledSkillsRoot: join(home, "none"), bundledSkills: [] }),
    ).rejects.toThrow(/canceled/);
    await expect(stat(join(home, "settings.yaml"))).rejects.toThrow();
    await expect(stat(join(home, "kumo.json"))).rejects.toThrow();
  });

  test("Save before the summary step is refused", async () => {
    const home = await mkdtemp(join(tmpdir(), "kumo-flow-"));
    const flow = walkedFlow();
    await expect(
      flow.save({ dshHome: home, bundledSkillsRoot: "", bundledSkills: [] }),
    ).rejects.toThrow(/summary/);
  });
});

describe("buildPlan (T21 + context window)", () => {
  test("local main → settings has server contextWindow and reasoningEfforts; kumo.json + env", async () => {
    const flow = walkedFlow();
    flow.submit({ roles: { main: { discovered: server1, model: "m1" } } });
    flow.submit({});
    flow.submit({ permissionMode: "ask" });
    flow.submit({ search: { provider: "none" } });
    flow.submit({ skills: [] });
    flow.submit({ theme: "high-contrast" });
    flow.submit({ telemetry: false });
    const plan = flow.buildPlan({
      dshHome: "/home/x/.kumo",
      bundledSkillsRoot: "/pkg/skills",
      bundledSkills: [],
    });
    const parsed = parseYaml(plan.settingsYaml) as Record<string, any>;
    expect(parsed["llm-pi-ai"].providers.local).toMatchObject({
      api: "openai-completions",
      baseURL: "http://127.0.0.1:8080/v1",
      apiKeyEnv: "KUMO_LOCAL_API_KEY",
    });
    expect(parsed["llm-pi-ai"].providers.local.models).toEqual([
      {
        id: "m1",
        name: "m1",
        contextWindow: 100096,
        reasoningEfforts: { off: null, low: "low" },
      },
    ]);
    expect(parsed["agent-default-model"]).toEqual({ provider: "local", model: "m1" });
    // dsh only accepts light/dark/system; high-contrast maps to dark + kumo.json
    expect(parsed["ui-theme"]).toEqual({ preference: "dark" });
    const kumoJson = JSON.parse(plan.kumoJson);
    expect(kumoJson.theme).toBe("high-contrast");
    expect(kumoJson.models.main).toEqual({
      provider: "local",
      model: "m1",
      baseUrl: "http://127.0.0.1:8080/v1",
      contextWindow: 100096,
    });
    expect(kumoJson.models.fast).toEqual(kumoJson.models.main); // fast defaults to main
    expect(kumoJson).not.toHaveProperty("models.vision");
    expect(kumoJson.permissionMode).toBe("ask");
    expect(kumoJson.telemetry).toBe(false);
    expect(plan.env).toContainEqual(["KUMO_LOCAL_API_KEY", "local"]);
  });

  test("server that does not know its context: the typed value is written", () => {
    const dumb: Discovered = {
      source: "manual",
      host: "10.0.0.5",
      port: 1234,
      baseUrl: "http://10.0.0.5:1234/v1",
      models: ["quiet"],
      modelInfos: [{ id: "quiet" }],
    };
    const flow = new SetupFlow();
    flow.submit({ discoveries: [dumb] });
    flow.submit({
      roles: { main: { discovered: dumb, model: "quiet", contextWindow: 32768 } },
    });
    const plan = flow.buildPlan({ dshHome: "/h", bundledSkillsRoot: "/p", bundledSkills: [] });
    const parsed = parseYaml(plan.settingsYaml) as Record<string, any>;
    expect(parsed["llm-pi-ai"].providers.local.models[0].contextWindow).toBe(32768);
  });

  test("cloud roles require keys and get providers + env entries", () => {
    const flow = new SetupFlow();
    flow.submit({ discoveries: [] });
    flow.submit({
      roles: {
        main: { cloud: "deepseek-official", model: "deepseek-flash" },
        fast: { cloud: "openrouter", model: "openrouter/auto" },
      },
    });
    expect(requiredKeyEnvs(flow.answers)).toEqual(["DEEPSEEK_API_KEY", "OPENROUTER_API_KEY"]);
    expect(() => flow.submit({ keys: { DEEPSEEK_API_KEY: "" } })).toThrow(/DEEPSEEK_API_KEY/);
    flow.submit({ keys: { DEEPSEEK_API_KEY: "sk-d", OPENROUTER_API_KEY: "sk-o" } });
    const plan = flow.buildPlan({ dshHome: "/h", bundledSkillsRoot: "/p", bundledSkills: [] });
    const parsed = parseYaml(plan.settingsYaml) as Record<string, any>;
    expect(parsed["llm-pi-ai"].providers.openrouter).toEqual({ apiKeyEnv: "OPENROUTER_API_KEY" });
    expect(parsed["agent-default-model"]).toEqual({
      provider: "deepseek-official",
      model: "deepseek-flash",
    });
    expect(plan.env).toContainEqual(["DEEPSEEK_API_KEY", "sk-d"]);
    expect(plan.env).toContainEqual(["OPENROUTER_API_KEY", "sk-o"]);
    // no local server chosen → no dummy key
    expect(plan.env.some(([name]) => name === "KUMO_LOCAL_API_KEY")).toBe(false);
  });
});

describe("Save + prefill round-trip (T21)", () => {
  test("saved files reload into the same answers", async () => {
    const home = await mkdtemp(join(tmpdir(), "kumo-pre-"));
    let flow = walkedFlow();
    flow.submit({ roles: { main: { discovered: server1, model: "m1" }, vision: { cloud: "openrouter", model: "x" } } });
    flow.submit({ keys: { OPENROUTER_API_KEY: "sk-o" } });
    flow.submit({ permissionMode: "auto" });
    flow.submit({ search: { provider: "searxng", url: "http://127.0.0.1:8888" } });
    flow.submit({ skills: ["git-workflow"] });
    flow.submit({ theme: "light" });
    flow.submit({ telemetry: false });
    await flow.save({ dshHome: home, bundledSkillsRoot: "/no/skills", bundledSkills: [] });
    expect(await readFile(join(home, "settings.yaml"), "utf8")).toContain("contextWindow: 100096");
    const pre = loadPrefill(home);
    expect(pre).toBeDefined();
    const a = pre as SetupAnswers;
    expect(a.roles.main?.discovered?.baseUrl).toBe("http://127.0.0.1:8080/v1");
    expect(a.roles.main?.contextWindow).toBe(100096);
    expect(a.roles.vision).toEqual({ cloud: "openrouter", model: "x" });
    expect(a.permissionMode).toBe("auto");
    expect(a.search).toEqual({ provider: "searxng", url: "http://127.0.0.1:8888" });
    expect(a.skills).toEqual(["git-workflow"]);
    expect(a.theme).toBe("light");
    expect(a.keys.OPENROUTER_API_KEY).toBe("sk-o");
  });
});
