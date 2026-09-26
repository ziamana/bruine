/**
 * T34 — the reasoning effort that really reaches the wire.
 *
 * dsh's mutable ModelSelection carries `reasoningEffort`; the pi-ai adapter
 * maps it onto the thinking switches setup detected in the server's chat
 * template (the compat block written by T34). Changing the effort therefore
 * changes ONLY request parameters — the system prompt and tools stay
 * byte-identical and the change applies to the next message (cache rule,
 * ARCHITECTURE §0).
 *
 * The command lives in dsh's `commands` service (name "effort"), so the
 * T31 "/" palette lists it automatically; kumo's own slash router delegates
 * through the kumoEffort service. ctrl+e cycles the levels (TTY).
 */
import { existsSync, readFileSync } from "node:fs";
import { chmod, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { matchesKey } from "@earendil-works/pi-tui";
import type { DshContext, KumoRepl } from "./ctx.js";

/** Stable Cordis plugin name. */
export const name = "kumo-effort";

/** Service published for the REPL (slash router) and other plugins. */
export const KUMO_EFFORT_SERVICE = "kumoEffort";

/** "auto" hands the choice back to the provider (no effort on the wire). */
export type EffortArg = "auto" | string;

export interface EffortSelection {
  provider: string;
  model: string;
  reasoningEffort?: string;
}

export interface EffortUi {
  askChoice?(title: string, items: Array<{ value: string; label: string }>): Promise<number>;
  showNotice?(text: string, opts?: { red?: boolean }): void;
  footer: { set(next: Record<string, unknown>): void };
  requestRender(): void;
  tui?: { addInputListener(fn: (data: string) => { consume?: boolean } | void): () => void };
}

/** Effort ids with a binary display name: a template that only toggles. */
export function isBinaryLevels(levels: readonly string[]): boolean {
  const on = levels.filter((l) => l !== "off");
  return on.length === 1 && levels.includes("off");
}

/** What the footer and the notice show for one level (never a wire value). */
export function effortLabel(levels: readonly string[], level: string | undefined): string {
  if (level === "off") return "off";
  // Unset (or a model kumo has no switch for): the provider decides → "auto".
  if (level === undefined || levels.length === 0) return "auto";
  return isBinaryLevels(levels) ? "on" : level;
}

/**
 * T34 default effort — `on` for a binary local template, `medium` when the
 * template has real effort words — applied ONLY to local routes where setup
 * actually detected a chat template (`kumo.json models.<role>.template`).
 * Ollama, LM Studio and cloud routes are left exactly as the provider
 * decided (undefined): without a template kumo has no honest switch.
 */
export function defaultLevelFor(
  provider: string,
  levels: readonly string[],
  hasTemplate: boolean,
): string | undefined {
  if (!hasTemplate || !provider.startsWith("local")) return undefined;
  const on = levels.filter((l) => l !== "off");
  if (on.length === 0) return undefined;
  if (isBinaryLevels(levels)) return on[0];
  return levels.includes("medium") ? "medium" : on[0];
}

/** Does kumo.json hold a setup-detected template for this exact route? */
export function hasTemplateForRoute(
  doc: {
    models?: Record<string, { provider?: string; model?: string; template?: unknown } | undefined>;
  },
  provider: string,
  model: string,
): boolean {
  for (const ref of Object.values(doc.models ?? {})) {
    if (ref?.provider === provider && ref.model === model && ref.template !== undefined) return true;
  }
  return false;
}

/** kumo.json `reasoningEffort` lookup: exact model id, then trailing-glob. */
export function savedLevelFor(
  map: Record<string, string> | undefined,
  model: string,
): string | undefined {
  if (map === undefined) return undefined;
  const exact = map[model];
  if (exact !== undefined) return exact;
  for (const [pattern, level] of Object.entries(map)) {
    if (pattern.endsWith("*") && model.startsWith(pattern.slice(0, -1))) return level;
  }
  return undefined;
}

/** Normalize a user word to a level id: "on" → the binary level. */
export function normalizeLevelArg(
  levels: readonly string[],
  arg: string,
): EffortArg | undefined {
  const a = arg.trim().toLowerCase();
  if (a === "auto") return "auto";
  if (!levels.includes(a) && a === "on" && isBinaryLevels(levels)) {
    return levels.find((l) => l !== "off");
  }
  return levels.includes(a) ? a : undefined;
}

interface KumoJson {
  reasoningEffort?: Record<string, string>;
  models?: Record<string, { provider?: string; model?: string } | undefined>;
  [key: string]: unknown;
}

function kumoHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), ".kumo");
}

function readKumoJson(): KumoJson {
  try {
    const path = join(kumoHome(), "kumo.json");
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, "utf8")) as KumoJson;
  } catch {
    return {};
  }
}

/** Remember one model's effort in kumo.json (atomic, other keys kept). */
export async function persistLevel(model: string, level: string | "auto"): Promise<void> {
  const doc = readKumoJson();
  const map = { ...(doc.reasoningEffort ?? {}) };
  if (level === "auto") delete map[model];
  else map[model] = level;
  doc.reasoningEffort = map;
  const path = join(kumoHome(), "kumo.json");
  // Unique temp name: rapid ctrl+e presses must not fight over one .tmp.
  const tmp = `${path}.${String(process.pid)}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(tmp, `${JSON.stringify(doc, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    await chmod(tmp, 0o600);
  } catch {
    // best effort (Windows)
  }
  await rename(tmp, path);
}

/** The pure decision surface of the plugin — unit-testable without dsh. */
export class Effort {
  levels: string[] = [];
  current: string | undefined;
  ready = false;
  /** The dsh ModelSelectionRef holder: dsh reads .current per request. */
  private holder: { current?: EffortSelection } | undefined;
  private ui: EffortUi | undefined;

  /** Wire it to the live session; applies the saved/default level once. */
  async attach(
    repl: KumoRepl | undefined,
    llm: { resolveModelInfo?(p: string, m: string): Promise<any> } | undefined,
  ): Promise<void> {
    const doc = readKumoJson();
    const selection = repl?.selection?.current;
    if (selection === undefined || llm?.resolveModelInfo === undefined) return;
    this.holder = repl?.selection;
    this.current = selection.reasoningEffort;
    this.ui = repl?.ui;
    let levels: string[] = [];
    try {
      const info = await llm.resolveModelInfo(selection.provider, selection.model);
      levels = (info?.reasoning?.efforts ?? []).map((e: { id: string }) => e.id);
    } catch {
      levels = [];
    }
    this.levels = levels;
    this.ready = true;
    const saved = savedLevelFor(doc.reasoningEffort, selection.model);
    const wanted = saved !== undefined && levels.includes(saved)
      ? saved
      : defaultLevelFor(selection.provider, levels, hasTemplateForRoute(doc, selection.provider, selection.model));
    if (wanted !== undefined) this.apply(wanted, { notice: false, remember: false });
    else this.refreshFooter();
    // ctrl+e cycles the levels (before the editor sees the key).
    this.ui?.tui?.addInputListener?.((data) => {
      if (!this.ready || !matchesKey(data, "ctrl+e")) return {};
      void this.cycle();
      return { consume: true };
    });
  }

  noticeShown = "";
  /** The pending kumo.json write (awaited by tests and /effort replies). */
  persisted: Promise<void> = Promise.resolve();

  /** The visible order: off first, then the model's thinking levels. */
  ordered(): string[] {
    return this.levels.includes("off") ? this.levels : ["off", ...this.levels];
  }

  label(level: string | undefined): string {
    return effortLabel(this.levels, level);
  }

  /** Apply one level to the live selection; level "auto" = provider default. */
  /** /new created a new agent: follow its selection and keep the level in use. */
  rebind(holder: { current?: EffortSelection } | undefined): void {
    this.holder = holder;
    this.apply(this.current ?? "auto", { notice: false, remember: false });
  }

  apply(level: string, opts: { notice: boolean; remember: boolean }): void {
    const current = this.holder?.current;
    if (current === undefined) return;
    this.current = level === "auto" ? undefined : level;
    const next: EffortSelection = { provider: current.provider, model: current.model };
    if (this.current !== undefined) next.reasoningEffort = this.current;
    // dsh reads this object per request; replacing it on the ref is how the
    // effort reaches the next wire call without touching prompt or tools.
    if (this.holder !== undefined) this.holder.current = next;
    this.publish();
    const text = `Effort: ${this.label(this.current)} (next message)`;
    this.noticeShown = text;
    if (opts.notice) this.ui?.showNotice?.(text);
    if (opts.remember) {
      this.persisted = persistLevel(current.model, this.current ?? "auto").catch(() => undefined);
    }
  }

  cycle(): void {
    const order = this.ordered();
    if (order.length <= 1) {
      this.ui?.showNotice?.("This model has no switchable effort.");
      return;
    }
    const i = order.indexOf(this.current ?? "off");
    const next = order[(i + 1) % order.length] as string;
    this.apply(next, { notice: true, remember: true });
  }

  /** "/effort" opens the picker; "/effort high" sets directly. */
  async runCommand(line: string): Promise<string | undefined> {
    const rest = line.replace(/^\/effort\s*/, "").trim();
    if (!this.ready) return "Effort: not ready yet.";
    const order = this.ordered();
    if (order.length === 0) {
      return "This model has no thinking levels to switch (a cloud default or a non-reasoning model).";
    }
    if (rest === "") {
      if (this.ui?.askChoice !== undefined) {
        const items = order.map((l) => ({
          value: l,
          label: l === this.current ? `${this.label(l)} (current)` : this.label(l),
        }));
        const pick = await this.ui.askChoice("Reasoning effort", items);
        if (pick < 0 || pick >= order.length) return "Effort: unchanged.";
        const level = order[pick] as string;
        this.apply(level, { notice: true, remember: true });
        return this.noticeShown;
      }
      return `Effort: ${this.label(this.current)}. Levels: ${order.map((l) => this.label(l)).join(", ")}. Use "/effort <level>".`;
    }
    const normalized = normalizeLevelArg(order, rest);
    if (normalized === undefined) {
      return `Unknown effort "${rest}". Levels: ${order.map((l) => this.label(l)).join(", ")}.`;
    }
    this.apply(normalized, { notice: true, remember: true });
    return this.noticeShown;
  }

  handles(line: string): boolean {
    return line === "/effort" || line.startsWith("/effort ");
  }

  private refreshFooter(): void {
    this.ui?.footer.set({ effort: this.label(this.current) });
    this.ui?.requestRender();
  }
  private publish(): void {
    this.refreshFooter();
  }
}

export function apply(ctx: DshContext): void {
  const effort = new Effort();

  // Discover the live session once the REPL published its agent.
  ctx.inject(["kumoRepl"], (c: any) => {
    void effort.attach(c.kumoRepl as KumoRepl, ctx.get("llm"));
  });

  // Register in dsh's own commands service (T31 palette lists it from here).
  let registered = false;
  const register = (): void => {
    if (registered) return;
    const commands = ctx.get("commands") as
      | {
          register(definition: {
            name: string;
            description: string;
            handler(invocation: { rawInput: string }): { kind: "success"; text?: string } | Promise<{ kind: "success"; text?: string }>;
          }): () => void;
        }
      | undefined;
    if (commands?.register === undefined) return;
    registered = true;
    commands.register({
      name: "effort",
      description: "Set the reasoning effort for this model",
      handler: (invocation) => ({ kind: "success", text: "use /effort <level>: " + effort.ordered().map((l) => effort.label(l)).join(", ") }),
    });
  };
  try {
    register();
  } catch {
    // commands service loads later: the inject below retries once.
  }
  ctx.inject(["commands"], register);

  ctx.provide(KUMO_EFFORT_SERVICE, effort);
}

/** The Cordis plugin object (mounted programmatically by kumo-repl). */
export default { name, apply };
