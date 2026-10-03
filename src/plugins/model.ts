import { SPACE_BUNNY, SPACE_BUNNY_NOTICE } from "../setup/spacebunny.js";
import { addSpaceBunnyToHome, repairSpaceBunnyRoute } from "../setup/zen-route.js";
import { runtimeHome, configReadPath, configWritePath } from "../compat.js";
/**
 * T37 — `/model` and `/provider`: the route, chosen without leaving the session.
 *
 * OpenCode shows every model in a `/models` dialog and every provider in
 * `ctrl+a`; bruine gets the same surface from what dsh already knows. The `llm`
 * runtime IS the catalogue: `listProviders()` for the live routes,
 * `listConfigurableProviders()` for the dormant ones, `listModels(provider)`
 * for what one route advertises right now. No models.dev-style catalog and no
 * cached JSON — a local llama.cpp server is the source of truth, and its
 * loaded model changes without bruine knowing.
 *
 * The switch itself is dsh's own seam: replacing `.current` on the selection
 * ref is exactly what bruine-effort does for the reasoning effort, so the change
 * reaches the NEXT request and nothing else. dsh appends its own durable
 * `[model changed: …]` notice, which is the cache-safe mechanism
 * (ARCHITECTURE §0 — never a prompt rewrite).
 * `agentDefaultModel.saveSelection` writes `agent-default-model` in
 * settings.yaml, so the choice survives a restart without bruine writing YAML.
 *
 * A model the server advertises but settings.yaml does not declare IS
 * accepted: dsh states that catalog membership is advisory and absence is not
 * a rejection, and refusing it would strand a llama.cpp user who just loaded a
 * new model. The picker says the model is not recorded yet, because its pretty
 * name and window stay unknown until `bruine setup` writes it.
 */
import { existsSync, readFileSync } from "node:fs";
import { chmod, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { matchesKey } from "@earendil-works/pi-tui";
import { displayModel } from "../ui/footer.js";
import { formatK } from "../ui/errors.js";
import { readSettingsProviders, type SettingsProvider } from "../ui/bruine-ui.js";
import { BRUINE_EFFORT_SERVICE } from "./effort.js";
import type { DshContext, BruineRepl } from "./ctx.js";

/** Stable Cordis plugin name. */
export const name = "bruine-model";

/** Service published for the REPL slash router. */
export const BRUINE_MODEL_SERVICE = "bruineModel";

/** One exact route. dsh's ModelSelection minus the effort. */
export interface RouteRef {
  provider: string;
  model: string;
}

/** What dsh's llm runtime offers, narrowed to what the picker needs. */
export interface LlmLike {
  listProviders?(): Array<{ id: string; name?: string }>;
  listConfigurableProviders?(): Array<{ provider: string; displayName?: string; error?: string }>;
  listModels?(provider: string): Promise<Array<{ id: string; name?: string; description?: string }>>;
  resolveModelInfo?(provider: string, model: string): Promise<any>;
}

/** The dsh service that owns the persisted default route. */
export interface DefaultModelLike {
  currentSelection?(): RouteRef & { reasoningEffort?: string };
  saveSelection?(next: RouteRef): Promise<void>;
}

export interface ModelUi {
  askChoice?(
    title: string,
    items: Array<{ value: string; label: string }>,
    opts?: { initial?: number },
  ): Promise<number>;
  showNotice?(text: string, opts?: { red?: boolean }): void;
  footer: { set(next: Record<string, unknown>): void };
  requestRender(): void;
  /** T37: drops the memoized header host so a new route shows its own. */
  resetRouteCache?(): void;
  tui?: { addInputListener(fn: (data: string) => { consume?: boolean } | void): () => void };
}

/** One row of the provider picker. */
export interface ProviderRow {
  id: string;
  /** The id when nothing nicer is known; never a bare "undefined". */
  label: string;
  /** False for a provider dsh declares but that is not mounted. */
  live: boolean;
  baseUrl?: string;
  /** The env var holding the key, when the route declares one. */
  apiKeyEnv?: string;
  /** settings.yaml model ids — free, no network. */
  models: Array<{ id: string; name?: string; contextWindow?: number }>;
  /** A configuration diagnostic dsh reported for this route. */
  error?: string;
}

/** One row of the model picker. */
export interface ModelRow {
  id: string;
  /** settings.yaml `name`, when the route declares this model. */
  name?: string;
  contextWindow?: number;
  current: boolean;
}

/** What one route can be switched to. */
export interface RouteModels {
  /** The models the route declares — the only ones that can be dispatched. */
  rows: ModelRow[];
  /**
   * Ids the server advertises but settings.yaml never declared. They are NOT
   * offered: `dsh-llm-pi-ai` resolves a route through the profile's declared
   * models and throws `UNKNOWN_MODEL` otherwise, so picking one would fail on
   * the next message instead of here.
   */
  undeclared: string[];
}

/** `"local/Ornith.gguf"`, and its inverse. */
export function routeKey(route: RouteRef): string {
  return `${route.provider}/${route.model}`;
}

/**
 * `/model <provider>/<model>`, with the provider resolved against the KNOWN
 * provider ids, longest first. Model ids carry slashes of their own
 * (`openrouter/qwen/qwen3-32b`), so a plain `split("/")` would be wrong.
 * A bare provider name resolves to `{ provider, model: "" }` — the caller
 * decides that this means "let the user choose a model". An unknown provider
 * is split at its first slash so the refusal names the provider, not the whole
 * argument. Provider ids are kebab-case (dsh, pi-ai), so a slash never belongs
 * to one.
 */
export function parseRouteArg(arg: string, knownProviders: readonly string[]): RouteRef | undefined {
  const text = arg.trim().replace(/^\/+/, "");
  if (text === "") return undefined;
  for (const provider of [...knownProviders].sort((a, b) => b.length - a.length)) {
    if (text === provider) return { provider, model: "" };
    if (text.startsWith(`${provider}/`)) {
      const model = text.slice(provider.length + 1);
      if (model !== "") return { provider, model };
    }
  }
  const slash = text.indexOf("/");
  return slash < 0 ? { provider: text, model: "" } : { provider: text.slice(0, slash), model: text.slice(slash + 1) };
}

/** The picker label for one model: pretty name, window, then the marker. */
export function modelRowLabel(row: ModelRow): string {
  const name = displayModel(row.id, row.name);
  const window = row.contextWindow !== undefined && row.contextWindow > 0 ? ` ${formatK(row.contextWindow)} ctx` : "";
  return `${name}${window}${row.current ? " (current)" : ""}`;
}

/** The `/provider` line for one route: name, endpoint, key, model count. */
export function providerLine(row: ProviderRow, current: RouteRef | undefined, keyIsSet: boolean): string {
  const marker = current !== undefined && current.provider === row.id ? " (current route)" : "";
  const live = row.live ? "" : " · not configured";
  const where = row.baseUrl !== undefined && row.baseUrl !== "" ? ` · ${row.baseUrl}` : "";
  const key =
    row.apiKeyEnv === undefined
      ? ""
      : keyIsSet
        ? ` · key ${row.apiKeyEnv} set`
        : ` · no ${row.apiKeyEnv}`;
  const count = row.models.length > 0 ? ` · ${String(row.models.length)} model(s)` : " · no models declared";
  const error = row.error !== undefined && row.error !== "" ? ` · ${row.error}` : "";
  return `${row.label} [${row.id}]${marker}${live}${where}${key}${count}${error}`;
}

/**
 * Every route the picker can switch to: the providers dsh has actually mounted
 * (`listProviders`), plus the ones settings.yaml declares — a declared route is
 * the user's own, so it is offered even if dsh has not mounted it yet.
 *
 * dsh's `listConfigurableProviders()` is deliberately NOT walked here: pi-ai
 * ships a directory of ~60 dormant providers (minimax, openai, xai, zai, …),
 * and 60 unselectable rows would bury the two that work. `/provider all` lists
 * them on request; `providerRows(true)` is how.
 */
export function buildProviderRows(
  llm: LlmLike | undefined,
  settings: readonly SettingsProvider[],
  includeDormant = false,
): ProviderRow[] {
  const rows = new Map<string, ProviderRow>();
  const byId = new Map(settings.map((s) => [s.id, s]));
  const ensure = (id: string, label?: string): ProviderRow => {
    const existing = rows.get(id);
    if (existing !== undefined) {
      if (label !== undefined && label !== "" && existing.label === existing.id) existing.label = label;
      return existing;
    }
    const declared = byId.get(id);
    const row: ProviderRow = {
      id,
      label: label ?? declared?.displayName ?? id,
      live: false,
      models: declared?.models ?? [],
    };
    if (declared?.baseUrl !== undefined) row.baseUrl = declared.baseUrl;
    if (declared?.apiKeyEnv !== undefined) row.apiKeyEnv = declared.apiKeyEnv;
    rows.set(id, row);
    return row;
  };

  let live: Array<{ id: string; name?: string }> = [];
  try {
    live = llm?.listProviders?.() ?? [];
  } catch {
    live = [];
  }
  for (const provider of live) {
    if (typeof provider?.id !== "string" || provider.id === "") continue;
    ensure(provider.id, provider.name).live = true;
  }
  let dormant: Array<{ provider: string; displayName?: string; error?: string }> = [];
  if (includeDormant) {
    try {
      dormant = llm?.listConfigurableProviders?.() ?? [];
    } catch {
      dormant = [];
    }
    for (const entry of dormant) {
      if (typeof entry?.provider !== "string" || entry.provider === "") continue;
      const row = ensure(entry.provider, entry.displayName);
      if (typeof entry.error === "string" && entry.error !== "") row.error = entry.error;
    }
  }
  for (const declared of settings) ensure(declared.id, declared.displayName);
  return [...rows.values()];
}

/** How many providers dsh declares that are neither mounted nor in settings.yaml. */
export function dormantCount(llm: LlmLike | undefined, known: readonly string[]): number {
  let directory: Array<{ provider: string }> = [];
  try {
    directory = llm?.listConfigurableProviders?.() ?? [];
  } catch {
    return 0;
  }
  return directory.filter((entry) => typeof entry?.provider === "string" && !known.includes(entry.provider)).length;
}

/**
 * The models one route may be switched to: the ones settings.yaml declares,
 * because a pi-ai route can only dispatch a model its profile configures.
 * What the server advertises on top of that is reported, not offered, so the
 * llama.cpp user who just loaded a new model is told to run `bruine setup`
 * instead of meeting a failed turn.
 */
export function buildModelRows(
  declared: ReadonlyArray<{ id: string; name?: string; contextWindow?: number }>,
  advertised: ReadonlyArray<{ id: string; name?: string }>,
  current: RouteRef | undefined,
): RouteModels {
  const rows: ModelRow[] = [];
  const seen = new Set<string>();
  for (const model of declared) {
    if (typeof model?.id !== "string" || model.id === "" || seen.has(model.id)) continue;
    seen.add(model.id);
    rows.push({
      id: model.id,
      ...(model.name !== undefined ? { name: model.name } : {}),
      ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
      current: current !== undefined && current.model === model.id,
    });
  }
  const undeclared: string[] = [];
  for (const model of advertised) {
    if (typeof model?.id !== "string" || model.id === "" || seen.has(model.id)) continue;
    undeclared.push(model.id);
  }
  return { rows, undeclared };
}

interface BruineJson {
  recentModels?: string[];
  [key: string]: unknown;
}

function bruineHome(): string {
  return runtimeHome();
}

function readBruineJson(): BruineJson {
  try {
    const path = configReadPath(bruineHome());
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, "utf8")) as BruineJson;
  } catch {
    return {};
  }
}

/**
 * Remember the routes just used in bruine.json (atomic, 0600, other keys kept).
 * BOTH the route left and the route taken are recorded, newest first: a user
 * who switches once must be able to switch back with f2, and the model they
 * came from was never in the list before.
 */
export async function rememberRoutes(...keys: string[]): Promise<void> {
  const wanted = keys.filter((key) => !key.includes("//") && !key.endsWith("/"));
  if (wanted.length === 0) return;
  const doc = readBruineJson();
  const recents = [...wanted, ...(doc.recentModels ?? [])].filter(
    (key, index, all) => all.indexOf(key) === index,
  );
  doc.recentModels = recents.slice(0, 8);
  const path = configWritePath(bruineHome());
  // Unique temp name: two quick switches must not fight over one .tmp.
  const tmp = `${path}.${String(process.pid)}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(tmp, `${JSON.stringify(doc, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    await chmod(tmp, 0o600);
  } catch {
    // best effort (Windows)
  }
  await rename(tmp, path);
}

/**
 * `$DSH_HOME/.env` key NAMES only — a value never leaves this function.
 * bruine's own writer emits a bare `KEY=value`; a hand-edited file may prefix
 * `export `, which dsh's dotenv loader accepts, so both are read.
 */
export function readEnvKeys(dshHome?: string): Set<string> {
  const out = new Set<string>();
  const home = dshHome ?? runtimeHome();
  try {
    const path = join(home, ".env");
    if (!existsSync(path)) return out;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const name = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];
      if (name !== undefined) out.add(name);
    }
  } catch {
    // no .env, or unreadable: every key then reads as unset
  }
  return out;
}

/** The picker and the switch. Every pure decision above is exported for tests. */
export class ModelPicker {
  ready = false;
  /** The dsh ModelSelectionRef holder: dsh reads `.current` per request. */
  private holder: { current?: RouteRef & { reasoningEffort?: string } } | undefined;
  private ui: ModelUi | undefined;
  private llm: LlmLike | undefined;
  private defaultModel: DefaultModelLike | undefined;
  private effort: { adoptRoute?(provider: string, model: string): Promise<void> } | undefined;
  private dshHome: string | undefined;
  /** `.env` key names, read once per command run. */
  #envKeys: Set<string> | undefined;
  /** The pending bruine.json write (awaited by tests and by the reply). */
  persisted: Promise<void> = Promise.resolve();
  noticeShown = "";

  async attach(
    repl: BruineRepl | undefined,
    llm: LlmLike | undefined,
    defaultModel?: DefaultModelLike,
  ): Promise<void> {
    this.holder = repl?.selection as ModelPicker["holder"];
    this.ui = repl?.ui as ModelUi | undefined;
    this.llm = llm;
    this.defaultModel = defaultModel;
    this.dshHome = process.env.DSH_HOME;
    // A route added by an earlier version in a shape that cannot work is mended; settings.yaml is
    // hot-reloaded, so a session that is already running picks it up.
    void repairSpaceBunnyRoute(this.dshHome ?? runtimeHome()).catch(() => false);
    if (this.holder?.current === undefined) return;
    this.ready = true;
    // f2 walks the recently used routes (opencode's `model_cycle_recent`).
    // pi-tui 0.85.1 has no `shift+f2` sequence in any terminal protocol, so no
    // reverse bind is claimed; `cycleRecent(-1)` is the API, not a key.
    this.ui?.tui?.addInputListener?.((data) => {
      if (!this.ready || !matchesKey(data, "f2")) return {};
      void this.cycleRecent(1);
      return { consume: true };
    });
  }

  /** T37: the effort plugin owns the levels of the model in use. */
  setEffort(effort: { adoptRoute?(provider: string, model: string): Promise<void> } | undefined): void {
    this.effort = effort;
  }

  /** `/new` created a new agent: follow its selection. */
  rebind(holder: { current?: RouteRef & { reasoningEffort?: string } } | undefined): void {
    this.holder = holder;
    this.ready = holder?.current !== undefined;
  }

  /** The route in use, as the picker sees it. */
  get current(): RouteRef | undefined {
    const selection = this.holder?.current;
    return selection === undefined ? undefined : { provider: selection.provider, model: selection.model };
  }

  private settings(): SettingsProvider[] {
    return readSettingsProviders(this.dshHome);
  }

  private envKeys(): Set<string> {
    this.#envKeys ??= readEnvKeys(this.dshHome);
    return this.#envKeys;
  }

  private keyIsSet(row: ProviderRow): boolean {
    if (row.apiKeyEnv === undefined) return false;
    const value = process.env[row.apiKeyEnv];
    if (value !== undefined && value !== "") return true;
    return this.envKeys().has(row.apiKeyEnv);
  }

  /** True when a route to the free model is already declared or mounted. */
  hasSpaceBunny(rows: readonly ProviderRow[]): boolean {
    return rows.some((row) => row.id === SPACE_BUNNY.routeName || row.baseUrl === SPACE_BUNNY.baseUrl);
  }

  /**
   * Adds Space Bunny Free to this home after an explicit yes, then switches to it. Nothing is
   * written before the answer: the user is told where their code goes and that the offer can end.
   */
  async addSpaceBunny(): Promise<string> {
    if (this.ui?.askChoice === undefined) {
      return "Space Bunny Free needs a yes or no: run bruine in a terminal, or run bruine setup.";
    }
    const answer = await this.ui.askChoice(
      SPACE_BUNNY_NOTICE.replace(/\n/g, " "),
      [
        { value: "no", label: "No, keep my models" },
        { value: "yes", label: "Yes, add Space Bunny Free and switch to it" },
      ],
      { initial: 0 },
    );
    if (answer !== 1) return "Space Bunny Free: not added.";
    const home = this.dshHome ?? runtimeHome();
    try {
      await addSpaceBunnyToHome(home);
    } catch (err) {
      const text = `Could not add Space Bunny Free: ${(err as Error).message}`;
      this.ui.showNotice?.(text, { red: true });
      return text;
    }
    // settings.yaml is hot-reloaded: give the runtime a moment to mount the route before using it.
    for (let i = 0; i < 40; i += 1) {
      let live: Array<{ id: string }> = [];
      try {
        live = this.llm?.listProviders?.() ?? [];
      } catch {
        live = [];
      }
      if (live.some((p) => p.id === SPACE_BUNNY.routeName)) {
        return this.apply({ provider: SPACE_BUNNY.routeName, model: SPACE_BUNNY.model }, { notice: true, remember: true });
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const text = "Space Bunny Free is added to settings.yaml. Run /reload, then /model space-bunny to switch to it.";
    this.ui.showNotice?.(text);
    return text;
  }

  /** What the picker offers. `all` adds dsh's dormant directory. */
  providerRows(all = false): ProviderRow[] {
    return buildProviderRows(this.llm, this.settings(), all);
  }

  /** What one route advertises right now; a dead server is not an error. */
  private async advertised(provider: string): Promise<Array<{ id: string; name?: string }>> {
    try {
      return (await this.llm?.listModels?.(provider)) ?? [];
    } catch {
      return [];
    }
  }

  /**
   * The models of one route: what settings.yaml declares, plus what the server
   * advertises that is not recorded yet. The adapter's own window fills in for
   * a declared model whose settings entry lacks one.
   */
  async modelRows(provider: string): Promise<RouteModels> {
    const declared = this.settings().find((s) => s.id === provider)?.models ?? [];
    const models = buildModelRows(declared, await this.advertised(provider), this.current);
    for (const row of models.rows) {
      if (row.contextWindow !== undefined) continue;
      const window = await this.windowOf(provider, row.id);
      if (window !== undefined) row.contextWindow = window;
    }
    return models;
  }

  /** The window the adapter resolves, or undefined when it does not know. */
  private async windowOf(provider: string, model: string): Promise<number | undefined> {
    try {
      const window = (await this.llm?.resolveModelInfo?.(provider, model))?.context?.contextWindow;
      return typeof window === "number" && window > 0 ? window : undefined;
    } catch {
      return undefined;
    }
  }

  private async effortsOf(provider: string, model: string): Promise<string[]> {
    try {
      const info = await this.llm?.resolveModelInfo?.(provider, model);
      return (info?.reasoning?.efforts ?? []).map((e: { id: string }) => e.id as string);
    } catch {
      return [];
    }
  }

  /**
   * Switch the live route. Replacing `.current` on the ref is dsh's own seam
   * (bruine-effort does the same for the effort), so the change reaches the next
   * request and leaves the system prompt and the tools alone.
   *
   * A model the route does not declare is refused HERE, not on the next turn:
   * `dsh-llm-pi-ai` resolves a route through the profile's declared models and
   * throws `UNKNOWN_MODEL` otherwise, so a switch to one would break the user's
   * next message instead of this command.
   */
  async apply(next: RouteRef, opts: { notice: boolean; remember: boolean }): Promise<string> {
    const holder = this.holder;
    if (holder === undefined) return "Model: not ready yet.";
    const declared = this.declaredModel(next.provider, next.model);
    if (declared === undefined) {
      const text =
        `Model "${next.model}" is not configured on ${next.provider}. ` +
        "Run bruine setup to record it.";
      if (opts.notice) this.ui?.showNotice?.(text, { red: true });
      return text;
    }
    const before = holder.current;
    const same = before !== undefined && before.provider === next.provider && before.model === next.model;
    // A model with no thinking switch must not inherit the old model's effort:
    // dsh keeps whatever effort the selection still carries onto the wire.
    const selection: RouteRef & { reasoningEffort?: string } = { provider: next.provider, model: next.model };
    const wanted = before?.reasoningEffort;
    if (wanted !== undefined && (same || (await this.effortsOf(next.provider, next.model)).includes(wanted))) {
      selection.reasoningEffort = wanted;
    }
    holder.current = selection;
    this.publish(next, declared);
    // T34/T37: the effort plugin cached the levels of the OLD model.
    try {
      await this.effort?.adoptRoute?.(next.provider, next.model);
    } catch {
      // effort control is a nicety; a stale level must not block the switch
    }
    await this.persistRoute(next);
    if (opts.remember && !same) {
      // The route left behind is recorded too, so f2 can walk back to it.
      this.persisted = rememberRoutes(
        routeKey(next),
        ...(before === undefined ? [] : [routeKey({ provider: before.provider, model: before.model })]),
      ).catch(() => undefined);
    }
    this.noticeShown = `Model: ${displayModel(next.model, declared.name)} (${next.provider}) · next message`;
    if (opts.notice) this.ui?.showNotice?.(this.noticeShown);
    return this.noticeShown;
  }

  /** The settings.yaml entry for one exact route, when the route declares it. */
  private declaredModel(
    provider: string,
    model: string,
  ): { id: string; name?: string; contextWindow?: number } | undefined {
    return this.settings()
      .find((s) => s.id === provider)
      ?.models.find((m) => m.id === model);
  }

  /** `agent-default-model` in settings.yaml, through dsh's own writer. */
  private async persistRoute(next: RouteRef): Promise<void> {
    try {
      await this.defaultModel?.saveSelection?.(next);
    } catch {
      // a route that cannot be persisted still works this session
    }
  }

  private publish(next: RouteRef, declared: { name?: string; contextWindow?: number }): void {
    this.ui?.footer.set({
      model: next.model,
      provider: next.provider,
      modelName: declared.name,
      contextWindow: declared.contextWindow,
      // The old model's context is not this model's context.
      contextUsed: 0,
    });
    this.ui?.resetRouteCache?.();
    this.ui?.requestRender();
  }

  /** f2 / shift+f2: the next/previous recently used route. */
  async cycleRecent(step: number): Promise<string> {
    this.#envKeys = undefined;
    const known = this.providerRows().map((r) => r.id);
    const recents = (readBruineJson().recentModels ?? []).filter((key) => {
      const parsed = parseRouteArg(key, known);
      return parsed !== undefined && parsed.model !== "" && this.declaredModel(parsed.provider, parsed.model) !== undefined;
    });
    if (recents.length < 2) {
      const text = "No other recent model yet: switch with /model first.";
      this.ui?.showNotice?.(text);
      return text;
    }
    const currentKey = this.current === undefined ? undefined : routeKey(this.current);
    const at = currentKey === undefined ? -1 : recents.indexOf(currentKey);
    const from = at < 0 ? (step > 0 ? -1 : 0) : at;
    const next = recents[(from + step + recents.length) % recents.length] as string;
    const parsed = parseRouteArg(next, known);
    if (parsed === undefined || parsed.model === "") return "Model: unchanged.";
    return this.apply(parsed, { notice: true, remember: false });
  }

  /** `/model <provider>/<model>`: set a route without opening a picker. */
  private async setDirect(arg: string): Promise<string> {
    this.#envKeys = undefined;
    const known = this.providerRows().map((r) => r.id);
    // "/model space-bunny" is the free model by its name; it is added first if need be.
    if (/^(space-bunny(-free)?|opencode-zen)$/i.test(arg.trim()) && !this.hasSpaceBunny(this.providerRows())) return this.addSpaceBunny();
    if (/^space-bunny(-free)?$/i.test(arg.trim())) return this.apply({ provider: SPACE_BUNNY.routeName, model: SPACE_BUNNY.model }, { notice: true, remember: true });
    const parsed = parseRouteArg(arg, known);
    if (parsed === undefined) return `Unknown route "${arg}". Use "/model" to pick one.`;
    if (known.length > 0 && !known.includes(parsed.provider)) {
      return `Unknown provider "${parsed.provider}". Configured: ${known.join(", ")}. Run bruine setup to add one.`;
    }
    if (parsed.model === "") return `Pick a model on ${parsed.provider}: use "/model".`;
    return this.apply(parsed, { notice: true, remember: true });
  }

  /** "/model" opens provider → model; "/model <route>" sets directly. */
  async runCommand(line: string): Promise<string | undefined> {
    if (!this.ready) return "Model: not ready yet.";
    this.#envKeys = undefined;
    const rest = line.replace(/^\/model\s*/, "").trim();
    if (rest !== "") return this.setDirect(rest);
    const rows = this.providerRows();
    if (rows.length === 0) return "No provider is configured. Run bruine setup.";
    const current = this.current;
    if (this.ui?.askChoice === undefined) {
      // Non-TTY: the same facts, one line per provider.
      return [
        "Providers:",
        ...rows.map((row) => `  ${providerLine(row, current, this.keyIsSet(row))}`),
        'Use "/model <provider>/<model>" to switch.',
        ...(this.hasSpaceBunny(rows) ? [] : ['Not added yet: "/model space-bunny" adds Space Bunny Free (free for now, via OpenCode Zen).']),
      ].join("\n");
    }
    const items = rows.map((row) => ({ value: row.id, label: providerLine(row, current, this.keyIsSet(row)) }));
    // The free model is one pick away for anyone who has not added it: setup only asks about it
    // once, and a home that chose its own models then never saw it again.
    const offerFree = !this.hasSpaceBunny(rows);
    if (offerFree) items.push({ value: "+space-bunny", label: "+ Space Bunny Free (OpenCode Zen, free for now, no key)" });
    const at = current === undefined ? -1 : rows.findIndex((row) => row.id === current.provider);
    const picked = await this.ui.askChoice("Model · provider", items, at >= 0 ? { initial: at } : {});
    if (offerFree && picked === rows.length) return this.addSpaceBunny();
    const provider = rows[picked];
    if (provider === undefined) return "Model: unchanged.";
    if (!provider.live) {
      const text = `${provider.label} is not configured yet. Run bruine setup to add it.`;
      this.ui.showNotice?.(text);
      return text;
    }
    const models = await this.modelRows(provider.id);
    if (models.rows.length === 0) {
      const text = `${provider.label} has no model configured. Run bruine setup.`;
      this.ui.showNotice?.(text, { red: true });
      return text;
    }
    // T37: what the server serves but settings.yaml never recorded. It cannot
    // be dispatched (the pi-ai route resolves through the profile's models), so
    // it is named here and the fix is one command, not a failed turn later.
    if (models.undeclared.length > 0) {
      this.ui.showNotice?.(
        `${provider.label} also serves ${models.undeclared.length} model(s) bruine has not recorded ` +
          `(${models.undeclared.slice(0, 3).join(", ")}${models.undeclared.length > 3 ? ", ..." : ""}): run bruine setup to add them.`,
      );
    }
    const modelAt = models.rows.findIndex((row) => row.current);
    const modelPick = await this.ui.askChoice(
      `Model · ${provider.label}`,
      models.rows.map((row) => ({ value: row.id, label: modelRowLabel(row) })),
      modelAt >= 0 ? { initial: modelAt } : {},
    );
    const model = models.rows[modelPick];
    if (model === undefined) return "Model: unchanged.";
    if (model.current) return `Model: ${modelRowLabel(model)}, unchanged.`;
    return this.apply({ provider: provider.id, model: model.id }, { notice: true, remember: true });
  }

  handles(line: string): boolean {
    return line === "/model" || line.startsWith("/model ");
  }

  /**
   * T39: every provider. Plain `/provider` is the usable overview — the routes
   * that are mounted, in full — plus a count of what dsh could add, because
   * pi-ai's directory is ~60 rows and nobody reads that as an answer. `/provider
   * all` prints every one of them.
   */
  runProviderCommand(line = ""): string {
    this.#envKeys = undefined;
    const all = /\ball\b/i.test(line);
    const current = this.current;
    const rows = this.providerRows(all);
    if (rows.length === 0) return "No provider is configured. Run bruine setup.";
    const lines = [`Providers (${String(rows.length)}):`];
    for (const row of rows) lines.push(`  ${providerLine(row, current, this.keyIsSet(row))}`);
    if (!all) {
      const more = dormantCount(this.llm, rows.map((row) => row.id));
      if (more > 0) {
        lines.push(
          `  + ${String(more)} more bruine can add (deepseek, openrouter, openai, anthropic, google, xai, ...)`,
          "  /provider all lists them · bruine setup adds one",
        );
      }
    }
    lines.push(
      current === undefined
        ? "No route in use: /model picks one."
        : `In use: ${routeKey(current)} · /model switches · bruine setup adds a provider.`,
    );
    return lines.join("\n");
  }
}

export function apply(ctx: DshContext): void {
  const picker = new ModelPicker();

  ctx.inject(["bruineRepl"], (c: any) => {
    void picker
      .attach(c.bruineRepl as BruineRepl, ctx.get("llm") as LlmLike, ctx.get("agentDefaultModel") as DefaultModelLike)
      .then(() => {
        // T37: the effort plugin owns the levels of the model in use, so a route
        // switch must hand it the new one. Resolved here, after both plugins
        // have mounted, so their load order does not matter.
        const effort = ctx.get(BRUINE_EFFORT_SERVICE) as
          | { adoptRoute?(provider: string, model: string): Promise<void> }
          | undefined;
        picker.setEffort(effort === null ? undefined : effort);
      });
  });

  // Register in dsh's own commands service, so the T31 "/" palette lists both
  // with a description (the seam bruine-effort uses for /effort).
  let registered = false;
  const register = (): void => {
    if (registered) return;
    const commands = ctx.get("commands") as
      | {
          register(definition: {
            name: string;
            description: string;
            handler(invocation: { rawInput: string }): { kind: "success"; text: string } | Promise<{ kind: "success"; text: string }>;
          }): () => void;
        }
      | undefined;
    if (commands?.register === undefined) return;
    registered = true;
    commands.register({
      name: "model",
      description: "Switch the model for the next messages",
      handler: async (invocation) => ({ kind: "success", text: (await picker.runCommand(invocation.rawInput)) ?? "" }),
    });
    commands.register({
      name: "provider",
      description: "List every provider, its endpoint, key and models",
      handler: (invocation) => ({ kind: "success", text: picker.runProviderCommand(invocation.rawInput) }),
    });
  };
  try {
    register();
  } catch {
    // commands service loads later: the inject below retries once.
  }
  ctx.inject(["commands"], register);

  ctx.provide(BRUINE_MODEL_SERVICE, picker);
}

/** The Cordis plugin object (mounted programmatically by bruine-repl). */
export default { name, apply };
