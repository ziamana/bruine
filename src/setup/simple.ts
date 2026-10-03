import { configReadPath, configWritePath } from "../compat.js";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEEPSEEK_DEFAULT_MODEL, DEEPSEEK_OFFICIAL, loadCloudProviders } from "./cloud.js";
import { fetchProps, type TemplateCaps } from "./discover.js";
import { SPACE_BUNNY, SPACE_BUNNY_NOTICE, spaceBunnySettings } from "./spacebunny.js";

/** Ports probed on 127.0.0.1 for an OpenAI-compatible model server. */
export const PROBE_PORTS = [
  8080, 8081, 8082, 8083, 8084, 8085, 8086, 8087, 8088, 8089, 8090, 11434, 1234,
  8000,
];

export interface ProbeHit {
  baseUrl: string;
  port?: number;
  models: string[];
  /** T34: thinking switches the server's chat template honors (/props). */
  template?: TemplateCaps;
}

export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; json(): Promise<any> }>;

export interface ProbeOptions {
  host?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

/** GET {baseUrl}/models; resolves undefined on any failure. */
export async function probeUrl(
  baseUrl: string,
  opts: { timeoutMs?: number; fetchImpl?: FetchLike } = {},
): Promise<ProbeHit | undefined> {
  const timeoutMs = opts.timeoutMs ?? 400;
  const doFetch = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  try {
    const res = await doFetch(`${baseUrl}/models`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return undefined;
    const body = await res.json();
    const models: string[] = Array.isArray(body?.data)
      ? body.data.map((m: any) => String(m?.id)).filter((id: string) => id !== "" && id !== "undefined")
      : [];
    if (models.length === 0) return undefined;
    let port: number | undefined;
    let host = "127.0.0.1";
    try {
      const u = new URL(baseUrl);
      port = Number(u.port) || undefined;
      host = u.hostname;
    } catch {
      port = undefined;
    }
    // T34: llama.cpp answers /props at the ORIGIN root (not under /v1) — the
    // chat template decides which thinking switches are actually honored.
    let template: ProbeHit["template"];
    if (port !== undefined && (host === "127.0.0.1" || host === "localhost")) {
      template = (await fetchProps(host, port, doFetch, timeoutMs))?.template;
    }
    return { baseUrl, port, models, ...(template !== undefined ? { template } : {}) };
  } catch {
    return undefined;
  }
}

/**
 * T34: the per-model `compat` + `reasoningEfforts` settings block for one
 * detected template. Only chat-template models get a `compat` — Ollama, LM
 * Studio and cloud keep pi-ai's own detection. The effort levels are the
 * pi-ai names: `off` + the template's wire spellings; `xhigh` is never
 * declared (BOS journal 15/09: on Qwen 3.8 it produces empty answers).
 */
export function reasoningSettingsFor(c: TemplateCaps): {
  compat?: { thinkingFormat: "chat-template"; chatTemplateKwargs: Record<string, unknown> };
  reasoningEfforts: Record<string, string | null>;
} {
  if (!c.enableThinking && !c.reasoningEffort) {
    return { reasoningEfforts: { off: null, low: "low" } };
  }
  const kwargs: Record<string, unknown> = {};
  if (c.enableThinking) kwargs.enable_thinking = { $var: "thinking.enabled" };
  if (c.reasoningEffort) kwargs.reasoning_effort = { $var: "thinking.effort", omitWhenOff: true };
  if (c.preserveThinking) kwargs.preserve_thinking = true;
  return {
    compat: { thinkingFormat: "chat-template", chatTemplateKwargs: kwargs },
    // enable_thinking-only templates are binary: `on` is carried by the
    // `low` level (its wire spelling never leaves bruine — the template only
    // reads thinking.enabled).
    reasoningEfforts: c.reasoningEffort
      ? { off: null, low: "low", medium: "medium", high: "high" }
      : { off: null, low: "on" },
  };
}

/** GET /v1/models on one port; resolves undefined on any failure. */
export function probePort(port: number, opts: ProbeOptions = {}): Promise<ProbeHit | undefined> {
  const host = opts.host ?? "127.0.0.1";
  return probeUrl(`http://${host}:${port}/v1`, opts);
}

/** Probe every port at once; the first answer wins. */
export function discoverLocalServer(
  ports: number[] = PROBE_PORTS,
  opts: ProbeOptions = {},
): Promise<ProbeHit | undefined> {
  return new Promise((resolve) => {
    if (ports.length === 0) {
      resolve(undefined);
      return;
    }
    let pending = ports.length;
    let settled = false;
    for (const port of ports) {
      void probePort(port, opts).then((hit) => {
        if (settled) return;
        if (hit !== undefined) {
          settled = true;
          resolve(hit);
        } else {
          pending -= 1;
          if (pending === 0) resolve(undefined);
        }
      });
    }
  });
}

/** Prefer a chat model over embedding/vision-only ones. */
export function pickModel(models: string[]): string {
  const chat = models.find((id) => !/embed/i.test(id));
  return chat ?? models[0] ?? "";
}

/**
 * Normalise a typed server address: add `http://` when missing and a trailing
 * `/v1` when the path does not already end with one.
 */
export function normalizeServerUrl(input: string): string | undefined {
  const raw = input.trim();
  if (raw === "") return undefined;
  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `http://${raw}`);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  let path = url.pathname.replace(/\/+$/, "");
  if (!/\/v1$/.test(path)) path = `${path}/v1`;
  url.pathname = path;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export type SettingsDoc = Record<string, unknown>;

/** pi-ai requires a key on every route; local servers ignore its value. */
export const LOCAL_API_KEY_ENV = "BRUINE_LOCAL_API_KEY";

export function localServerSettings(hit: ProbeHit, model: string): SettingsDoc {
  const reasoning =
    hit.template !== undefined
      ? reasoningSettingsFor(hit.template)
      : // T19.A.2: at minimum declare an `off` effort (dsh requires one
        // level beyond "off") so the Auto-mode judge can get a plain answer.
        { reasoningEfforts: { off: null, low: "low" } as Record<string, string | null> };
  return {
    "llm-pi-ai": {
      providers: {
        local: {
          displayName: "Local Server",
          api: "openai-completions",
          baseURL: hit.baseUrl,
          apiKeyEnv: LOCAL_API_KEY_ENV,
          models: [
            {
              id: model,
              name: model,
              ...(reasoning.compat !== undefined ? { compat: reasoning.compat } : {}),
              reasoningEfforts: reasoning.reasoningEfforts,
            },
          ],
        },
      },
    },
    "agent-default-model": { provider: "local", model },
  };
}

/** dsh-base already ships the deepseek-official route; only the default model is stated. */
export function deepseekSettings(): SettingsDoc {
  return {
    "agent-default-model": { provider: "deepseek-official", model: "deepseek-flash" },
  };
}

export function openrouterSettings(): SettingsDoc {
  return {
    "llm-pi-ai": {
      providers: {
        openrouter: { apiKeyEnv: "OPENROUTER_API_KEY" },
      },
    },
    "agent-default-model": { provider: "openrouter", model: "openrouter/auto" },
  };
}

const BARE_KEY = /^[A-Za-z0-9_.-]+$/;

function yamlKey(key: string): string {
  return BARE_KEY.test(key) ? key : JSON.stringify(key);
}

function yamlScalar(value: unknown): string {
  if (value === null || value === undefined) return "''";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

function isContainer(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

function emitLines(value: unknown, indent: number): string[] {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    const lines: string[] = [];
    for (const item of value) {
      if (isContainer(item)) {
        const child = emitLines(item, indent + 2);
        lines.push(`${pad}- ${child[0].trimStart()}`, ...child.slice(1));
      } else {
        lines.push(`${pad}- ${yamlScalar(item)}`);
      }
    }
    return lines;
  }
  if (isContainer(value)) {
    const lines: string[] = [];
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (isContainer(child)) {
        lines.push(`${pad}${yamlKey(key)}:`, ...emitLines(child, indent + 2));
      } else if (child === null) {
        // A valueless key (the `off:` spelling in reasoningEfforts).
        lines.push(`${pad}${yamlKey(key)}:`);
      } else {
        lines.push(`${pad}${yamlKey(key)}: ${yamlScalar(child)}`);
      }
    }
    return lines;
  }
  return [`${pad}${yamlScalar(value)}`];
}

/** Minimal deterministic YAML for the fixed settings shape bruine writes. */
export function renderSettingsYaml(doc: SettingsDoc): string {
  const header = "# Generated by bruine setup. Edit freely; this file is hot-reloaded.\n";
  return header + emitLines(doc, 0).join("\n") + "\n";
}

export async function writeAtomic(path: string, content: string, mode?: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, content, { encoding: "utf8", ...(mode !== undefined ? { mode } : {}) });
  if (mode !== undefined) await chmod(tmp, mode);
  await rename(tmp, path);
}

/** Set or replace one KEY=value line, keeping the file owner-only. */
export async function writeEnvVar(
  envPath: string,
  key: string,
  value: string,
): Promise<void> {
  let text = "";
  try {
    text = await readFile(envPath, "utf8");
  } catch {
    text = "";
  }
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  const next = re.test(text)
    ? text.replace(re, line)
    : text === "" || text.endsWith("\n")
      ? `${text}${line}\n`
      : `${text}\n${line}\n`;
  await writeAtomic(envPath, next, 0o600);
}

export interface SetupIO {
  isTTY: boolean;
  write(text: string): void;
  question(q: string): Promise<string>;
  /** Read a secret (API key) WITHOUT echoing it. */
  secret(q: string): Promise<string>;
}

export type SetupOutcome =
  | { kind: "local"; baseUrl: string; model: string }
  | { kind: "deepseek" }
  | { kind: "openrouter" }
  | { kind: "cloud"; provider: string; model: string }
  | { kind: "free" }
  | { kind: "skipped" };

export interface SearchChoice {
  provider: "none" | "searxng" | "brave" | "tavily";
  url?: string;
  apiKeyEnv?: string;
}

/** Probe localhost for a SearXNG instance (JSON API answers with results). */
export async function detectSearxng(
  opts: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<string | undefined> {
  const doFetch = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  for (const port of [8888, 8080]) {
    const url = `http://127.0.0.1:${port}`;
    try {
      const res = await doFetch(`${url}/search?q=ping&format=json`, {
        signal: AbortSignal.timeout(opts.timeoutMs ?? 300),
      });
      if (!res.ok) continue;
      const body = await res.json();
      if (Array.isArray(body?.results)) return url;
    } catch {
      // not here
    }
  }
  return undefined;
}

async function writeBruineJson(dshHome: string, search: SearchChoice): Promise<void> {
  const bruineJsonPath = configWritePath(dshHome);
  let doc: Record<string, unknown> = {};
  try {
    doc = JSON.parse(await readFile(configReadPath(dshHome), "utf8")) as Record<string, unknown>;
  } catch {
    doc = {};
  }
  doc.mode = "simple";
  doc.search = search;
  if (doc.permissionMode === undefined && doc.access === undefined) {
    doc.permissionMode = "auto";
  }
  await writeAtomic(bruineJsonPath, `${JSON.stringify(doc, null, 2)}\n`);
}

/** Offer web search configuration and persist it to bruine.json. */
export async function askSearch(
  dshHome: string,
  io: SetupIO,
  opts: { fetchImpl?: FetchLike } = {},
): Promise<SearchChoice> {
  const detected = await detectSearxng(opts);
  const hint = detected !== undefined ? `   (SearXNG detected on ${detected})` : "";
  const ans = (
    await io.question(`Web search:  1) None${hint}  2) SearXNG  3) Brave  4) Tavily  [1] `)
  ).trim();

  let choice: SearchChoice = { provider: "none" };
  if (ans.startsWith("2")) {
    const fallback = detected ?? "http://127.0.0.1:8888";
    const urlAns = (await io.question(`SearXNG URL [${fallback}]: `)).trim();
    choice = { provider: "searxng", url: urlAns === "" ? fallback : urlAns };
  } else if (ans.startsWith("3")) {
    const key = (await io.secret("Brave Search API key: ")).trim();
    if (key === "") {
      io.write("No key entered. Web search stays off.\n");
    } else {
      await writeEnvVar(join(dshHome, ".env"), "BRAVE_API_KEY", key);
      choice = { provider: "brave", apiKeyEnv: "BRAVE_API_KEY" };
    }
  } else if (ans.startsWith("4")) {
    const key = (await io.secret("Tavily API key: ")).trim();
    if (key === "") {
      io.write("No key entered. Web search stays off.\n");
    } else {
      await writeEnvVar(join(dshHome, ".env"), "TAVILY_API_KEY", key);
      choice = { provider: "tavily", apiKeyEnv: "TAVILY_API_KEY" };
    }
  }
  await writeBruineJson(dshHome, choice);
  return choice;
}

async function askProviderKey(
  dshHome: string,
  io: SetupIO,
  provider: "deepseek" | "openrouter",
  opts: { fetchImpl?: FetchLike } = {},
): Promise<SetupOutcome> {
  const keyLabel = provider === "deepseek" ? "DeepSeek" : "OpenRouter";
  const key = (await io.secret(`${keyLabel} API key: `)).trim();
  if (key === "") {
    io.write("No key entered. Skipping. You can add one later in the bruine home .env file\n");
    return { kind: "skipped" };
  }
  const settingsPath = join(dshHome, "settings.yaml");
  const doc = provider === "deepseek" ? deepseekSettings() : openrouterSettings();
  await writeAtomic(settingsPath, renderSettingsYaml(doc), 0o600);
  const envKey = provider === "deepseek" ? "DEEPSEEK_API_KEY" : "OPENROUTER_API_KEY";
  await writeEnvVar(join(dshHome, ".env"), envKey, key);
  io.write(`Saved. Your API key is stored in ${join(dshHome, ".env")} (owner-only).\n`);
  await askSearch(dshHome, io, opts);
  return { kind: provider };
}

/** The free model, after a yes: its route, its public key, then the web search offer. */
async function useSpaceBunny(dshHome: string, io: SetupIO, opts: { fetchImpl?: FetchLike }): Promise<SetupOutcome> {
  await writeAtomic(join(dshHome, "settings.yaml"), renderSettingsYaml(spaceBunnySettings()), 0o600);
  io.write("Using Space Bunny Free through OpenCode Zen.\n");
  await askSearch(dshHome, io, opts);
  return { kind: "free" };
}

/** Any other provider of the catalog: its name, its key, one of its models. */
async function askOtherCloud(
  dshHome: string,
  io: SetupIO,
  opts: { fetchImpl?: FetchLike },
): Promise<SetupOutcome | "retry"> {
  const providers = await loadCloudProviders();
  io.write(`Providers: ${providers.map((p) => p.id).join(", ")}\n`);
  const raw = (await io.question("Provider (name or id): ")).trim().toLowerCase();
  const exact = providers.find((p) => p.id === raw || p.name.toLowerCase() === raw);
  const near = providers.filter((p) => raw !== "" && (p.id.includes(raw) || p.name.toLowerCase().includes(raw)));
  const provider = exact ?? (near.length === 1 ? near[0] : undefined);
  if (provider === undefined) {
    io.write(near.length > 1 ? `More than one match: ${near.map((p) => p.id).join(", ")}.\n` : `No provider named "${raw}".\n`);
    return "retry";
  }
  const key = (await io.secret(`${provider.name} API key: `)).trim();
  if (key === "") {
    io.write("No key entered. Skipping. You can add one later in the bruine home .env file\n");
    return { kind: "skipped" };
  }
  let model: string;
  if (provider.models.length === 0) {
    const def = provider.id === DEEPSEEK_OFFICIAL.id ? DEEPSEEK_DEFAULT_MODEL : "";
    model = (await io.question(`Model id${def !== "" ? ` [${def}]` : ""}: `)).trim() || def;
    if (model === "") {
      io.write("A model id is needed.\n");
      return "retry";
    }
  } else {
    const shown = provider.models.slice(0, 12);
    io.write(`Models: ${shown.map((m, i) => `[${String(i + 1)}] ${m.id}`).join("   ")}${provider.models.length > shown.length ? `   (+${String(provider.models.length - shown.length)} more: type an id)` : ""}\n`);
    const pick = (await io.question("Model number or id [1]: ")).trim();
    const n = Number.parseInt(pick, 10);
    model = pick === "" ? (shown[0]?.id ?? "") : Number.isInteger(n) && String(n) === pick ? (shown[Math.min(Math.max(n - 1, 0), shown.length - 1)]?.id ?? "") : pick;
  }
  const doc: SettingsDoc = {
    ...(provider.id === DEEPSEEK_OFFICIAL.id ? {} : { "llm-pi-ai": { providers: { [provider.id]: { apiKeyEnv: provider.keyEnv } } } }),
    "agent-default-model": { provider: provider.id, model },
  };
  await writeAtomic(join(dshHome, "settings.yaml"), renderSettingsYaml(doc), 0o600);
  await writeEnvVar(join(dshHome, ".env"), provider.keyEnv, key);
  io.write(`Saved. Your API key is stored in ${join(dshHome, ".env")} (owner-only).\n`);
  await askSearch(dshHome, io, opts);
  return { kind: "cloud", provider: provider.id, model };
}

async function askServerAddress(
  dshHome: string,
  io: SetupIO,
  opts: { fetchImpl?: FetchLike },
): Promise<SetupOutcome | "retry"> {
  const raw = await io.question("Server URL (e.g. http://192.168.1.64:8081): ");
  const baseUrl = normalizeServerUrl(raw);
  if (baseUrl === undefined) {
    io.write("That is not a valid URL.\n");
    return "retry";
  }
  const hit = await probeUrl(baseUrl, { ...opts, timeoutMs: 3000 });
  if (hit === undefined) {
    io.write(`Could not reach ${baseUrl} (no /v1/models answer).\n`);
    return "retry";
  }
  io.write(`Models: ${hit.models.map((m, i) => `[${i + 1}] ${m}`).join("   ")}\n`);
  const pick = await io.question("Model number [1]: ");
  const n = Number.parseInt(pick.trim(), 10);
  const index = Number.isNaN(n) ? 0 : Math.min(Math.max(n - 1, 0), hit.models.length - 1);
  const model = hit.models[index] ?? "";
  const settingsPath = join(dshHome, "settings.yaml");
  await writeAtomic(settingsPath, renderSettingsYaml(localServerSettings(hit, model)), 0o600);
  await writeEnvVar(join(dshHome, ".env"), LOCAL_API_KEY_ENV, "local");
  io.write(`Using model: ${model} at ${baseUrl}\n`);
  await askSearch(dshHome, io, opts);
  return { kind: "local", baseUrl, model };
}

/**
 * First-run setup: find a local OpenAI-compatible server, else offer a manual
 * server address or one API key. Idempotent: an existing settings.yaml is
 * never touched.
 */
export async function simpleSetup(
  dshHome: string,
  io: SetupIO,
  opts: ProbeOptions & { ports?: number[] } = {},
): Promise<SetupOutcome> {
  const settingsPath = join(dshHome, "settings.yaml");
  if (existsSync(settingsPath)) return { kind: "skipped" };

  io.write("bruine setup: looking for a local model server…\n");
  const hit = await discoverLocalServer(opts.ports ?? PROBE_PORTS, opts);
  if (hit !== undefined) {
    const model = pickModel(hit.models);
    await writeAtomic(settingsPath, renderSettingsYaml(localServerSettings(hit, model)), 0o600);
    await writeEnvVar(join(dshHome, ".env"), LOCAL_API_KEY_ENV, "local");
    io.write(`Found a local model server at ${hit.baseUrl}. Using model: ${model}\n`);
    if (io.isTTY) await askSearch(dshHome, io, opts);
    return { kind: "local", baseUrl: hit.baseUrl, model };
  }

  if (!io.isTTY) {
    io.write(
      "No local model server found. Start one (llama.cpp, ollama, LM Studio…),\n" +
        "or run bruine in a terminal to configure a server or an API key.\n",
    );
    return { kind: "skipped" };
  }

  io.write("No local model server found.\n");
  // The free model is offered once, as a yes or no that starts on no: the answer decides
  // where the user's code goes.
  const free = (await io.question(`${SPACE_BUNNY_NOTICE}\n[y/N] `)).trim().toLowerCase();
  if (free.startsWith("y")) return useSpaceBunny(dshHome, io, opts);
  for (;;) {
    const choice = (
      await io.question("Setup:  1) Enter a server address   2) DeepSeek   3) OpenRouter   4) Other cloud provider   [1] ")
    ).trim();
    if (choice.startsWith("2")) return askProviderKey(dshHome, io, "deepseek", opts);
    if (choice.startsWith("3")) return askProviderKey(dshHome, io, "openrouter", opts);
    if (choice.startsWith("4")) {
      const other = await askOtherCloud(dshHome, io, opts);
      if (other !== "retry") return other;
      continue;
    }
    const result = await askServerAddress(dshHome, io, opts);
    if (result !== "retry") return result;
  }
}
