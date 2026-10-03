import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { addSpaceBunnyToHome } from "../src/setup/zen-route.js";

const home = (): Promise<string> => mkdtemp(join(tmpdir(), "bruine-zen-"));

describe("addSpaceBunnyToHome", () => {
  test("a home with no settings gets the route and the key", async () => {
    const h = await home();
    expect(await addSpaceBunnyToHome(h)).toBe("added");
    const doc = parse(await readFile(join(h, "settings.yaml"), "utf8")) as Record<string, any>;
    expect(doc["llm-pi-ai"].providers["opencode-zen"]).toMatchObject({
      displayName: "OpenCode Zen",
      api: "openai-completions",
      baseURL: "https://opencode.ai/zen/v1",
      apiKeyEnv: "BRUINE_ZEN_API_KEY",
    });
    expect(doc["llm-pi-ai"].providers["opencode-zen"].models[0]).toMatchObject({ id: "space-bunny-free", contextWindow: 1_000_000 });
    expect(await readFile(join(h, ".env"), "utf8")).toBe("BRUINE_ZEN_API_KEY=public\n");
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
    await writeFile(join(h, ".env"), "BRUINE_LOCAL_API_KEY=local\n");
    expect(await addSpaceBunnyToHome(h)).toBe("added");
    const text = await readFile(join(h, "settings.yaml"), "utf8");
    expect(text).toContain("# my own models");
    expect(text).toContain("# the big machine");
    const doc = parse(text) as Record<string, any>;
    expect(doc["agent-default-model"]).toEqual({ provider: "local", model: "m1" });
    expect(doc["llm-pi-ai"].providers.local.models).toEqual([{ id: "m1" }]);
    expect(Object.keys(doc["llm-pi-ai"].providers)).toEqual(["local", "opencode-zen"]);
    expect(await readFile(join(h, ".env"), "utf8")).toBe("BRUINE_LOCAL_API_KEY=local\nBRUINE_ZEN_API_KEY=public\n");
  });

  test("a route that is already there is left alone, and doing it twice changes nothing", async () => {
    const h = await home();
    await addSpaceBunnyToHome(h);
    const first = await readFile(join(h, "settings.yaml"), "utf8");
    expect(await addSpaceBunnyToHome(h)).toBe("present");
    expect(await readFile(join(h, "settings.yaml"), "utf8")).toBe(first);
    expect((await readFile(join(h, ".env"), "utf8")).match(/BRUINE_ZEN_API_KEY/g)).toHaveLength(1);
  });

  test("the files are owner-only where the platform has modes", async () => {
    if (process.platform === "win32") return;
    const h = await home();
    await addSpaceBunnyToHome(h);
    expect((await stat(join(h, "settings.yaml"))).mode & 0o077).toBe(0);
  });
});
