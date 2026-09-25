import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, test } from "vitest";
import {
  deepseekSettings,
  discoverLocalServer,
  localServerSettings,
  openrouterSettings,
  pickModel,
  probePort,
  renderSettingsYaml,
  simpleSetup,
  writeEnvVar,
  type FetchLike,
  type SetupIO,
} from "../src/setup/simple.js";

const okFetch = (models: unknown[]): FetchLike => async () => ({
  ok: true,
  json: async () => ({ data: models }),
});
const deadFetch: FetchLike = async () => {
  throw new Error("ECONNREFUSED");
};

function fakeIO(answers: string[], isTTY = true) {
  const out: string[] = [];
  const asked: string[] = [];
  const io: SetupIO = {
    isTTY,
    write: (s) => out.push(s),
    question: async (q) => {
      asked.push(q);
      return answers.shift() ?? "";
    },
  };
  return { io, out, asked };
}

describe("probePort", () => {
  test("returns models on success", async () => {
    const hit = await probePort(8080, { fetchImpl: okFetch([{ id: "a" }, { id: "b" }]) });
    expect(hit).toEqual({ port: 8080, baseUrl: "http://127.0.0.1:8080/v1", models: ["a", "b"] });
  });

  test("fetches the right URL", async () => {
    let url = "";
    const fetchImpl: FetchLike = async (u) => {
      url = u;
      return { ok: true, json: async () => ({ data: [{ id: "x" }] }) };
    };
    await probePort(11434, { fetchImpl });
    expect(url).toBe("http://127.0.0.1:11434/v1/models");
  });

  test("connection refused → undefined", async () => {
    expect(await probePort(1, { fetchImpl: deadFetch })).toBeUndefined();
  });

  test("non-ok response → undefined", async () => {
    const fetchImpl: FetchLike = async () => ({ ok: false, json: async () => ({}) });
    expect(await probePort(1, { fetchImpl })).toBeUndefined();
  });

  test("ok but no models → undefined", async () => {
    expect(await probePort(1, { fetchImpl: okFetch([]) })).toBeUndefined();
  });
});

describe("discoverLocalServer", () => {
  test("first answer wins", async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (String(url).includes(":8082")) {
        return { ok: true, json: async () => ({ data: [{ id: "m" }] }) };
      }
      throw new Error("refused");
    };
    const hit = await discoverLocalServer([8080, 8081, 8082, 8083], { fetchImpl });
    expect(hit?.port).toBe(8082);
  });

  test("no server anywhere → undefined", async () => {
    expect(await discoverLocalServer([1, 2], { fetchImpl: deadFetch })).toBeUndefined();
  });

  test("empty port list → undefined", async () => {
    expect(await discoverLocalServer([], { fetchImpl: deadFetch })).toBeUndefined();
  });
});

describe("pickModel", () => {
  test("prefers a non-embedding model", () => {
    expect(pickModel(["nomic-embed-text", "qwen2.5"])).toBe("qwen2.5");
  });
  test("only embeddings → first one", () => {
    expect(pickModel(["a-embed", "b-embeddings"])).toBe("a-embed");
  });
});

describe("renderSettingsYaml", () => {
  test("round-trips the local server document", () => {
    const doc = localServerSettings({ port: 8080, baseUrl: "http://127.0.0.1:8080/v1", models: ["qwen2.5:latest"] }, "qwen2.5:latest");
    const parsed = parseYaml(renderSettingsYaml(doc));
    expect(parsed).toEqual(doc);
    expect(parsed["agent-default-model"]).toEqual({ provider: "local", model: "qwen2.5:latest" });
    expect(parsed["llm-pi-ai"].providers.local.api).toBe("openai-completions");
  });

  test("round-trips deepseek and openrouter documents", () => {
    expect(parseYaml(renderSettingsYaml(deepseekSettings()))).toEqual(deepseekSettings());
    expect(parseYaml(renderSettingsYaml(openrouterSettings()))).toEqual(openrouterSettings());
    const or = openrouterSettings() as any;
    expect(or["llm-pi-ai"].providers.openrouter.apiKeyEnv).toBe("OPENROUTER_API_KEY");
  });
});

describe("writeEnvVar", () => {
  test("creates an owner-only file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kumo-env-"));
    const envPath = join(dir, ".env");
    await writeEnvVar(envPath, "DEEPSEEK_API_KEY", "sk-1");
    expect(await readFile(envPath, "utf8")).toBe("DEEPSEEK_API_KEY=sk-1\n");
    const mode = (await stat(envPath)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test("replaces an existing key and keeps others", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kumo-env-"));
    const envPath = join(dir, ".env");
    await writeFile(envPath, "OTHER=1\nDEEPSEEK_API_KEY=old\n");
    await writeEnvVar(envPath, "DEEPSEEK_API_KEY", "new");
    expect(await readFile(envPath, "utf8")).toBe("OTHER=1\nDEEPSEEK_API_KEY=new\n");
  });
});

describe("simpleSetup", () => {
  test("local server found → settings.yaml written, no questions", async () => {
    const home = await mkdtemp(join(tmpdir(), "kumo-setup-"));
    const { io, asked } = fakeIO([]);
    const outcome = await simpleSetup(home, io, {
      ports: [8080],
      fetchImpl: okFetch([{ id: "nomic-embed" }, { id: "llama3" }]),
    });
    expect(outcome).toEqual({ kind: "local", port: 8080, model: "llama3" });
    expect(asked).toEqual([]);
    const parsed = parseYaml(await readFile(join(home, "settings.yaml"), "utf8"));
    expect(parsed["agent-default-model"]).toEqual({ provider: "local", model: "llama3" });
    expect(parsed["llm-pi-ai"].providers.local.models).toEqual([{ id: "llama3", name: "llama3" }]);
  });

  test("no server, TTY → DeepSeek key flow", async () => {
    const home = await mkdtemp(join(tmpdir(), "kumo-setup-"));
    const { io, asked } = fakeIO(["1", "sk-abc"]);
    const outcome = await simpleSetup(home, io, { ports: [1], fetchImpl: deadFetch });
    expect(outcome).toEqual({ kind: "deepseek" });
    expect(asked.length).toBe(2);
    const parsed = parseYaml(await readFile(join(home, "settings.yaml"), "utf8"));
    expect(parsed["agent-default-model"]).toEqual({
      provider: "deepseek-official",
      model: "deepseek-flash",
    });
    expect(await readFile(join(home, ".env"), "utf8")).toBe("DEEPSEEK_API_KEY=sk-abc\n");
  });

  test("no server, TTY → OpenRouter key flow", async () => {
    const home = await mkdtemp(join(tmpdir(), "kumo-setup-"));
    const { io } = fakeIO(["2", "sk-or-1"]);
    const outcome = await simpleSetup(home, io, { ports: [1], fetchImpl: deadFetch });
    expect(outcome).toEqual({ kind: "openrouter" });
    const parsed = parseYaml(await readFile(join(home, "settings.yaml"), "utf8"));
    expect(parsed["agent-default-model"]).toEqual({ provider: "openrouter", model: "openrouter/auto" });
    expect(await readFile(join(home, ".env"), "utf8")).toBe("OPENROUTER_API_KEY=sk-or-1\n");
  });

  test("empty key → skipped, nothing written", async () => {
    const home = await mkdtemp(join(tmpdir(), "kumo-setup-"));
    const { io } = fakeIO(["1", ""]);
    const outcome = await simpleSetup(home, io, { ports: [1], fetchImpl: deadFetch });
    expect(outcome).toEqual({ kind: "skipped" });
    await expect(stat(join(home, "settings.yaml"))).rejects.toThrow();
  });

  test("no server, not a TTY → skipped with guidance", async () => {
    const home = await mkdtemp(join(tmpdir(), "kumo-setup-"));
    const { io, out, asked } = fakeIO([], false);
    const outcome = await simpleSetup(home, io, { ports: [1], fetchImpl: deadFetch });
    expect(outcome).toEqual({ kind: "skipped" });
    expect(asked).toEqual([]);
    expect(out.join("")).toContain("No local model server found");
  });

  test("existing settings.yaml is never touched", async () => {
    const home = await mkdtemp(join(tmpdir(), "kumo-setup-"));
    await writeFile(join(home, "settings.yaml"), "agent-default-model:\n  provider: x\n  model: y\n");
    let probed = false;
    const outcome = await simpleSetup(home, fakeIO([]).io, {
      ports: [1],
      fetchImpl: async () => {
        probed = true;
        throw new Error("no");
      },
    });
    expect(outcome).toEqual({ kind: "skipped" });
    expect(probed).toBe(false);
    expect(await readFile(join(home, "settings.yaml"), "utf8")).toContain("provider: x");
  });
});
