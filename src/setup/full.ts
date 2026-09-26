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
import { mkdir, rename, writeFile } from "node:fs/promises";
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
  currentModelsSummary,
  discoveredLabel,
  privateInterfaceIPv4,
  probeServer,
  scanLocalhosts,
  scanNetwork,
  scanTailscale,
  tailscalePeerIPs,
  type Discovered, type TemplateCaps,
  type ScanOptions,
} from "./discover.js";
import { readBundledSkills, scanFoundSkills, scanProjectSkills, SKILLS_MANIFEST, type FoundSkill, type SkillMeta } from "./skills.js";
import {
  detectSearxng,
  normalizeServerUrl,
  simpleSetup,
  type SearchChoice,
  type SetupIO,
} from "./simple.js";
import { readKumoJsonDoc, readUpdateCheckChoice, setUpdateCheck } from "../update.js";
import { parse as parseYaml } from "yaml";

const BACK = Symbol("back");
const CANCEL = Symbol("cancel");
const SKIP = Symbol("skip");
type Outcome<T> = T | typeof BACK | typeof CANCEL;
type StepResult = Outcome<Partial<SetupAnswers>> | "saved";
// T35 Skip: a select/check step resolved via the `s` key or the last Skip item.
type Skippable<T> = Outcome<T | typeof SKIP>;

/** Merge `suggestions` into kumo.json (0600, atomic); keeps every other key. */
export async function setSuggestionsChoice(dshHome: string, value: boolean): Promise<void> {
  const doc = (await readKumoJsonDoc(dshHome)) as Record<string, unknown>;
  doc.suggestions = value;
  const file = join(dshHome, "kumo.json");
  await mkdir(dshHome, { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(doc, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, file);
}

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
  onSkip?: () => void;
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
    // T35: `s` skips the whole step (keep current), same as the Skip item.
    if (data === "s" || data === "S") {
      this.onSkip?.();
      return;
    }
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

/** ── prefill from an existing install (T35: settings.yaml source of truth) ── */

interface KumoJsonShape {
  mode?: string;
  models?: Record<
    string,
    {
      provider?: string;
      model?: string;
      baseUrl?: string;
      contextWindow?: number;
      /** T34: chat-template switches captured at the last setup. */
      template?: TemplateCaps;
    } | undefined
  >;
  permissionMode?: string;
  access?: string;
  search?: SearchChoice;
  skills?: string[];
  theme?: string;
  telemetry?: boolean;
}

interface SettingsYamlShape {
  "llm-pi-ai"?: { providers?: Record<string, any> };
  "agent-default-model"?: { provider?: unknown; model?: unknown };
  "ui-theme"?: { preference?: unknown };
  [k: string]: unknown;
}

function parseSettingsYaml(text: string): SettingsYamlShape | undefined {
  try {
    const doc = parseYaml(text) as SettingsYamlShape;
    if (doc === null || typeof doc !== "object") return undefined;
    return doc;
  } catch {
    return undefined;
  }
}

/** T35: does this prefill come from an existing install (menu, not wizard)? */
export function isExistingInstall(prefill: SetupAnswers | undefined): boolean {
  const doc = prefill?.settingsOrig as Record<string, any> | undefined;
  const def = doc?.["agent-default-model"] as { provider?: unknown; model?: unknown } | undefined;
  return typeof def?.provider === "string" && def.provider !== "" && typeof def?.model === "string" && def.model !== "";
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
  let kumoDoc: KumoJsonShape | undefined;
  try {
    kumoDoc = JSON.parse(readFileSync(join(dshHome, "kumo.json"), "utf8")) as KumoJsonShape;
  } catch {
    kumoDoc = undefined;
  }
  let settingsDoc: SettingsYamlShape | undefined;
  try {
    settingsDoc = parseSettingsYaml(readFileSync(join(dshHome, "settings.yaml"), "utf8"));
  } catch {
    settingsDoc = undefined;
  }
  if (kumoDoc === undefined && settingsDoc === undefined) return undefined;

  const answers = defaultAnswers();
  // T35: keep the originals for round-trip preservation (never touched by steps).
  if (settingsDoc !== undefined) {
    answers.settingsOrig = JSON.parse(JSON.stringify(settingsDoc)) as SetupAnswers["settingsOrig"];
  }
  if (kumoDoc !== undefined) {
    answers.kumoOrig = JSON.parse(JSON.stringify(kumoDoc)) as Record<string, unknown>;
  }

  const discoveries: Discovered[] = [];
  const roles: SetupAnswers["roles"] = {};
  const providers = settingsDoc?.["llm-pi-ai"]?.providers as Record<string, any> | undefined;

  // Every route in llm-pi-ai.providers with models → a current discovery.
  if (providers !== undefined) {
    for (const [pName, pConf] of Object.entries(providers)) {
      if (pConf === null || typeof pConf !== "object") continue;
      const baseURL = (pConf as any).baseURL;
      const modelsRaw = (pConf as any).models;
      if (typeof baseURL !== "string" || baseURL === "" || !Array.isArray(modelsRaw)) continue;
      let host = "";
      let port = 80;
      try {
        const u = new URL(baseURL);
        host = u.hostname;
        port = Number(u.port) || (u.protocol === "https:" ? 443 : 80);
      } catch {
        continue;
      }
      const models: string[] = [];
      const modelInfos: Discovered["modelInfos"] = [];
      for (const m of modelsRaw) {
        if (m === null || typeof m !== "object" || typeof (m as any).id !== "string") continue;
        const id = (m as any).id as string;
        if (id === "") continue;
        models.push(id);
        modelInfos.push({
          id,
          ...((m as any).contextWindow !== undefined && typeof (m as any).contextWindow === "number"
            ? { contextWindow: (m as any).contextWindow as number }
            : {}),
          ...((m as any).name !== undefined && typeof (m as any).name === "string"
            ? { name: (m as any).name as string }
            : {}),
        });
      }
      if (models.length === 0) continue;
      // Template rides in kumo.json (T34 round-trip); attach the first match.
      let template: TemplateCaps | undefined;
      for (const r of ["main", "fast", "vision"] as const) {
        const ref = kumoDoc?.models?.[r];
        if (ref?.provider === pName && ref.model !== undefined && models.includes(ref.model) && ref.template !== undefined) {
          template = ref.template;
          break;
        }
      }
      discoveries.push({
        source: "settings",
        host,
        port,
        baseUrl: baseURL,
        models,
        modelInfos,
        ...(template !== undefined ? { template } : {}),
        current: true,
        providerName: pName,
      });
    }
  }

  const byBaseUrl = (baseUrl: string): Discovered | undefined => discoveries.find((d) => d.baseUrl === baseUrl);
  const byProvider = (pName: string): Discovered | undefined =>
    discoveries.find((d) => d.providerName === pName);

  // Roles from agent-default-model (settings.yaml truth) + kumo.json models.
  const def = settingsDoc?.["agent-default-model"] as { provider?: unknown; model?: unknown } | undefined;
  if (typeof def?.provider === "string" && typeof def?.model === "string" && def.provider !== "" && def.model !== "") {
    const pName = def.provider;
    const mId = def.model;
    if (pName === "deepseek-official" || pName === "openrouter") {
      roles.main = { cloud: pName, model: mId };
    } else {
      const d = byProvider(pName);
      if (d !== undefined) {
        const info = d.modelInfos.find((m) => m.id === mId);
        const kumoRef = (["main", "fast", "vision"] as const)
          .map((r) => kumoDoc?.models?.[r])
          .find((r) => r?.provider === pName && r.model === mId);
        roles.main = {
          discovered: d,
          model: mId,
          ...(info?.contextWindow !== undefined ? { contextWindow: info.contextWindow } : {}),
          ...(d.template !== undefined || kumoRef?.template !== undefined
            ? {}
            : {}),
        };
        // Attach template from kumo.json when the settings discovery lacks it.
        if (d.template === undefined && kumoRef?.template !== undefined) {
          roles.main = { ...roles.main, discovered: { ...d, template: kumoRef.template } };
          d.template = kumoRef.template;
        } else if (kumoRef?.contextWindow !== undefined && info?.contextWindow === undefined) {
          roles.main = { ...roles.main, contextWindow: kumoRef.contextWindow };
        }
      } else {
        // Default points at an unknown provider: fall back to kumo.json refs below.
      }
    }
  }
  // kumo.json fast/vision (and main fallback when settings has no default).
  if (kumoDoc?.models !== undefined) {
    for (const role of ["main", "fast", "vision"] as const) {
      if (role === "main" && roles.main !== undefined) {
        // Main already from settings default; still merge template/context when
        // kumo.json carries them (Aron's minimal kumo.json has template only).
        const ref = kumoDoc.models[role];
        const curDiscovered = roles.main.discovered;
        if (ref?.provider !== undefined && ref.model !== undefined && curDiscovered !== undefined) {
          const cur = roles.main;
          if (ref.template !== undefined && curDiscovered.template === undefined) {
            cur.discovered = { ...curDiscovered, template: ref.template };
          }
          if (ref.contextWindow !== undefined && cur.contextWindow === undefined) {
            roles.main = { ...cur, contextWindow: ref.contextWindow };
          }
        }
        continue;
      }
      const ref = kumoDoc.models[role];
      if (ref?.provider === undefined || ref.model === undefined) continue;
      if (ref.provider === "deepseek-official" || ref.provider === "openrouter") {
        roles[role] = { cloud: ref.provider, model: ref.model };
        continue;
      }
      // Local ref: prefer the settings discovery for the same provider name.
      const d = byProvider(ref.provider);
      if (d !== undefined && d.models.includes(ref.model)) {
        const info = d.modelInfos.find((m) => m.id === ref.model);
        roles[role] = {
          discovered: ref.template !== undefined && d.template === undefined ? { ...d, template: ref.template } : d,
          model: ref.model,
          ...(ref.contextWindow ?? info?.contextWindow !== undefined
            ? { contextWindow: (ref.contextWindow ?? info?.contextWindow) as number }
            : {}),
        };
        continue;
      }
      // Fall back to a baseUrl ref (old kumo.json shape).
      const pick = roleFromModelRef({
        provider: ref.provider,
        model: ref.model,
        ...(ref.baseUrl !== undefined ? { baseUrl: ref.baseUrl } : {}),
        ...(ref.contextWindow !== undefined ? { contextWindow: ref.contextWindow } : {}),
        ...(ref.template !== undefined ? { template: ref.template } : {}),
      });
      if (pick === undefined) {
        // Local provider name without baseUrl (Aron's minimal kumo.json) but
        // no matching settings discovery (should not happen when settings has
        // the default): skip — settings default already covers main.
        continue;
      }
      roles[role] = pick;
      if (pick.discovered !== undefined) {
        const existing = byBaseUrl(pick.discovered.baseUrl);
        if (existing !== undefined) {
          if (!existing.models.includes(pick.model)) {
            existing.models.push(pick.model);
            existing.modelInfos.push({
              id: pick.model,
              ...(pick.contextWindow !== undefined ? { contextWindow: pick.contextWindow } : {}),
            });
          }
          // Point the role at the shared (current) discovery when possible.
          if (existing.current === true) roles[role] = { ...pick, discovered: existing };
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
    }
  }

  answers.discoveries = discoveries;
  answers.roles = roles;
  answers.keys = readEnvFile(dshHome);
  const doc = kumoDoc;
  if (doc !== undefined) {
    if (doc.permissionMode === "ask" || doc.permissionMode === "auto" || doc.permissionMode === "full") {
      answers.permissionMode = doc.permissionMode;
    } else if (doc.access === "ask" || doc.access === "auto" || doc.access === "full") {
      answers.permissionMode = doc.access;
    }
    if (doc.search !== undefined && typeof doc.search.provider === "string") {
      answers.search = doc.search;
    }
    if (Array.isArray(doc.skills)) {
      answers.skills = doc.skills.map((s) => String(s));
    } else {
      // T35: a pre-T26 kumo.json has no `skills`: keep what is installed, or a
      // Save that changed only the theme would uninstall every skill.
      const installed = installedSkillsList(dshHome);
      if (installed !== undefined) answers.skills = installed;
    }
    if (doc.theme === "dark" || doc.theme === "light" || doc.theme === "high-contrast") {
      answers.theme = doc.theme;
    } else if (settingsDoc?.["ui-theme"] !== undefined) {
      const pref = (settingsDoc["ui-theme"] as any)?.preference;
      if (pref === "light") answers.theme = "light";
      else if (pref === "dark") answers.theme = "dark";
    }
    if (typeof doc.telemetry === "boolean") answers.telemetry = doc.telemetry;
  } else if (settingsDoc?.["ui-theme"] !== undefined) {
    const pref = (settingsDoc["ui-theme"] as any)?.preference;
    if (pref === "light") answers.theme = "light";
    else answers.theme = "dark";
  }
  // T35: settings.yaml only (no kumo.json) — the manifest still guards skills.
  if (kumoDoc === undefined) {
    const installed = installedSkillsList(dshHome);
    if (installed !== undefined) answers.skills = installed;
  }
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
 * T35: what kumo actually installed, from the T26 manifest. This is the
 * prefill source when kumo.json predates the `skills` key: without it, a Save
 * that touched only the theme would plan `chosen: []` and uninstall every
 * skill the manifest records.
 */
export function installedSkillsList(dshHome: string): string[] | undefined {
  try {
    const raw = JSON.parse(readFileSync(join(dshHome, "skills", SKILLS_MANIFEST), "utf8")) as Record<string, unknown>;
    const names = Object.keys(raw).filter((n) => n !== "" && typeof raw[n] !== "undefined");
    return names.length > 0 ? names.sort((a, b) => a.localeCompare(b)) : [];
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
  // T28B: same ride for the ghost-suggestion toggle (default true).
  let suggestionsChoice = true;
  let suggestionsLoaded = false;
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
      // T35: `s` picks the last Skip item when the step offers one.
      const skipIdx = items.length > 0 && items[items.length - 1]?.value === "skip" ? items.length - 1 : -1;
      if (skipIdx >= 0) {
        const origInput = list.handleInput.bind(list);
        list.handleInput = (data: string) => {
          if (data === "s" || data === "S") {
            list.setSelectedIndex(skipIdx);
            finish(map(skipIdx));
            return;
          }
          origInput(data);
        };
      }
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
  ): Promise<Skippable<number[]>> =>
    interactive<number[] | typeof SKIP>(title, (finish) => {
      const cl = new CheckList(items, checked);
      cl.onDone = (idx) => finish(idx);
      // T35: `s` skips (keep current) — same as the Skip path in select steps.
      cl.onSkip = () => finish(SKIP);
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

    // T35: existing install → change-one-thing menu, not the linear wizard.
    if (isExistingInstall(opts.prefill)) {
      return await driveMenu(bundledRoot, bundled);
    }

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

  /** T35 existing-install menu: change one thing, Save writes once. */
  async function driveMenu(bundledRoot: string, bundled: SkillMeta[]): Promise<"saved" | "simple" | "quit"> {
    // Load the T30/T28B toggles once for the Telemetry value line.
    if (!updateCheckLoaded) {
      updateCheckLoaded = true;
      try {
        updateCheckChoice = readUpdateCheckChoice(await readKumoJsonDoc(dshHome)) ?? true;
      } catch {
        updateCheckChoice = true;
      }
    }
    if (!suggestionsLoaded) {
      suggestionsLoaded = true;
      try {
        const doc = (await readKumoJsonDoc(dshHome)) as { suggestions?: boolean };
        suggestionsChoice = doc.suggestions ?? true;
      } catch {
        suggestionsChoice = true;
      }
    }
    status = "kumo setup: what do you want to change?  ·  Esc quit";
    for (;;) {
      const pick = await selectStep(
        "kumo setup: what do you want to change?",
        [
          { value: "models", label: "Models", description: modelsMenuValue() },
          { value: "mode", label: "Default mode", description: modeMenuValue() },
          { value: "search", label: "Web search", description: flow.answers.search.provider },
          { value: "skills", label: "Skills", description: skillsMenuValue() },
          { value: "theme", label: "Theme", description: flow.answers.theme },
          { value: "telemetry", label: "Telemetry", description: telemetryMenuValue() },
          { value: "save", label: "Save and exit" },
          { value: "quit", label: "Quit without saving" },
        ],
        (i) => i,
      );
      if (pick === BACK || pick === CANCEL) {
        flow.cancel();
        return "quit";
      }
      if (pick === 6) {
        try {
          await flow.saveFromMenu({ dshHome, bundledSkillsRoot: bundledRoot, bundledSkills: bundled });
          await setUpdateCheck(dshHome, updateCheckChoice);
          await setSuggestionsChoice(dshHome, suggestionsChoice);
          return "saved";
        } catch (err) {
          setStatus(`! ${(err as Error).message}`);
          await sleep(1600);
          status = "kumo setup: what do you want to change?  ·  Esc quit";
          continue;
        }
      }
      if (pick === 7) {
        flow.cancel();
        return "quit";
      }
      try {
        const done = await runMenuStep(pick as number, bundled);
        if (done === CANCEL) {
          flow.cancel();
          return "quit";
        }
        // BACK from a single step = back to menu, discarding nothing (apply
        // already merged only on success; BACK merges nothing).
        status = "kumo setup: what do you want to change?  ·  Esc quit";
      } catch (err) {
        setStatus(`! ${(err as Error).message}. Try again`);
        await sleep(1400);
        status = "kumo setup: what do you want to change?  ·  Esc quit";
      }
    }
  }

  /** Run one menu line (0=Models … 5=Telemetry), merging into flow via apply(). */
  async function runMenuStep(index: number, bundled: SkillMeta[]): Promise<typeof BACK | typeof CANCEL | "done"> {
    if (index === 0) {
      // Models = servers + roles + keys, then back to menu.
      const m = await stepModels();
      if (m === BACK || m === CANCEL) return m;
      flow.apply(m as Partial<SetupAnswers>);
      const r = await stepRoles();
      if (r === BACK || r === CANCEL) return r;
      flow.apply(r as Partial<SetupAnswers>);
      const k = await stepKeys();
      if (k === BACK || k === CANCEL) return k;
      flow.apply(k as Partial<SetupAnswers>);
      return "done";
    }
    let result: StepResult;
    if (index === 1) result = await stepMode();
    else if (index === 2) result = await stepSearch();
    else if (index === 3) result = await stepSkills(bundled);
    else if (index === 4) result = await stepTheme();
    else result = await stepTelemetry();
    if (result === BACK || result === CANCEL) return result;
    if (result === "saved") return "done"; // never from single steps
    flow.apply(result as Partial<SetupAnswers>);
    return "done";
  }

  function modelsMenuValue(): string {
    const main = flow.answers.roles.main;
    if (main?.discovered !== undefined) {
      const d = flow.answers.discoveries.find(
        (x) => x.host === main.discovered?.host && x.port === main.discovered?.port,
      ) ?? main.discovered;
      const pretty = d.modelInfos.find((m) => m.id === main.model)?.name ?? main.model;
      let host = d.host;
      try {
        host = new URL(d.baseUrl).hostname;
      } catch {
        // keep host
      }
      return `${pretty} · ${host}`;
    }
    if (main?.cloud !== undefined) return `${main.cloud} · ${main.model}`;
    return currentModelsSummary(flow.answers.discoveries);
  }

  function modeMenuValue(): string {
    const m = flow.answers.permissionMode;
    return m === "auto" ? "Auto" : m === "full" ? "Full access" : "Ask";
  }

  function skillsMenuValue(): string {
    const n = flow.answers.skills.length;
    return n === 0 ? "none" : `${String(n)} enabled`;
  }

  function telemetryMenuValue(): string {
    const t = flow.answers.telemetry ? "on" : "off";
    return `${t} · update check ${updateCheckChoice ? "on" : "off"} · suggestions ${suggestionsChoice ? "on" : "off"}`;
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
    const canSkip = (): boolean => discoveries.some((d) => d.models.length > 0);
    for (;;) {
      const skipLabel = `Skip (keep: ${String(discoveries.length)} server${discoveries.length === 1 ? "" : "s"})`;
      const items: SelectItem[] = [
        ...discoveries.map((d) => ({ value: `s:${d.host}:${String(d.port)}`, label: discoveredLabel(d) })),
        { value: "addr", label: "+ Enter a server address…" },
        { value: "net", label: "+ Scan your local network" },
        ...(tailscalePeerIPs().length > 0 ? [{ value: "ts", label: "+ Scan your Tailscale peers" }] : []),
        { value: "done", label: discoveries.length > 0 ? "Continue →" : "Continue → (cloud models only)" },
        // T35: Skip everywhere; Models only when at least one model exists.
        ...(canSkip() ? [{ value: "skip", label: skipLabel }] : []),
      ];
      const sel = await selectStep(
        "AI servers: found, add, or remove; Enter to pick an action (s skips)",
        items,
        (i) => i,
      );
      if (sel === BACK || sel === CANCEL) return sel;
      const item = items[sel] as SelectItem;
      if (item.value === "skip") {
        return { discoveries };
      }
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
    if (main === SKIP) return {};
    roles.main = main as RolePick;
    const fast = await askRole("fast (used by the Auto judge)", { useMainDefault: roles.main });
    if (fast === BACK || fast === CANCEL) return fast;
    if (fast !== SKIP && fast !== undefined) roles.fast = fast as RolePick;
    const vision = await askRole("vision (optional)", { allowNone: true });
    if (vision === BACK || vision === CANCEL) return vision;
    if (vision !== SKIP && vision !== undefined) roles.vision = vision as RolePick;
    return { roles };
  }

  async function askRole(
    label: string,
    opts: { required?: boolean; allowNone?: boolean; useMainDefault?: RolePick },
  ): Promise<Skippable<RolePick | undefined>> {
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
    // T35: Skip (keep current) on the main pick skips the whole Roles step.
    // Preselect the current role so `kumo setup` shows what is there.
    let initial: number | undefined;
    let skipLabel = "Skip (keep: none)";
    if (opts.required === true) {
      const cur = flow.answers.roles.main;
      if (cur !== undefined) {
        const idx =
          cur.cloud !== undefined
            ? items.findIndex((it) => it.value === (cur.cloud === "deepseek-official" ? "deepseek" : "openrouter"))
            : discoveries.findIndex((d) => d.host === cur.discovered?.host && d.port === cur.discovered?.port);
        const mapped = cur.cloud !== undefined ? idx : idx >= 0 ? idx + (opts.allowNone === true ? 1 : 0) + (opts.useMainDefault !== undefined ? 1 : 0) : -1;
        if (mapped >= 0) initial = mapped;
        skipLabel = `Skip (keep: ${cur.model})`;
      }
      items.push({ value: "skip", label: skipLabel });
    } else if (opts.useMainDefault !== undefined) {
      const curFast = flow.answers.roles.fast;
      if (curFast !== undefined) {
        const idx =
          curFast.cloud !== undefined
            ? items.findIndex((it) => it.value === (curFast.cloud === "deepseek-official" ? "deepseek" : "openrouter"))
            : discoveries.findIndex((d) => d.host === curFast.discovered?.host && d.port === curFast.discovered?.port);
        if (idx >= 0) {
          initial = curFast.cloud !== undefined ? idx : idx + 1;
        }
      } else {
        initial = 0; // Use main
      }
    } else if (opts.allowNone === true) {
      initial = flow.answers.roles.vision === undefined ? 0 : undefined;
    }

    const src = await selectStep(`Role: ${label} (s skips)`, items, (i) => i, initial !== undefined ? { initial } : {});
    if (src === BACK || src === CANCEL) return src;
    const item = items[src] as SelectItem;
    if (item.value === "skip") return SKIP;
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
        { value: "skip", label: `Skip (keep: current)` },
      ], (i) => i);
      if (r === BACK || r === CANCEL) return r;
      return {};
    }
    // T35: Skip the whole keys step (keep current keys).
    const first = await selectStep("API keys needed for your choices.", [
      { value: "enter", label: "Enter API keys →" },
      { value: "skip", label: `Skip (keep: current)` },
    ], (i) => i);
    if (first === BACK || first === CANCEL) return first;
    if (first === 1) return {};
    const keys = { ...flow.answers.keys };
    for (const env of reqs) {
      const v = await lineStep(`Enter ${env} (input is hidden): `, true);
      if (v === BACK || v === CANCEL) return v;
      keys[env] = v.trim();
    }
    return { keys };
  }

  async function stepMode(): Promise<StepResult> {
    const cur = flow.answers.permissionMode;
    const m = await selectStep(
      "Default access mode (s skips)",
      [
        { value: "ask", label: "Ask: confirm every command and write" },
        { value: "auto", label: "Auto (recommended): kumo decides, risky actions still ask" },
        { value: "full", label: "Full access: never asks" },
        { value: "skip", label: `Skip (keep: ${cur})` },
      ],
      (i) => i,
      { initial: 1 },
    );
    if (m === BACK || m === CANCEL) return m;
    if (m === 3) return {};
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
    const curSearch = flow.answers.search.provider;
    const s = await selectStep(
      "Web search (a search needs an index of the web. Nothing is scraped for free) (s skips)",
      [
        { value: "none", label: "None (default)" },
        { value: "searxng", label: detected !== undefined ? `SearXNG: detected on ${detected}` : "SearXNG: self-hosted instance URL" },
        { value: "brave", label: "Brave Search: API key" },
        { value: "tavily", label: "Tavily: API key" },
        { value: "skip", label: `Skip (keep: ${curSearch})` },
      ],
      (i) => i,
    );
    if (s === BACK || s === CANCEL) return s;
    if (s === 4) return {};
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
    const keepLabel = saved !== undefined && saved.length > 0 ? saved.join(", ") : "current";
    const sel = await checkStep(`Skills: Space toggles, Enter continues, s skips (keep: ${keepLabel})`, items, checked);
    if (sel === BACK || sel === CANCEL) return sel;
    if (sel === SKIP) return {};
    skillsSubmitted = true;
    return { skills: (sel as number[]).map((i) => (items[i] as CheckItem).value) };
  }

  async function stepTheme(): Promise<StepResult> {
    const themes: Theme[] = ["dark", "light", "high-contrast"];
    const curTheme = flow.answers.theme;
    const preview = (index: number): Component => {
      const theme = (index < 3 ? themes[index] : curTheme) as Theme;
      const style = theme === "high-contrast" ? ansi.bold : theme === "light" ? (s: string) => `\x1b[30m${s}\x1b[39m` : ansi.gray;
      return new Text(
        style("  💭 thinking about the fix…\n  ● bash  pnpm test\n  12.3%/131k (auto)      (local) my-model • low"),
        1,
        0,
      );
    };
    const sel = await selectStep(
      "Theme (s skips)",
      [...themes.map((t) => ({ value: t, label: t })), { value: "skip", label: `Skip (keep: ${curTheme})` }],
      (i) => i,
      { livePreview: preview, initial: themes.indexOf(flow.answers.theme) },
    );
    if (sel === BACK || sel === CANCEL) return sel;
    if (sel === 3) return {};
    return { theme: themes[sel] as Theme };
  }

  async function stepTelemetry(): Promise<StepResult> {
    if (!updateCheckLoaded) {
      updateCheckLoaded = true;
      updateCheckChoice = readUpdateCheckChoice(await readKumoJsonDoc(dshHome)) ?? true;
    }
    const curTele = flow.answers.telemetry ? "yes" : "no";
    const sel = await selectStep("Share anonymous usage data with DeepSeek Harness? (s skips)", [
      { value: "no", label: "No (default)" },
      { value: "yes", label: "Yes" },
      { value: "skip", label: `Skip (keep: ${curTele})` },
    ], (i) => i, { initial: flow.answers.telemetry ? 1 : 0 });
    if (sel === BACK || sel === CANCEL) return sel;
    if (sel === 2) return {};
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
    if (!suggestionsLoaded) {
      suggestionsLoaded = true;
      try {
        const doc = (await readKumoJsonDoc(dshHome)) as { suggestions?: boolean };
        suggestionsChoice = doc.suggestions ?? true;
      } catch {
        suggestionsChoice = true;
      }
    }
    const sg = await selectStep(
      "Suggest the likely next prompt as dim ghost text in the empty editor?",
      [
        { value: "yes", label: "Yes (default)" },
        { value: "no", label: "No" },
      ],
      (i) => i,
      { initial: suggestionsChoice ? 0 : 1 },
    );
    if (sg === BACK || sg === CANCEL) return sg;
    suggestionsChoice = sg === 0;
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
      `  Suggestions ${suggestionsChoice ? "on" : "off"}`,
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
      // T28B: same merge for the suggestions toggle.
      await setSuggestionsChoice(dshHome, suggestionsChoice);
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
      // T35: a settings.yaml route stays current; keep its pretty names.
      const wasCurrent = existing.current === true;
      const prettyById = new Map(existing.modelInfos.map((m) => [m.id, m.name]));
      existing.models = h.models;
      existing.modelInfos = h.modelInfos.map((m) => ({
        ...m,
        ...(prettyById.get(m.id) !== undefined ? { name: prettyById.get(m.id) as string } : {}),
      }));
      // T34: a fresh probe's template view wins; a missing one keeps the last.
      if (h.template !== undefined) existing.template = h.template;
      if (wasCurrent) existing.current = true;
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
  return `${labels[step] ?? step}  (step ${String(order.indexOf(step) + 1)}/${String(order.length)})  ·  Esc back · Ctrl+C quit · s skip`;
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
