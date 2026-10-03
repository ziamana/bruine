/**
 * Cloud providers in the setup: everything the engine's catalog describes that needs one key.
 */
import { readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, test } from "vitest";
import { DEEPSEEK_OFFICIAL, cloudKeyEnv, loadCloudProviders } from "../src/setup/cloud.js";
import { SetupFlow, requiredKeyEnvs, roleFromModelRef } from "../src/setup/flow.js";
import { loadPrefill } from "../src/setup/full.js";

const providers = await loadCloudProviders();
const byId = (id: string) => providers.find((p) => p.id === id);

describe("the cloud catalog", () => {
  test("DeepSeek's own route comes first, then the popular providers, then the rest by name", () => {
    expect(providers[0]).toEqual(DEEPSEEK_OFFICIAL);
    const ids = providers.map((p) => p.id);
    expect(ids.slice(0, 5)).toEqual(["deepseek-official", "anthropic", "openai", "google", "openrouter"]);
    const rest = providers.slice(16).map((p) => p.name);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)));
  });

  test("it is much more than DeepSeek and OpenRouter", () => {
    expect(providers.length).toBeGreaterThan(20);
    for (const id of ["anthropic", "openai", "google", "xai", "mistral", "groq", "together", "fireworks", "cerebras", "huggingface"]) {
      expect(byId(id), id).toBeDefined();
    }
  });

  test("each one names the variable its key lives in, asked of the provider itself", () => {
    expect(byId("anthropic")?.keyEnv).toBe("ANTHROPIC_API_KEY");
    expect(byId("openai")?.keyEnv).toBe("OPENAI_API_KEY");
    expect(byId("google")?.keyEnv).toBe("GEMINI_API_KEY");
    expect(byId("groq")?.keyEnv).toBe("GROQ_API_KEY");
    expect(byId("openrouter")?.keyEnv).toBe("OPENROUTER_API_KEY");
    expect(byId("huggingface")?.keyEnv).toBe("HF_TOKEN");
    expect(cloudKeyEnv("together")).toBe("TOGETHER_API_KEY");
  });

  test("providers that need more than a key are not offered", () => {
    for (const id of ["amazon-bedrock", "azure-openai-responses", "google-vertex", "github-copilot", "cloudflare-workers-ai", "cloudflare-ai-gateway", "openai-codex", "deepseek"]) {
      expect(byId(id), id).toBeUndefined();
    }
  });

  test("every offered provider lists models, with a name", () => {
    for (const p of providers) {
      if (p.id === DEEPSEEK_OFFICIAL.id) continue;
      expect(p.models.length, p.id).toBeGreaterThan(0);
      expect(p.models.every((m) => m.id !== "" && m.name !== ""), p.id).toBe(true);
    }
  });

  test("an unknown id follows the convention", () => {
    expect(cloudKeyEnv("some-new-provider")).toBe("SOME_NEW_PROVIDER_API_KEY");
  });

  test("the catalog the setup reads is the engine's own copy, so a listed model runs", () => {
    const store = join(process.cwd(), "node_modules", ".pnpm");
    const adapter = readdirSync(store).find((name) => name.startsWith("@deepseek-ai+dsh-llm-pi-ai@"));
    expect(adapter).toBeDefined();
    const theirs = realpathSync(join(store, adapter!, "node_modules", "@earendil-works", "pi-ai"));
    const mine = realpathSync(join(process.cwd(), "node_modules", "@earendil-works", "pi-ai"));
    expect(mine).toBe(theirs);
  });
});

describe("a cloud role in the flow", () => {
  const flowWith = (cloud: string, model: string, keys: Record<string, string>): SetupFlow => {
    const flow = new SetupFlow();
    flow.submit({ discoveries: [] });
    flow.submit({ roles: { main: { cloud, model } } });
    flow.submit({ keys });
    return flow;
  };

  test("it asks for the provider's key and writes a route that carries only that key's name", () => {
    const flow = new SetupFlow();
    flow.submit({ discoveries: [] });
    flow.submit({ roles: { main: { cloud: "groq", model: "llama-3.1-8b-instant" }, fast: { cloud: "anthropic", model: "claude-haiku-4-5" } } });
    expect(requiredKeyEnvs(flow.answers)).toEqual(["GROQ_API_KEY", "ANTHROPIC_API_KEY"]);
    expect(() => flow.submit({ keys: { GROQ_API_KEY: "g" } })).toThrow(/ANTHROPIC_API_KEY/);
    flow.submit({ keys: { GROQ_API_KEY: "g", ANTHROPIC_API_KEY: "a" } });
    flow.submit({ permissionMode: "ask" });
    flow.submit({ search: { provider: "none" } });
    flow.submit({ skills: [] });
    flow.submit({ theme: "dark" });
    flow.submit({ telemetry: false });
    const plan = flow.buildPlan({ dshHome: "/h", bundledSkillsRoot: "/p", bundledSkills: [] });
    const parsed = parseYaml(plan.settingsYaml) as Record<string, any>;
    expect(parsed["llm-pi-ai"].providers.groq).toEqual({ apiKeyEnv: "GROQ_API_KEY" });
    expect(parsed["llm-pi-ai"].providers.anthropic).toEqual({ apiKeyEnv: "ANTHROPIC_API_KEY" });
    expect(parsed["agent-default-model"]).toEqual({ provider: "groq", model: "llama-3.1-8b-instant" });
    expect(plan.env).toContainEqual(["GROQ_API_KEY", "g"]);
    expect(plan.env).toContainEqual(["ANTHROPIC_API_KEY", "a"]);
  });

  test("the engine's DeepSeek route is written with no provider block", () => {
    const flow = flowWith("deepseek-official", "deepseek-flash", { DEEPSEEK_API_KEY: "d" });
    flow.submit({ permissionMode: "ask" });
    flow.submit({ search: { provider: "none" } });
    flow.submit({ skills: [] });
    flow.submit({ theme: "dark" });
    flow.submit({ telemetry: false });
    const plan = flow.buildPlan({ dshHome: "/h", bundledSkillsRoot: "/p", bundledSkills: [] });
    const parsed = parseYaml(plan.settingsYaml) as Record<string, any>;
    expect(parsed["llm-pi-ai"]).toBeUndefined();
    expect(parsed["agent-default-model"]).toEqual({ provider: "deepseek-official", model: "deepseek-flash" });
  });

  test("a ref with no endpoint is not a local server (the cloud case is read from settings.yaml)", () => {
    expect(roleFromModelRef({ provider: "groq", model: "m" })).toBeUndefined();
  });
});

describe("kumo setup reads a cloud route back", () => {
  test("a catalog provider in settings.yaml is the main role, with its key", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const home = await mkdtemp(join(tmpdir(), "kumo-cloud-prefill-"));
    await writeFile(
      join(home, "settings.yaml"),
      "llm-pi-ai:\n  providers:\n    groq:\n      apiKeyEnv: GROQ_API_KEY\nagent-default-model:\n  provider: groq\n  model: llama-3.1-8b-instant\n",
    );
    await writeFile(join(home, ".env"), "GROQ_API_KEY=gsk_saved\n");
    await writeFile(join(home, "kumo.json"), JSON.stringify({ mode: "full", models: { main: { provider: "groq", model: "llama-3.1-8b-instant" } } }));
    const prefill = await loadPrefill(home);
    expect(prefill?.roles.main).toEqual({ cloud: "groq", model: "llama-3.1-8b-instant" });
    expect(prefill?.keys.GROQ_API_KEY).toBe("gsk_saved");
  });
});
