import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { addSpaceBunnyToHome, repairSpaceBunnyRoute } from "../src/setup/zen-route.js";

const home = (): Promise<string> => mkdtemp(join(tmpdir(), "bruine-zen-"));
const route = async (h: string): Promise<Record<string, any>> =>
  (parse(await readFile(join(h, "settings.yaml"), "utf8")) as Record<string, any>)["llm-pi-ai"].providers["opencode-zen"];

const OLD = [
  "# my own models",
  "llm-pi-ai:",
  "  providers:",
  "    local:",
  "      baseURL: http://127.0.0.1:8081/v1   # the big machine",
  "      apiKeyEnv: BRUINE_LOCAL_API_KEY",
  "      models:",
  "        - id: m1",
  "    opencode-zen:",
  "      displayName: OpenCode Zen",
  "      api: openai-completions",
  "      baseURL: https://opencode.ai/zen/v1",
  "      apiKeyEnv: BRUINE_ZEN_API_KEY",
  "      models:",
  "        - id: space-bunny-free",
  "          name: space-bunny-free",
  "          contextWindow: 1000000",
  "          reasoningEfforts:",
  "            off: null",
  "            low: low",
  "agent-default-model:",
  "  provider: opencode-zen",
  "  model: space-bunny-free",
  "",
].join("\n");

describe("addSpaceBunnyToHome", () => {
  test("a home with no settings gets the route, authenticated by a header, with the endpoint's thinking levels", async () => {
    const h = await home();
    expect(await addSpaceBunnyToHome(h)).toBe("added");
    const r = await route(h);
    expect(r).toMatchObject({ displayName: "OpenCode Zen", api: "openai-completions", baseURL: "https://opencode.ai/zen/v1", headers: { Authorization: "Bearer public" } });
    expect(r.apiKeyEnv).toBeUndefined();
    expect(r.models[0]).toMatchObject({ id: "space-bunny-free", contextWindow: 1_000_000, input: ["text", "image"] });
    expect(r.streamIdleTimeoutMs).toBeUndefined();
    expect(r.models[0].maxTokens).toBe(131_072);
    expect(r.models[0].reasoningEfforts).toEqual({ off: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" });
    // Nothing is written to .env: there is no key variable.
    expect(existsSync(join(h, ".env"))).toBe(false);
  });

  test("what the file already says is kept, comments included, and the default model is not touched", async () => {
    const h = await home();
    const original = [
      "# my own models",
      "llm-pi-ai:",
      "  providers:",
      "    local:",
      "      baseURL: http://127.0.0.1:8081/v1   # the big machine",
      "      apiKeyEnv: BRUINE_LOCAL_API_KEY",
      "      models:",
      "        - id: m1",
      "agent-default-model:",
      "  provider: local",
      "  model: m1",
      "",
    ].join("\n");
    await writeFile(join(h, "settings.yaml"), original);
    expect(await addSpaceBunnyToHome(h)).toBe("added");
    const text = await readFile(join(h, "settings.yaml"), "utf8");
    expect(text).toContain("# my own models");
    expect(text).toContain("# the big machine");
    const doc = parse(text) as Record<string, any>;
    expect(doc["agent-default-model"]).toEqual({ provider: "local", model: "m1" });
    expect(Object.keys(doc["llm-pi-ai"].providers)).toEqual(["local", "opencode-zen"]);
  });

  test("a route that is already there is left alone, and doing it twice changes nothing", async () => {
    const h = await home();
    await addSpaceBunnyToHome(h);
    const first = await readFile(join(h, "settings.yaml"), "utf8");
    expect(await addSpaceBunnyToHome(h)).toBe("present");
    expect(await readFile(join(h, "settings.yaml"), "utf8")).toBe(first);
  });

  test("the file is owner-only where the platform has modes", async () => {
    if (process.platform === "win32") return;
    const h = await home();
    await addSpaceBunnyToHome(h);
    expect((await stat(join(h, "settings.yaml"))).mode & 0o077).toBe(0);
  });
});

describe("repairSpaceBunnyRoute: the first version of the route", () => {
  test("a key variable the running session cannot see becomes the header, and the two levels become the real ones", async () => {
    const h = await home();
    await writeFile(join(h, "settings.yaml"), OLD);
    expect(await repairSpaceBunnyRoute(h)).toBe(true);
    const r = await route(h);
    expect(r.apiKeyEnv).toBeUndefined();
    expect(r.headers).toEqual({ Authorization: "Bearer public" });
    expect(Object.keys(r.models[0].reasoningEfforts)).toEqual(["off", "low", "medium", "high", "xhigh", "max"]);
    const text = await readFile(join(h, "settings.yaml"), "utf8");
    expect(text).toContain("# my own models");
    expect(text).toContain("# the big machine");
    expect(parse(text)["agent-default-model"]).toEqual({ provider: "opencode-zen", model: "space-bunny-free" });
  });

  test("it is done once: a second pass changes nothing", async () => {
    const h = await home();
    await writeFile(join(h, "settings.yaml"), OLD);
    await repairSpaceBunnyRoute(h);
    const after = await readFile(join(h, "settings.yaml"), "utf8");
    expect(await repairSpaceBunnyRoute(h)).toBe(false);
    expect(await readFile(join(h, "settings.yaml"), "utf8")).toBe(after);
  });

  test("a route the user changed on purpose keeps every choice, and only learns that the model takes images", async () => {
    const h = await home();
    const mine = OLD.replace("apiKeyEnv: BRUINE_ZEN_API_KEY", "apiKeyEnv: MY_OWN_KEY").replace(
      "          reasoningEfforts:\n            off: null\n            low: low\n",
      "          reasoningEfforts:\n            off: null\n            low: low\n            ultra: max\n",
    );
    await writeFile(join(h, "settings.yaml"), mine);
    expect(await repairSpaceBunnyRoute(h)).toBe(true);
    const r = await route(h);
    expect(r.apiKeyEnv).toBe("MY_OWN_KEY");
    expect(r.models[0].reasoningEfforts).toEqual({ off: null, low: "low", ultra: "max" });
    expect(r.models[0].input).toEqual(["text", "image"]);
  });

  test("a route written without inputs, which the harness reads as text only, takes images after the repair", async () => {
    const h = await home();
    await addSpaceBunnyToHome(h);
    const text = await readFile(join(h, "settings.yaml"), "utf8");
    await writeFile(join(h, "settings.yaml"), text.replace(/\n\s+input:\n(\s+- \w+\n)+/, "\n"));
    expect((await route(h)).models[0].input).toBeUndefined();
    expect(await repairSpaceBunnyRoute(h)).toBe(true);
    expect((await route(h)).models[0].input).toEqual(["text", "image"]);
    expect(await repairSpaceBunnyRoute(h)).toBe(false);
  });

  test("the two-minute stream timeout an earlier version wrote is removed, any other value is kept", async () => {
    const h = await home();
    await addSpaceBunnyToHome(h);
    const text = await readFile(join(h, "settings.yaml"), "utf8");
    await writeFile(join(h, "settings.yaml"), text.replace("headers:", "streamIdleTimeoutMs: 120000\n      headers:"));
    expect((await route(h)).streamIdleTimeoutMs).toBe(120_000);
    expect(await repairSpaceBunnyRoute(h)).toBe(true);
    expect((await route(h)).streamIdleTimeoutMs).toBeUndefined();
    expect(await repairSpaceBunnyRoute(h)).toBe(false);
    const again = await readFile(join(h, "settings.yaml"), "utf8");
    await writeFile(join(h, "settings.yaml"), again.replace("headers:", "streamIdleTimeoutMs: 45000\n      headers:"));
    expect(await repairSpaceBunnyRoute(h)).toBe(false);
    expect((await route(h)).streamIdleTimeoutMs).toBe(45_000);
  });

  test("a model with no output limit gets 128k so a large write is not cut at 32k, and a limit the user set is kept", async () => {
    const h = await home();
    await writeFile(join(h, "settings.yaml"), OLD);
    await repairSpaceBunnyRoute(h);
    expect((await route(h)).models[0].maxTokens).toBe(131_072);
    const text = await readFile(join(h, "settings.yaml"), "utf8");
    await writeFile(join(h, "settings.yaml"), text.replace("maxTokens: 131072", "maxTokens: 20000"));
    expect(await repairSpaceBunnyRoute(h)).toBe(false);
    expect((await route(h)).models[0].maxTokens).toBe(20_000);
  });

  test("an input list the user wrote is not overridden", async () => {
    const h = await home();
    await addSpaceBunnyToHome(h);
    const text = await readFile(join(h, "settings.yaml"), "utf8");
    await writeFile(join(h, "settings.yaml"), text.replace(/input:\n(\s+- \w+\n)+/, "input:\n          - text\n"));
    expect(await repairSpaceBunnyRoute(h)).toBe(false);
    expect((await route(h)).models[0].input).toEqual(["text"]);
  });

  test("no file, no route, or an unreadable file: nothing to do and no error", async () => {
    const h = await home();
    expect(await repairSpaceBunnyRoute(h)).toBe(false);
    await writeFile(join(h, "settings.yaml"), "agent-default-model:\n  provider: x\n  model: y\n");
    expect(await repairSpaceBunnyRoute(h)).toBe(false);
    await writeFile(join(h, "settings.yaml"), ": : not yaml : [");
    expect(await repairSpaceBunnyRoute(h)).toBe(false);
  });
});
