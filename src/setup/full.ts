/**
 * The kumo setup wizard (T21): pi-tui SelectList/checkbox steps; Esc goes
 * back one step keeping every answer, ctrl+c quits; files are written ONCE,
 * from the summary screen's Save, and never after a cancel.
 */
import {
  Container,
  ProcessTerminal,
  SelectList,
  Text,
  TuiMainScreen,
  matchesKey,
  type Component,
  type SelectItem,
  type Terminal,
  type TUI,
} from "@earendil-works/pi-tui";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ansi, selectListTheme } from "../ui/theme.js";
import {
  SetupFlow,
  defaultAnswers,
  requiredKeyEnvs,
  roleFromModelRef,
  type PermissionModeValue,
  type RolePick,
  type SetupAnswers,
  type Theme,
} from "./flow.js";
import {
  LOCAL_PORTS,
  cidr24Of,
  discoveredLabel,
  privateInterfaceIPv4,
  probeServer,
  scanLocalhosts,
  scanNetwork,
  scanTailscale,
  tailscalePeerIPs,
  type Discovered,
  type ScanOptions,
} from "./discover.js";
import { readBundledSkills, scanFoundSkills, scanProjectSkills, type FoundSkill, type SkillMeta } from "./skills.js";
import {
  detectSearxng,
  normalizeServerUrl,
  simpleSetup,
  type SearchChoice,
  type SetupIO,
} from "./simple.js";
import { readKumoJsonDoc, readUpdateCheckChoice, setUpdateCheck } from "../update.js";

const BACK = Symbol("back");
const CANCEL = Symbol("cancel");
type Outcome<T> = T | typeof BACK | typeof CANCEL;
type StepResult = Outcome<Partial<SetupAnswers>> | "saved";

export interface WizardOptions {
  fetchImpl?: ScanOptions["fetchImpl"];
  terminal?: Terminal;
  /** Pre-filled answers (from `kumo setup` over an existing install). */
  prefill?: SetupAnswers;
  /** Override where the shipped skills live (tests). */
  bundledSkillsRoot?: string;
}

/** ── widgets ─────────────────────────────────────────────────────── */

/** One-line text input; secret mode masks every typed char with `*`. */
class LineInput implements Component {
  onSubmit?: (value: string) => void;
  #value = "";
  #done = false;
  constructor(
    private readonly prompt: string,
    private readonly secret: boolean,
  ) {}
  render(width: number): string[] {
    const shown = this.secret ? "*".repeat([...this.#value].length) : this.#value;
    const line = `${ansi.yellow(this.prompt)}${shown}`;
    return [line.length > width ? line.slice(0, width - 1) + "…" : line];
  }
  invalidate(): void {}
  handleInput(data: string): void {
    if (this.#done) return;
    if (data === "\x7f" || data === "\b") {
      const chars = [...this.#value];
      chars.pop();
      this.#value = chars.join("");
      return;
    }
    if (data === "\r" || data === "\n") {
      this.#done = true;
      this.onSubmit?.(this.#value);
      return;
    }
    if (data.startsWith("\x1b")) return;
    for (const ch of data) {
      const code = ch.codePointAt(0) ?? 0;
      if (code >= 32 && code !== 127) this.#value += ch;
    }
  }
}

/** A CheckList row: `disabled` rows are group headers — no box, not toggleable. */
export interface CheckItem {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

/** Space toggles checkboxes, Enter confirms. */
class CheckList implements Component {
  onDone?: (indices: number[]) => void;
  #cursor = 0;
  #top = 0;
  constructor(
    private readonly items: CheckItem[],
    readonly checked: Set<number>,
    private readonly maxVisible = 10,
  ) {
    this.#cursor = this.#nearest(0, 1) ?? 0;
  }
  /** Nearest selectable row at or after `from` stepping `dir`; undefined if none. */
  #nearest(from: number, dir: number): number | undefined {
    for (let i = from; i >= 0 && i < this.items.length; i += dir) {
      if (this.items[i]?.disabled !== true) return i;
    }
    return undefined;
  }
  render(width: number): string[] {
    if (this.#cursor >= this.items.length) this.#cursor = Math.max(0, this.items.length - 1);
    if (this.#cursor < this.#top) this.#top = this.#cursor;
    if (this.#cursor >= this.#top + this.maxVisible) this.#top = this.#cursor - this.maxVisible + 1;
    const lines: string[] = [];
    for (let i = this.#top; i < Math.min(this.items.length, this.#top + this.maxVisible); i++) {
      const item = this.items[i]!;
      // T26 item format: `name  ·  description`, cut to width.
      const text =
        item.description !== undefined && item.description !== ""
          ? `${item.label}  ·  ${item.description}`
          : item.label;
      if (item.disabled === true) {
        lines.push(ansi.bold(`  ${text}`.slice(0, Math.max(1, width))));
        continue;
      }
      const mark = this.checked.has(i) ? "[x] " : "[ ] ";
      const prefix = i === this.#cursor ? ansi.cyan("❯ ") : "  ";
      lines.push(`${prefix}${mark}${text}`.slice(0, Math.max(1, width)));
    }
    return lines;
  }
  invalidate(): void {}
  handleInput(data: string): void {
    if (matchesKey(data, "up")) {
      this.#cursor = this.#nearest(this.#cursor - 1, -1) ?? this.#cursor;
      return;
    }
    if (matchesKey(data, "down")) {
      this.#cursor = this.#nearest(this.#cursor + 1, 1) ?? this.#cursor;
      return;
    }
    if (data === " ") {
      if (this.items[this.#cursor]?.disabled === true) return;
      if (this.checked.has(this.#cursor)) this.checked.delete(this.#cursor);
      else this.checked.add(this.#cursor);
      return;
    }
    if (data === "\r" || data === "\n") {
      this.onDone?.([...this.checked].sort((a, b) => a - b));
    }
  }
}

/** ── bundled skills location (works from src, dist/plugins-inlined bin, or install) ── */

export function bundledSkillsRoot(): string {
  const dir = dirname(fileURLToPath(import.meta.url));
  for (const up of [1, 2, 3]) {
    const candidate = resolve(dir, "..".repeat(up), "skills");
    if (existsSync(join(candidate, "git-workflow", "SKILL.md"))) return candidate;
  }
  return resolve(dir, "..", "skills");
}

/** ── prefill from an existing kumo.json ───────────────────────────── */

interface KumoJsonShape {
  mode?: string;
  models?: Record<string, { provider?: string; model?: string; baseUrl?: string; contextWindow?: number } | undefined>;
  permissionMode?: string;
  access?: string;
  search?: SearchChoice;
  skills?: string[];
  theme?: string;
  telemetry?: boolean;
}

function readEnvFile(dshHome: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const line of readFileSync(join(dshHome, ".env"), "utf8").split(/\r?\n/)) {
      const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
      if (m !== null && m[1] !== undefined && m[2] !== undefined) out[m[1]] = m[2];
    }
  } catch {
    // no .env
  }
  return out;
}

export function loadPrefill(dshHome: string): SetupAnswers | undefined {
  let doc: KumoJsonShape;
  try {
    doc = JSON.parse(readFileSync(join(dshHome, "kumo.json"), "utf8")) as KumoJsonShape;
  } catch {
    return undefined;
  }
  const answers = defaultAnswers();
  const discoveries: Discovered[] = [];
  const roles: SetupAnswers["roles"] = {};
  for (const role of ["main", "fast", "vision"] as const) {
    const ref = doc.models?.[role];
    if (ref?.provider === undefined || ref.model === undefined) continue;
    const pick = roleFromModelRef({
      provider: ref.provider,
      model: ref.model,
      ...(ref.baseUrl !== undefined ? { baseUrl: ref.baseUrl } : {}),
      ...(ref.contextWindow !== undefined ? { contextWindow: ref.contextWindow } : {}),
    });
    if (pick === undefined) continue;
    roles[role] = pick;
    if (pick.discovered === undefined) continue;
    const existing = discoveries.find((d) => d.baseUrl === pick.discovered?.baseUrl);
    if (existing !== undefined) {
      if (!existing.models.includes(pick.model)) {
        existing.models.push(pick.model);
        existing.modelInfos.push({
          id: pick.model,
          ...(pick.contextWindow !== undefined ? { contextWindow: pick.contextWindow } : {}),
        });
      }
    } else {
      discoveries.push({
        ...pick.discovered,
        models: [pick.model],
        modelInfos: [
          {
            id: pick.model,
            ...(pick.contextWindow !== undefined ? { contextWindow: pick.contextWindow } : {}),
          },
        ],
      });
    }
  }
  answers.discoveries = discoveries;
  answers.roles = roles;
  answers.keys = readEnvFile(dshHome);
  if (doc.permissionMode === "ask" || doc.permissionMode === "auto" || doc.permissionMode === "full") {
    answers.permissionMode = doc.permissionMode;
  } else if (doc.access === "ask" || doc.access === "auto" || doc.access === "full") {
    answers.permissionMode = doc.access;
  }
  if (doc.search !== undefined && typeof doc.search.provider === "string") {
    answers.search = doc.search;
  }
  if (Array.isArray(doc.skills)) answers.skills = doc.skills;
  if (doc.theme === "dark" || doc.theme === "light" || doc.theme === "high-contrast") {
    answers.theme = doc.theme;
  }
  if (typeof doc.telemetry === "boolean") answers.telemetry = doc.telemetry;
  return answers;
}

/** ── T26 skills-step helpers (pure, unit-testable) ────────────────── */

/** Skills persisted in kumo.json; `undefined` = never saved (pre-T26 install). */
export function savedSkillsList(dshHome: string): string[] | undefined {
  try {
    const doc = JSON.parse(
      readFileSync(join(dshHome, "kumo.json"), "utf8"),
    ) as { skills?: unknown };
    return Array.isArray(doc.skills) ? doc.skills.map((s) => String(s)) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Rows pre-checked when entering the skills step: the saved list when kumo
 * knows one; otherwise the T26 migration default — every skill found in
 * `.agents/skills` in the user home, the behavior dsh had before kumo took over USER skills.
 * Same name shipped AND found: the shipped row wins (one entry per name).
 */
export function initialSkillChecks(
  items: CheckItem[],
  saved: string[] | undefined,
  found: FoundSkill[],
): Set<number> {
  const checked = new Set<number>();
  items.forEach((item, i) => {
    if (item.disabled === true) return;
    if (saved !== undefined) {
      if (saved.includes(item.value)) checked.add(i);
    } else if (found.some((f) => f.name === item.value && f.source === "agents")) {
      checked.add(i);
    }
  });
  return checked;
}

/** ── the wizard ──────────────────────────────────────────────────── */

export async function runFullSetup(
  dshHome: string,
  opts: WizardOptions = {},
): Promise<"saved" | "simple" | "quit"> {
  const terminal = opts.terminal ?? new ProcessTerminal();
  const tui: TUI = new TuiMainScreen(terminal);
  const root = new Container();
  const flow = new SetupFlow(opts.prefill ?? defaultAnswers());
  let status = "kumo setup";
  const statusWidget: Component = {
    render: (width: number) => [ansi.gray(status.slice(0, Math.max(0, width - 2)))],
    invalidate: () => {},
  };
  tui.addChild(root);
  tui.addChild(statusWidget);

  let activeResolve: ((o: Outcome<never>) => void) | null = null;
  // T26 skills step: before the first submit the pre-checked rows come from
  // kumo.json (or, for a pre-T26 first run, from the user-home `.agents` migration
  // default); after it, from the answers kept across Esc/back.
  let skillsSubmitted = false;
  // T30: the update-check toggle rides on the Telemetry step and is merged
  // into kumo.json from the Summary's Save (flow.ts owns the other fields).
  let updateCheckChoice = true;
  let updateCheckLoaded = false;
  tui.addInputListener((data: string) => {
    if (matchesKey(data, "ctrl+c")) {
      activeResolve?.(CANCEL);
      return { consume: true };
    }
    if (matchesKey(data, "escape")) {
      activeResolve?.(BACK);
      return { consume: true };
    }
    return {};
  });

  interface Built {
    widget: Component;
    focus: Component;
    above?: Component[];
    below?: Component[];
  }

  const interactive = <T>(
    title: string,
    build: (finish: (v: T) => void) => Built,
  ): Promise<Outcome<T>> =>
    new Promise((resolveP) => {
      root.clear();
      const box = new Container();
      if (title !== "") box.addChild(new Text(ansi.bold(title), 1, 0));
      const built = build((v) => {
        activeResolve = null;
        resolveP(v);
      });
      for (const c of built.above ?? []) box.addChild(c);
      box.addChild(built.widget);
      for (const c of built.below ?? []) box.addChild(c);
      root.addChild(box);
      tui.setFocus(built.focus);
      tui.requestRender();
      activeResolve = (o) => {
        activeResolve = null;
        resolveP(o);
      };
    });

  const selectStep = <T>(
    title: string,
    items: SelectItem[],
    map: (index: number) => T,
    opts: {
      livePreview?: (index: number) => Component;
      initial?: number;
      above?: Component;
    } = {},
  ): Promise<Outcome<T>> =>
    interactive<T>(title, (finish) => {
      const list = new SelectList(items, Math.min(items.length, 10), selectListTheme);
      // Honor a previous answer when re-entering the step (Esc/back).
      if (opts.initial !== undefined) list.setSelectedIndex(opts.initial);
      const previewHolder: { current: Component | null } = {
        current: opts.livePreview !== undefined ? opts.livePreview(opts.initial ?? 0) : null,
      };
      const previewWidget: Component = {
        render: (width: number) => previewHolder.current?.render(width) ?? [],
        invalidate: () => previewHolder.current?.invalidate(),
      };
      list.onSelect = (item) => finish(map(Math.max(0, items.indexOf(item))));
      list.onSelectionChange = (item) => {
        if (opts.livePreview !== undefined) {
          previewHolder.current = opts.livePreview(Math.max(0, items.indexOf(item)));
        }
      };
      return {
        widget: list,
        focus: list,
        above: opts.above !== undefined ? [opts.above] : undefined,
        below: opts.livePreview !== undefined ? [previewWidget] : undefined,
      };
    });

  const lineStep = (prompt: string, secret = false): Promise<Outcome<string>> =>
    interactive<string>("", (finish) => {
      const input = new LineInput(prompt, secret);
      input.onSubmit = (v) => finish(v);
      return { widget: input, focus: input };
    });

  const checkStep = (
    title: string,
    items: CheckItem[],
    checked: Set<number>,
  ): Promise<Outcome<number[]>> =>
    interactive<number[]>(title, (finish) => {
      const cl = new CheckList(items, checked);
      cl.onDone = (idx) => finish(idx);
      return { widget: cl, focus: cl };
    });

  tui.start();
  try {
    return await drive();
  } finally {
    try {
      await terminal.drainInput(200, 30);
    } catch {
      // best effort
    }
    tui.stop();
  }

  async function drive(): Promise<"saved" | "simple" | "quit"> {
    const bundledRoot = opts.bundledSkillsRoot ?? bundledSkillsRoot();
    const bundled: SkillMeta[] = await readBundledSkills(bundledRoot);

    const entry = await selectStep<"full" | "simple">(
      "Welcome to kumo. How should we set it up?",
      [
        { value: "simple", label: "Simple setup (recommended)" },
        { value: "full", label: "Full setup" },
      ],
      (i) => (i === 0 ? "simple" : "full"),
    );
    if (entry === BACK || entry === CANCEL) return "quit";
    if (entry === "simple") {
      tui.stop();
      await simpleSetup(dshHome, setupIO());
      return "simple";
    }

    while (!flow.canceled) {
      const step = flow.step;
      let result: StepResult;
      try {
        result = await (async (): Promise<StepResult> => {
          switch (step) {
            case "models": return await stepModels();
            case "roles": return await stepRoles();
            case "keys": return await stepKeys();
            case "mode": return await stepMode();
            case "search": return await stepSearch();
            case "skills": return await stepSkills(bundled);
            case "theme": return await stepTheme();
            case "telemetry": return await stepTelemetry();
            case "summary": return await stepSummary(bundledRoot, bundled);
          }
        })();
      } catch (err) {
        setStatus(`! ${(err as Error).message}. Try again`);
        await sleep(1400);
        setStatus(stepTitle(step));
        continue; // same step again, answers kept
      }
      if (result === "saved") return "saved";
      if (result === CANCEL) {
        flow.cancel();
        return "quit";
      }
      if (result === BACK) {
        if (!flow.back()) {
          flow.cancel();
          return "quit";
        }
        status = stepTitle(flow.step);
        continue;
      }
      flow.submit(result as Partial<SetupAnswers>);
      status = stepTitle(flow.step);
    }
    return "quit";
  }

  function setStatus(s: string): void {
    status = s;
    tui.requestRender();
  }

  /** ── steps ─────────────────────────────────────────────────────── */

  async function stepModels(): Promise<StepResult> {
    const discoveries: Discovered[] = [...flow.answers.discoveries];
    setStatus("scanning localhost…");
    const found = await scanLocalhosts({ fetchImpl: opts.fetchImpl, ports: LOCAL_PORTS });
    mergeInto(discoveries, found);
    setStatus(stepTitle("models"));
    for (;;) {
      const items: SelectItem[] = [
        ...discoveries.map((d) => ({ value: `s:${d.host}:${String(d.port)}`, label: discoveredLabel(d) })),
        { value: "addr", label: "+ Enter a server address…" },
        { value: "net", label: "+ Scan your local network" },
        ...(tailscalePeerIPs().length > 0 ? [{ value: "ts", label: "+ Scan your Tailscale peers" }] : []),
        { value: "done", label: discoveries.length > 0 ? "Continue →" : "Continue → (cloud models only)" },
      ];
      const sel = await selectStep(
        "AI servers: found, add, or remove; Enter to pick an action",
        items,
        (i) => i,
      );
      if (sel === BACK || sel === CANCEL) return sel;
      const item = items[sel] as SelectItem;
      if (item.value === "done") {
        // keep every discovery: roles choose which matter.
        return { discoveries };
      }
      if (item.value === "addr") {
        const url = await lineStep("Server URL (e.g. http://192.168.1.64:8081): ");
        if (url === BACK || url === CANCEL) return url;
        const base = normalizeServerUrl(url);
        if (base === undefined) throw new Error("that is not a valid URL");
        setStatus("probing server…");
        const d = await probeUrlAsDiscovered(base);
        setStatus(stepTitle("models"));
        if (d === undefined) throw new Error(`${base} answered nothing on /v1/models`);
        mergeInto(discoveries, [d]);
        continue;
      }
      if (item.value === "net") {
        const y = await selectStep(
          "Scan your local network for AI servers?",
          [
            { value: "n", label: "No" },
            { value: "y", label: "Yes: private ranges only (10/8, 172.16/12, 192.168/16)" },
          ],
          (i) => i,
        );
        if (y === BACK || y === CANCEL) return y;
        if (y === 1) {
          const cidrs = privateInterfaceIPv4().map(cidr24Of);
          if (cidrs.length === 0) {
            throw new Error("no private IPv4 interface found");
          }
          setStatus(`scanning ${String(cidrs.length)} network(s)… (800ms per host)`);
          const hits = await scanNetwork(cidrs, { fetchImpl: opts.fetchImpl, timeoutMs: 800, concurrency: 64 });
          setStatus(stepTitle("models"));
          mergeInto(discoveries, hits);
          if (hits.length === 0) setStatus("no server found on the local network");
        }
        continue;
      }
      if (item.value === "ts") {
        setStatus("scanning tailscale peers…");
        const hits = await scanTailscale({ fetchImpl: opts.fetchImpl });
        setStatus(stepTitle("models"));
        mergeInto(discoveries, hits);
        continue;
      }
      // an existing server: keep or remove
      const key = item.value.slice(2);
      const idx = discoveries.findIndex((d) => `${d.host}:${String(d.port)}` === key);
      const sub = await selectStep(
        item.label,
        [
          { value: "keep", label: "Keep it" },
          { value: "remove", label: "Remove it" },
        ],
        (i) => i,
      );
      if (sub === BACK || sub === CANCEL) return sub;
      if (sub === 1) discoveries.splice(idx, 1);
    }
  }

  async function stepRoles(): Promise<StepResult> {
    const roles: SetupAnswers["roles"] = {};
    const main = await askRole("main", { required: true });
    if (main === BACK || main === CANCEL) return main;
    roles.main = main;
    const fast = await askRole("fast (used by the Auto judge)", { useMainDefault: main });
    if (fast === BACK || fast === CANCEL) return fast;
    if (fast !== undefined) roles.fast = fast;
    const vision = await askRole("vision (optional)", { allowNone: true });
    if (vision === BACK || vision === CANCEL) return vision;
    if (vision !== undefined) roles.vision = vision;
    return { roles };
  }

  async function askRole(
    label: string,
    opts: { required?: boolean; allowNone?: boolean; useMainDefault?: RolePick },
  ): Promise<Outcome<RolePick | undefined>> {
    const discoveries = flow.answers.discoveries;
    const items: SelectItem[] = [];
    if (opts.allowNone === true) items.push({ value: "none", label: "None: skip" });
    if (opts.useMainDefault !== undefined) {
      items.push({ value: "main", label: `Use main (${opts.useMainDefault.model})` });
    }
    discoveries.forEach((d, i) =>
      items.push({ value: `s${String(i)}`, label: `${discoveredLabel(d)}  ·  ${d.baseUrl}` }),
    );
    items.push({ value: "deepseek", label: "DeepSeek (cloud, needs an API key)" });
    items.push({ value: "openrouter", label: "OpenRouter (cloud, needs an API key)" });

    const src = await selectStep(`Role: ${label}`, items, (i) => i);
    if (src === BACK || src === CANCEL) return src;
    const item = items[src] as SelectItem;
    if (item.value === "none") return undefined;
    if (item.value === "main") return opts.useMainDefault;
    if (item.value === "deepseek" || item.value === "openrouter") {
      const cloud = item.value === "deepseek" ? "deepseek-official" : "openrouter";
      const def = cloud === "deepseek-official" ? "deepseek-flash" : "openrouter/auto";
      const typed = await lineStep(`Model id on ${cloud} [${def}]: `);
      if (typed === BACK || typed === CANCEL) return typed;
      return { cloud, model: typed.trim() === "" ? def : typed.trim() };
    }
    const d = discoveries[Number(item.value.slice(1))] as Discovered;
    const modelItems: SelectItem[] = d.models.map((m) => {
      const ctx = d.modelInfos?.find((mi) => mi.id === m)?.contextWindow;
      return { value: m, label: ctx !== undefined ? `${m}  (${fmtK(ctx)} ctx)` : m };
    });
    modelItems.push({ value: "+", label: "+ Type a model id…" });
    let model = "";
    let contextWindow: number | undefined;
    for (;;) {
      const ms = await selectStep(`Main model on ${d.baseUrl}`, modelItems, (i) => i);
      if (ms === BACK || ms === CANCEL) return ms;
      const chosen = modelItems[ms] as SelectItem;
      if (chosen.value !== "+") {
        model = chosen.value;
        contextWindow = d.modelInfos?.find((mi) => mi.id === model)?.contextWindow;
        break;
      }
      const typed = await lineStep("Model id: ");
      if (typed === BACK || typed === CANCEL) return typed;
      if (typed.trim() === "") throw new Error("model id required");
      model = typed.trim();
      contextWindow = undefined;
      break;
    }
    if (contextWindow === undefined) {
      // T21+: the server did not say — the user must, never the training size.
      for (;;) {
        const v = await lineStep(`Context window for ${model} (tokens, e.g. 16384): `);
        if (v === BACK || v === CANCEL) return v;
        const n = Number.parseInt(v.trim(), 10);
        if (Number.isInteger(n) && n >= 1024) {
          contextWindow = n;
          break;
        }
        throw new Error("enter a whole number of at least 1024 tokens");
      }
    }
    return { discovered: d, model, contextWindow };
  }

  async function stepKeys(): Promise<StepResult> {
    const reqs = requiredKeyEnvs(flow.answers);
    if (reqs.length === 0) {
      const r = await selectStep("No API keys needed for your choices.", [
        { value: "go", label: "Continue →" },
      ], (i) => i);
      if (r === BACK || r === CANCEL) return r;
      return {};
    }
    const keys = { ...flow.answers.keys };
    for (const env of reqs) {
      const v = await lineStep(`Enter ${env} (input is hidden): `, true);
      if (v === BACK || v === CANCEL) return v;
      keys[env] = v.trim();
    }
    return { keys };
  }

  async function stepMode(): Promise<StepResult> {
    const m = await selectStep(
      "Default access mode",
      [
        { value: "ask", label: "Ask (default): confirm every command and write" },
        { value: "auto", label: "Auto: kumo decides, risky actions still ask" },
        { value: "full", label: "Full access: never asks" },
      ],
      (i) => i,
    );
    if (m === BACK || m === CANCEL) return m;
    const mode = ["ask", "auto", "full"][m] as PermissionModeValue;
    if (mode === "full") {
      const conf = await lineStep("FULL ACCESS means kumo runs anything. Type full to confirm: ");
      if (conf === BACK || conf === CANCEL) return conf;
      if (conf.trim() !== "full") throw new Error("confirmation failed. Staying on this step");
    }
    return { permissionMode: mode };
  }

  async function stepSearch(): Promise<StepResult> {
    setStatus("checking for a local SearXNG…");
    const detected = await detectSearxng(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {});
    setStatus(stepTitle("search"));
    const s = await selectStep(
      "Web search (a search needs an index of the web. Nothing is scraped for free)",
      [
        { value: "none", label: "None (default)" },
        { value: "searxng", label: detected !== undefined ? `SearXNG: detected on ${detected}` : "SearXNG: self-hosted instance URL" },
        { value: "brave", label: "Brave Search: API key" },
        { value: "tavily", label: "Tavily: API key" },
      ],
      (i) => i,
    );
    if (s === BACK || s === CANCEL) return s;
    if (s === 0) return { search: { provider: "none" }, keys: { ...flow.answers.keys } };
    if (s === 1) {
      const def = detected ?? "http://127.0.0.1:8888";
      const u = await lineStep(`SearXNG URL [${def}]: `);
      if (u === BACK || u === CANCEL) return u;
      return { search: { provider: "searxng", url: u.trim() === "" ? def : u.trim() } };
    }
    if (s === 2) {
      const k = await lineStep("Brave Search API key (input is hidden): ", true);
      if (k === BACK || k === CANCEL) return k;
      return {
        search: { provider: "brave", apiKeyEnv: "BRAVE_API_KEY" },
        keys: { ...flow.answers.keys, BRAVE_API_KEY: k.trim() },
      };
    }
    const k = await lineStep("Tavily API key (input is hidden): ", true);
    if (k === BACK || k === CANCEL) return k;
    return {
      search: { provider: "tavily", apiKeyEnv: "TAVILY_API_KEY" },
      keys: { ...flow.answers.keys, TAVILY_API_KEY: k.trim() },
    };
  }

  async function stepSkills(bundled: SkillMeta[]): Promise<StepResult> {
    // T26: three groups — shipped with kumo, found on this computer, and
    // (read-only) skills in this project, which kumo never manages. A name
    // both shipped and found keeps ONE row: the shipped one wins.
    const allFound = await scanFoundSkills(homedir());
    const shippedNames = new Set(bundled.map((s) => s.name));
    const found = allFound.filter((s) => !shippedNames.has(s.name));
    const project = await scanProjectSkills(process.cwd());
    if (bundled.length === 0 && found.length === 0 && project.length === 0) {
      const r = await selectStep("No skills are available.", [{ value: "go", label: "Continue →" }], (i) => i);
      if (r === BACK || r === CANCEL) return r;
      return { skills: [] };
    }
    const items: CheckItem[] = [
      { value: "#shipped", label: "Shipped with kumo", disabled: true },
      ...bundled.map((s) => ({ value: s.name, label: s.name, description: s.description })),
      { value: "#found", label: "Found on this computer", disabled: true },
      ...found.map((s) => ({
        value: s.name,
        label: s.name,
        description:
          s.alsoIn.length > 0
            ? `${s.description}  (also in: ${s.alsoIn.join(", ")})`.trim()
            : s.description,
      })),
      { value: "#project", label: `In this project (always available: ${process.cwd()})`, disabled: true },
      ...project.map((s) => ({ value: `#${s.name}`, label: s.name, description: s.description })),
    ];
    const saved = skillsSubmitted ? flow.answers.skills : savedSkillsList(dshHome);
    const checked = initialSkillChecks(items, saved, found);
    const sel = await checkStep("Skills: Space toggles, Enter continues", items, checked);
    if (sel === BACK || sel === CANCEL) return sel;
    skillsSubmitted = true;
    return { skills: sel.map((i) => (items[i] as CheckItem).value) };
  }

  async function stepTheme(): Promise<StepResult> {
    const themes: Theme[] = ["dark", "light", "high-contrast"];
    const preview = (index: number): Component => {
      const theme = themes[index] as Theme;
      const style = theme === "high-contrast" ? ansi.bold : theme === "light" ? (s: string) => `\x1b[30m${s}\x1b[39m` : ansi.gray;
      return new Text(
        style("  💭 thinking about the fix…\n  ● bash  pnpm test\n  12.3%/131k (auto)      (local) my-model • low"),
        1,
        0,
      );
    };
    const sel = await selectStep(
      "Theme",
      themes.map((t) => ({ value: t, label: t })),
      (i) => i,
      { livePreview: preview, initial: themes.indexOf(flow.answers.theme) },
    );
    if (sel === BACK || sel === CANCEL) return sel;
    return { theme: themes[sel] as Theme };
  }

  async function stepTelemetry(): Promise<StepResult> {
    if (!updateCheckLoaded) {
      updateCheckLoaded = true;
      updateCheckChoice = readUpdateCheckChoice(await readKumoJsonDoc(dshHome)) ?? true;
    }
    const sel = await selectStep("Share anonymous usage data with DeepSeek Harness?", [
      { value: "no", label: "No (default)" },
      { value: "yes", label: "Yes" },
    ], (i) => i, { initial: flow.answers.telemetry ? 1 : 0 });
    if (sel === BACK || sel === CANCEL) return sel;
    const u = await selectStep(
      "Check npm once a day for a newer kumo and note it at startup? (nothing is sent but the version query)",
      [
        { value: "yes", label: "Yes (recommended)" },
        { value: "no", label: "No" },
      ],
      (i) => i,
      { initial: updateCheckChoice ? 0 : 1 },
    );
    if (u === BACK || u === CANCEL) return u;
    updateCheckChoice = u === 0;
    return { telemetry: sel === 1 };
  }

  async function stepSummary(bundledRoot: string, bundled: SkillMeta[]): Promise<StepResult> {
    const plan = flow.buildPlan({ dshHome, bundledSkillsRoot: bundledRoot, bundledSkills: bundled });
    const a = flow.answers;
    const ref = (r: RolePick | undefined): string =>
      r === undefined ? "none" : `${r.cloud ?? r.discovered?.baseUrl ?? "?"} · ${r.model}`;
    const lines = [
      `  Main     ${ref(a.roles.main)}`,
      `  Fast     ${ref(a.roles.fast ?? a.roles.main)}${a.roles.fast === undefined ? "  (default = main)" : ""}`,
      `  Vision   ${ref(a.roles.vision)}`,
      `  Access   ${a.permissionMode}`,
      `  Search   ${a.search.provider}`,
      `  Skills   ${a.skills.length > 0 ? a.skills.join(", ") : "none"}`,
      `  Theme    ${a.theme}`,
      `  Telemetry ${a.telemetry ? "yes" : "no"}`,
      `  Updates   ${updateCheckChoice ? "daily check on" : "check off"}`,
      "",
      `  writes: ${dshHome}/settings.yaml · kumo.json · .env · skills/`,
    ].join("\n");
    const shown = new Text(ansi.bold("Review\n") + lines, 1, 1);
    const choice = await selectStep(
      "Summary",
      [
        { value: "save", label: "Save" },
        { value: "back", label: "← Back" },
        { value: "quit", label: "Quit without saving" },
      ],
      (i) => i,
      { above: shown },
    );
    if (choice === BACK || choice === CANCEL) return choice;
    if (choice === 0) {
      await flow.save({ dshHome, bundledSkillsRoot: bundledRoot, bundledSkills: bundled });
      // T30: `updateCheck` lives in kumo.json next to the fields the flow
      // owns; flow.buildPlan stays untouched, so merge it after the save.
      await setUpdateCheck(dshHome, updateCheckChoice);
      return "saved";
    }
    if (choice === 1) return BACK;
    return CANCEL;
  }


  async function probeUrlAsDiscovered(baseUrl: string): Promise<Discovered | undefined> {
    const u = new URL(baseUrl);
    const port = Number(u.port) || (u.protocol === "https:" ? 443 : 80);
    const d = await probeServer(u.hostname, port, {
      fetchImpl: opts.fetchImpl,
      timeoutMs: 3000,
      source: "manual",
    });
    if (d === undefined) return undefined;
    return { ...d, baseUrl, host: u.hostname, port };
  }

}

/* ── shared helpers ───────────────────────────────────────────────── */

function mergeInto(into: Discovered[], hits: Discovered[]): void {
  for (const h of hits) {
    const existing = into.find((d) => d.host === h.host && d.port === h.port);
    if (existing === undefined) into.push(h);
    else {
      existing.models = h.models;
      existing.modelInfos = h.modelInfos;
    }
  }
}

function fmtK(n: number): string {
  return n >= 1000 ? `${String(Math.round(n / 1000))}k` : String(n);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => {
    setTimeout(r, ms);
  });

function stepTitle(step: string): string {
  const labels: Record<string, string> = {
    models: "AI servers",
    roles: "Roles",
    keys: "API keys",
    mode: "Access mode",
    search: "Web search",
    skills: "Skills",
    theme: "Theme",
    telemetry: "Telemetry",
    summary: "Summary",
  };
  const order = ["models", "roles", "keys", "mode", "search", "skills", "theme", "telemetry", "summary"];
  return `${labels[step] ?? step}  (step ${String(order.indexOf(step) + 1)}/${String(order.length)})  ·  Esc back · Ctrl+C quit`;
}

/** A plain readline SetupIO for the simple path (secret is masked raw). */
function setupIO(): SetupIO {
  const isTTY = process.stdin.isTTY === true && process.stdout.isTTY === true;
  return {
    isTTY,
    write: (text) => void process.stdout.write(text),
    question: async (q) => {
      const rl = await import("node:readline/promises");
      const iface = rl.createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await iface.question(q);
      } finally {
        iface.close();
      }
    },
    secret: async (q) => {
      if (!isTTY) return "";
      process.stdout.write(q);
      return await new Promise<string>((resolveP) => {
        let value = "";
        const stdin = process.stdin;
        const onData = (buf: Buffer) => {
          for (const ch of buf.toString("utf8")) {
            const code = ch.codePointAt(0) ?? 0;
            if (code === 13 || code === 10) {
              finish();
              return;
            }
            if (code === 3) {
              stdin.setRawMode(false);
              process.stdout.write("\n");
              process.exit(130);
            }
            if (code === 127 || code === 8) {
              const chars = [...value];
              chars.pop();
              value = chars.join("");
              process.stdout.write("\b \b");
              continue;
            }
            if (code >= 32) {
              value += ch;
              process.stdout.write("*");
            }
          }
        };
        const finish = () => {
          stdin.setRawMode(false);
          stdin.removeListener("data", onData);
          stdin.pause();
          process.stdout.write("\n");
          resolveP(value);
        };
        stdin.setRawMode(true);
        stdin.resume();
        stdin.on("data", onData);
      });
    },
  };
}
