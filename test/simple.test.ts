import { createServer } from "node:http";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { afterAll, describe, expect, test } from "vitest";
import {
  deepseekSettings,
  discoverLocalServer,
  localServerSettings,
  normalizeServerUrl,
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

function fakeIO(opts: { answers?: string[]; secrets?: string[]; isTTY?: boolean } = {}) {
  const out: string[] = [];
  const asked: string[] = [];
  const secretsAsked: string[] = [];
  const answers = [...(opts.answers ?? [])];
  const secrets = [...(opts.secrets ?? [])];
  const io: SetupIO = {
    isTTY: opts.isTTY ?? true,
    write: (s) => out.push(s),
    question: async (q) => {
      asked.push(q);
      return answers.shift() ?? "";
    },
    secret: async (q) => {
      secretsAsked.push(q);
      return secrets.shift() ?? "";
    },
  };
  return { io, out, asked, secretsAsked };
}

describe("probePort", () => {
  test("returns models on success", async () => {
    const hit = await probePort(8080, { fetchImpl: okFetch([{ id: "a" }, { id: "b" }]) });
    expect(hit).toEqual({ port: 8080, baseUrl: "http://127.0.0.1:8080/v1", models: ["a", "b"] });
  });

  test("fetches the right URL", async () => {
    const urls: string[] = [];
    const fetchImpl: FetchLike = async (u) => {
      urls.push(u);
      return { ok: true, json: async () => ({ data: [{ id: "x" }] }) };
    };
    await probePort(11434, { fetchImpl });
    // T34: after /v1/models a localhost probe also reads /props (chat template).
    expect(urls[0]).toBe("http://127.0.0.1:11434/v1/models");
    expect(urls[1]).toBe("http://127.0.0.1:11434/props");
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

describe("normalizeServerUrl (T11.4)", () => {
  test("adds scheme and /v1", () => {
    expect(normalizeServerUrl("192.168.1.64:8081")).toBe("http://192.168.1.64:8081/v1");
    expect(normalizeServerUrl("http://h:8000")).toBe("http://h:8000/v1");
    expect(normalizeServerUrl("http://h:8000/v1")).toBe("http://h:8000/v1");
    expect(normalizeServerUrl("https://h/v1/")).toBe("https://h/v1");
    expect(normalizeServerUrl("http://h:8000/foo")).toBe("http://h:8000/foo/v1");
  });
  test("rejects empty and garbage", () => {
    expect(normalizeServerUrl("   ")).toBeUndefined();
    expect(normalizeServerUrl("not a url at all")).toBeUndefined();
    expect(normalizeServerUrl("ftp://h")).toBeUndefined();
  });
});

describe("renderSettingsYaml", () => {
  test("round-trips the local server document", () => {
    const doc = localServerSettings(
      { baseUrl: "http://127.0.0.1:8080/v1", port: 8080, models: ["qwen2.5:latest"] },
      "qwen2.5:latest",
    );
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
  test("creates the file, owner-only where the platform has modes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kumo-env-"));
    const envPath = join(dir, ".env");
    await writeEnvVar(envPath, "DEEPSEEK_API_KEY", "sk-1");
    expect(await readFile(envPath, "utf8")).toBe("DEEPSEEK_API_KEY=sk-1\n");
    // Windows has no POSIX mode bits — a secret is kept private by an ACL, so
    // there is no 0600 there to assert.
    if (process.platform !== "win32") {
      expect((await stat(envPath)).mode & 0o777).toBe(0o600);
    }
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
    const { io, asked } = fakeIO();
    const outcome = await simpleSetup(home, io, {
      ports: [8080],
      fetchImpl: okFetch([{ id: "nomic-embed" }, { id: "llama3" }]),
    });
    expect(outcome).toEqual({
      kind: "local",
      baseUrl: "http://127.0.0.1:8080/v1",
      model: "llama3",
    });
    expect(asked).toHaveLength(1); // web search offer, default answer ""
    expect(asked[0]).toContain("Web search");
    const kumoJson = JSON.parse(await readFile(join(home, "bruine.json"), "utf8"));
    expect(kumoJson).toEqual({ mode: "simple", permissionMode: "auto", search: { provider: "none" } });
    const parsed = parseYaml(await readFile(join(home, "settings.yaml"), "utf8"));
    expect(parsed["agent-default-model"]).toEqual({ provider: "local", model: "llama3" });
    expect(parsed["llm-pi-ai"].providers.local.models).toEqual([{ id: "llama3", name: "llama3", reasoningEfforts: { off: null, low: "low" } }]);
    expect(parsed["llm-pi-ai"].providers.local.apiKeyEnv).toBe("KUMO_LOCAL_API_KEY");
    expect(await readFile(join(home, ".env"), "utf8")).toBe("KUMO_LOCAL_API_KEY=local\n");
  });

  // T11.1 — the key must NEVER go through the echoing question() prompt.
  test("no server, TTY → DeepSeek: key is read via secret(), never question()", async () => {
    const home = await mkdtemp(join(tmpdir(), "kumo-setup-"));
    const { io, asked, secretsAsked } = fakeIO({ answers: ["n", "2"], secrets: ["sk-abc"] });
    const outcome = await simpleSetup(home, io, { ports: [1], fetchImpl: deadFetch });
    expect(outcome).toEqual({ kind: "deepseek" });
    expect(asked.length).toBe(3); // the free model, the menu, the web search offer
    expect(asked.slice(1).some((q) => /key/i.test(q))).toBe(false);
    expect(secretsAsked).toEqual(["DeepSeek API key: "]);
    const parsed = parseYaml(await readFile(join(home, "settings.yaml"), "utf8"));
    expect(parsed["agent-default-model"]).toEqual({
      provider: "deepseek-official",
      model: "deepseek-flash",
    });
    expect(await readFile(join(home, ".env"), "utf8")).toBe("DEEPSEEK_API_KEY=sk-abc\n");
  });

  test("no server, TTY → OpenRouter key flow via secret()", async () => {
    const home = await mkdtemp(join(tmpdir(), "kumo-setup-"));
    const { io, secretsAsked } = fakeIO({ answers: ["n", "3"], secrets: ["sk-or-1"] });
    const outcome = await simpleSetup(home, io, { ports: [1], fetchImpl: deadFetch });
    expect(outcome).toEqual({ kind: "openrouter" });
    expect(secretsAsked).toEqual(["OpenRouter API key: "]);
    const parsed = parseYaml(await readFile(join(home, "settings.yaml"), "utf8"));
    expect(parsed["agent-default-model"]).toEqual({ provider: "openrouter", model: "openrouter/auto" });
    expect(await readFile(join(home, ".env"), "utf8")).toBe("OPENROUTER_API_KEY=sk-or-1\n");
  });

  test("no server, TTY → the free model is offered first, as a yes or no that starts on no", async () => {
    const home = await mkdtemp(join(tmpdir(), "kumo-setup-"));
    const { io, asked } = fakeIO({ answers: ["", "2"], secrets: ["sk-abc"] });
    await simpleSetup(home, io, { ports: [1], fetchImpl: deadFetch });
    expect(asked[0]).toContain("Space Bunny Free");
    expect(asked[0]).toContain("[y/N]");
    expect(asked[0]).toMatch(/sent to/i);
    expect(asked[0]).toMatch(/end without notice/i);
    // The empty answer was a no: the next question is the menu.
    expect(asked[1]).toContain("Setup:");
  });

  test("yes to the free model → its route and its public key, no key asked", async () => {
    const home = await mkdtemp(join(tmpdir(), "kumo-setup-"));
    const { io, secretsAsked } = fakeIO({ answers: ["y"] });
    const outcome = await simpleSetup(home, io, { ports: [1], fetchImpl: deadFetch });
    expect(outcome).toEqual({ kind: "free" });
    expect(secretsAsked).toEqual([]);
    const parsed = parseYaml(await readFile(join(home, "settings.yaml"), "utf8"));
    expect(parsed["agent-default-model"]).toEqual({ provider: "opencode-zen", model: "space-bunny-free" });
    expect(parsed["llm-pi-ai"].providers["opencode-zen"]).toMatchObject({
      baseURL: "https://opencode.ai/zen/v1",
      apiKeyEnv: "KUMO_ZEN_API_KEY",
    });
    expect(await readFile(join(home, ".env"), "utf8")).toBe("KUMO_ZEN_API_KEY=public\n");
  });

  test("a local server found → the free model is not even mentioned", async () => {
    const home = await mkdtemp(join(tmpdir(), "kumo-setup-"));
    const { io, asked } = fakeIO();
    await simpleSetup(home, io, { ports: [8080], fetchImpl: okFetch([{ id: "llama3" }]) });
    expect(asked.some((q) => q.includes("Space Bunny"))).toBe(false);
  });

  test("4) Other cloud provider → a catalog provider by name, its key, a model by number", async () => {
    const home = await mkdtemp(join(tmpdir(), "kumo-setup-"));
    const { io, secretsAsked, out } = fakeIO({ answers: ["n", "4", "groq", "2"], secrets: ["gsk-1"] });
    const outcome = await simpleSetup(home, io, { ports: [1], fetchImpl: deadFetch });
    expect(outcome.kind).toBe("cloud");
    expect(secretsAsked).toEqual(["Groq API key: "]);
    const parsed = parseYaml(await readFile(join(home, "settings.yaml"), "utf8"));
    expect(parsed["llm-pi-ai"].providers.groq).toEqual({ apiKeyEnv: "GROQ_API_KEY" });
    expect(parsed["agent-default-model"].provider).toBe("groq");
    expect(parsed["agent-default-model"].model).toBe((outcome as { model: string }).model);
    expect(await readFile(join(home, ".env"), "utf8")).toBe("GROQ_API_KEY=gsk-1\n");
    expect(out.join("")).toContain("anthropic");
  });

  test("4) an unknown provider goes back to the menu", async () => {
    const home = await mkdtemp(join(tmpdir(), "kumo-setup-"));
    const { io, out } = fakeIO({ answers: ["n", "4", "nonesuch", "2"], secrets: ["sk-1"] });
    const outcome = await simpleSetup(home, io, { ports: [1], fetchImpl: deadFetch });
    expect(out.join("")).toContain('No provider named "nonesuch"');
    expect(outcome).toEqual({ kind: "deepseek" });
  });

  test("empty key → skipped, nothing written", async () => {
    const home = await mkdtemp(join(tmpdir(), "kumo-setup-"));
    const { io } = fakeIO({ answers: ["n", "2"], secrets: [""] });
    const outcome = await simpleSetup(home, io, { ports: [1], fetchImpl: deadFetch });
    expect(outcome).toEqual({ kind: "skipped" });
    await expect(stat(join(home, "settings.yaml"))).rejects.toThrow();
  });

  test("no server, not a TTY → skipped with guidance", async () => {
    const home = await mkdtemp(join(tmpdir(), "kumo-setup-"));
    const { io, out, asked } = fakeIO({ isTTY: false });
    const outcome = await simpleSetup(home, io, { ports: [1], fetchImpl: deadFetch });
    expect(outcome).toEqual({ kind: "skipped" });
    expect(asked).toEqual([]);
    expect(out.join("")).toContain("No local model server found");
  });

  test("existing settings.yaml is never touched", async () => {
    const home = await mkdtemp(join(tmpdir(), "kumo-setup-"));
    await writeFile(join(home, "settings.yaml"), "agent-default-model:\n  provider: x\n  model: y\n");
    let probed = false;
    const outcome = await simpleSetup(home, fakeIO().io, {
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

  // T11.4 — manual server address against a real local HTTP server.
  test("manual server address: probes, lists models, writes local settings", async () => {
    const server = createServer((req, res) => {
      if (req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "model-a" }, { id: "model-b" }] }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    try {
      const home = await mkdtemp(join(tmpdir(), "kumo-setup-"));
      // menu default (empty → 1), then the URL (without /v1), then pick model 2
      const { io } = fakeIO({ answers: ["n", "", `127.0.0.1:${port}`, "2", ""] });
      const outcome = await simpleSetup(home, io, { ports: [] });
      expect(outcome).toEqual({
        kind: "local",
        baseUrl: `http://127.0.0.1:${port}/v1`,
        model: "model-b",
      });
      const parsed = parseYaml(await readFile(join(home, "settings.yaml"), "utf8"));
      expect(parsed["llm-pi-ai"].providers.local.baseURL).toBe(`http://127.0.0.1:${port}/v1`);
      expect(parsed["agent-default-model"]).toEqual({ provider: "local", model: "model-b" });
      expect(await readFile(join(home, ".env"), "utf8")).toBe("KUMO_LOCAL_API_KEY=local\n");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  test("unreachable address → error, menu again, then a provider works", async () => {
    const home = await mkdtemp(join(tmpdir(), "kumo-setup-"));
    const { io, out } = fakeIO({ answers: ["n", "1", "http://127.0.0.1:1", "2"], secrets: ["sk-1"] });
    const outcome = await simpleSetup(home, io, { ports: [] });
    expect(outcome).toEqual({ kind: "deepseek" });
    expect(out.join("")).toContain("Could not reach");
  });

  // T15 — web search configuration step

  test("Brave key during search step → kumo.json + .env", async () => {
    const home = await mkdtemp(join(tmpdir(), "kumo-setup-"));
    const { io, secretsAsked } = fakeIO({
      answers: ["n", "2", "3"],
      secrets: ["sk-abc", "brave-1"],
    });
    await simpleSetup(home, io, { ports: [1], fetchImpl: deadFetch });
    expect(secretsAsked).toEqual(["DeepSeek API key: ", "Brave Search API key: "]);
    const kumoJson = JSON.parse(await readFile(join(home, "bruine.json"), "utf8"));
    expect(kumoJson.search).toEqual({ provider: "brave", apiKeyEnv: "BRAVE_API_KEY" });
    const env = await readFile(join(home, ".env"), "utf8");
    expect(env).toContain("BRAVE_API_KEY=brave-1");
    expect(env).toContain("DEEPSEEK_API_KEY=sk-abc");
  });

  test("Tavily key during search step", async () => {
    const home = await mkdtemp(join(tmpdir(), "kumo-setup-"));
    const { io } = fakeIO({ answers: ["n", "2", "4"], secrets: ["sk-abc", "tav-1"] });
    await simpleSetup(home, io, { ports: [1], fetchImpl: deadFetch });
    const kumoJson = JSON.parse(await readFile(join(home, "bruine.json"), "utf8"));
    expect(kumoJson.search).toEqual({ provider: "tavily", apiKeyEnv: "TAVILY_API_KEY" });
    expect(await readFile(join(home, ".env"), "utf8")).toContain("TAVILY_API_KEY=tav-1");
  });

  test("detected SearXNG → default URL used", async () => {
    const home = await mkdtemp(join(tmpdir(), "kumo-setup-"));
    const fetchImpl: FetchLike = async (url) => {
      if (url.includes("/search?")) {
        return { ok: true, json: async () => ({ results: [{ url: "u", title: "t", content: "c" }] }) };
      }
      if (url.includes(":8880/v1/models")) {
        return { ok: true, json: async () => ({ data: [{ id: "m" }] }) };
      }
      throw new Error("refused");
    };
    // local server on 8880 answers → setup asks only the search questions
    const { io, asked } = fakeIO({ answers: ["2", ""] });
    const outcome = await simpleSetup(home, io, { ports: [8880], fetchImpl });
    expect(outcome.kind).toBe("local");
    expect(asked[0]).toContain("SearXNG detected on http://127.0.0.1:8888");
    const kumoJson = JSON.parse(await readFile(join(home, "bruine.json"), "utf8"));
    expect(kumoJson.search).toEqual({ provider: "searxng", url: "http://127.0.0.1:8888" });
  });
});
