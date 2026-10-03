import { isAscii } from "../render/chars.js";
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
  isKeyRelease,
  matchesKey,
  type Component,
  type SelectItem,
  type Terminal,
  type TUI,
  type SelectListLayoutOptions,
} from "@earendil-works/pi-tui";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ansi, selectListTheme } from "../ui/theme.js";
import { withEscapeFilter } from "../ui/escape-filter.js";
import { typedText } from "../ui/keys.js";
import {
  SetupFlow,
  STEPS,
  type StepId,
  defaultAnswers,
  requiredKeyEnvs,
  roleFromModelRef,
  type PermissionModeValue,
  type RolePick,
  type SetupAnswers,
  type Theme,
} from "./flow.js";
import { SPACE_BUNNY_NOTICE, spaceBunnyPick } from "./spacebunny.js";
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
import { CenteredPanel, SetupFrame } from "./frame.js";
import { SetupCardPicker, SetupThemePicker, SetupWelcome, type SetupCardOption } from "./welcome.js";
import { CheckList, LineInput, SetupFilterList, SetupSummary, fitPlain, type CheckItem } from "./widgets.js";

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
 * Skills the setup pre-checks on a first run: the ones kumo ships (see THIRD_PARTY_NOTICES.md)
 * and the same names found on the computer, in whichever agent's folder. A found one is
 * linked from where it lives, never copied. `browser` is a user's own variant of the shipped
 * `playwright-cli`; either is pre-checked when it exists.
 */
export const RECOMMENDED_SKILLS: readonly string[] = [
  "browser",
  "playwright-cli",
  "impeccable",
  "make-interfaces-feel-better",
  "thermo-nuclear-code-quality-review",
  "youtube-transcript",
];

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
    } else if (RECOMMENDED_SKILLS.includes(item.value) || found.some((f) => f.name === item.value && f.source === "agents")) {
      checked.add(i);
    }
  });
  return checked;
}

/** ── the wizard ──────────────────────────────────────────────────── */

export async function runFullSetup(
  dshHome: string,
  opts: WizardOptions = {},
): Promise<"saved" | "simple" | "later" | "quit"> {
  const terminal = opts.terminal ?? withEscapeFilter(new ProcessTerminal());
  const tui: TUI = new TuiMainScreen(terminal);
  const root = new Container();
  const flow = new SetupFlow(opts.prefill ?? defaultAnswers());
  let status = "kumo setup";
  let keyHelp = "↑/↓ move  ·  Enter choose or continue  ·  Esc back  ·  Ctrl+C quit";
  let escapeStaysOnWelcome = false;
  let welcomeShowing = false;
  let frameShowing = false;
  let displayStep: StepId | undefined;
  const statusWidget: Component = {
    render: (width: number) => welcomeShowing || frameShowing ? [] : [
        ansi.gray(status.slice(0, Math.max(0, width - 2))),
        ansi.faint(fitPlain(keyHelp, width)),
      ],
    invalidate: () => {},
  };
  const panel = new CenteredPanel(root, () => terminal.rows, { maxWidth: 108, fullscreen: () => welcomeShowing });
  tui.addChild(panel);
  tui.addChild(statusWidget);

  let activeFocus: (Component & { clearFilter?: () => boolean }) | undefined;
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
  let welcome: SetupWelcome | undefined;
  tui.addInputListener((data: string) => {
    if (matchesKey(data, "ctrl+c")) {
      activeResolve?.(CANCEL);
      return { consume: true };
    }
    if (matchesKey(data, "escape")) {
      if (activeFocus?.clearFilter?.()) { tui.requestRender(); return { consume: true }; }
      if (escapeStaysOnWelcome) return { consume: true };
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
      panel.reset();
      const box = new Container();

      const built = build((v) => {
        activeResolve = null;
        resolveP(v);
      });
      for (const c of built.above ?? []) box.addChild(c);
      box.addChild(built.widget);
      for (const c of built.below ?? []) box.addChild(c);
      frameShowing = !welcomeShowing;
      if (frameShowing) {
        root.addChild(new SetupFrame(title || (displayStep === undefined ? "Kumo setup" : stepTitle(displayStep).split("  (step")[0]!), box, {
          ...(displayStep === undefined ? {} : { step: STEPS.indexOf(displayStep) + 1 }),
          help: keyHelp,
          rows: () => terminal.rows,
          onContentHeight: (rows, width) => {
            const extra = [...(built.above ?? []), ...(built.below ?? [])].reduce((n, c) => n + c.render(width).length, 0);
            (built.widget as Component & { setHeight?: (rows: number) => void }).setHeight?.(Math.max(1, rows - extra));
          },
          status: () => status === "kumo setup" || status === "Kumo setup" || (displayStep !== undefined && status === stepTitle(displayStep)) ? "" : status,
        }));
      } else root.addChild(box);
      activeFocus = built.focus;
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
      layout?: SelectListLayoutOptions;
      help?: string;
      filter?: boolean;
    } = {},
  ): Promise<Outcome<T>> => {
    keyHelp = opts.help ?? `${opts.filter ? "Type filter  ·  / search  ·  " : ""}↑/↓ move  ·  Enter select  ·  Esc back  ·  Ctrl+C quit`;
    return interactive<T>(title, (finish) => {
      const list = opts.filter ? new SetupFilterList(items, Math.min(items.length, 10), opts.layout) : new SelectList(items, Math.min(items.length, 10), selectListTheme, opts.layout);
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
          if (!isKeyRelease(data) && typedText(data).toLowerCase() === "s" && !(list instanceof SetupFilterList && list.filtering)) {
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
  };

  const cardStep = <T>(
    title: string,
    items: SetupCardOption[],
    map: (index: number) => T,
    options: { initial?: number; above?: Component; help?: string } = {},
  ): Promise<Outcome<T>> => {
    const skip = items.findIndex(item => item.value === "skip");
    keyHelp = options.help ?? `↑/↓ move  ·  Enter select${skip >= 0 ? "  ·  S keep current" : ""}  ·  Esc back  ·  Ctrl+C quit`;
    return interactive<T>(title, (finish) => {
      const picker = new SetupCardPicker(items, () => terminal.rows);
      if (options.initial !== undefined) picker.setSelectedIndex(options.initial);
      picker.onSelect = (index) => finish(map(index));
      const original = picker.handleInput.bind(picker);
      picker.handleInput = data => {
        if (!isKeyRelease(data) && skip >= 0 && typedText(data).toLowerCase() === "s") { finish(map(skip)); return; }
        original(data);
      };
      return { widget: picker, focus: picker, ...(options.above ? { above: [options.above] } : {}) };
    });
  };

  const lineStep = (prompt: string, secret = false): Promise<Outcome<string>> => {
    keyHelp = "Enter continue  ·  Backspace edit  ·  Esc back  ·  Ctrl+C quit";
    return interactive<string>("", (finish) => {
      const input = new LineInput(prompt, secret);
      input.onSubmit = (v) => finish(v);
      return { widget: input, focus: input };
    });
  };

  const checkStep = (
    title: string,
    items: CheckItem[],
    checked: Set<number>,
  ): Promise<Skippable<number[]>> =>
    (() => {
      keyHelp = "Type filter  ·  / search  ·  ↑/↓ move  ·  Space toggle  ·  Enter continue  ·  S skip  ·  Esc back";
      return interactive<number[] | typeof SKIP>(title, (finish) => {
      const cl = new CheckList(items, checked);
      cl.onDone = (idx) => finish(idx);
      // T35: `s` skips (keep current) — same as the Skip path in select steps.
      cl.onSkip = () => finish(SKIP);
      return { widget: cl, focus: cl };
      });
    })();

  // The setup wizard owns the terminal from the first frame. Clear any shell
  // output above it so the animated welcome is the only visible content.
  terminal.clearScreen();
  tui.start();
  try {
    return await drive();
  } finally {
    try {
      await terminal.drainInput(200, 30);
    } catch {
      // best effort
    }
    welcome?.stop();
    tui.stop();
  }

  async function drive(): Promise<"saved" | "simple" | "later" | "quit"> {
    const bundledRoot = opts.bundledSkillsRoot ?? bundledSkillsRoot();
    const bundled: SkillMeta[] = await readBundledSkills(bundledRoot);

    const showWelcome = async (): Promise<Outcome<true>> => {
      keyHelp = "Enter continue  ·  Ctrl+C quit";
      status = "Kumo setup";
      escapeStaysOnWelcome = true;
      welcomeShowing = true;
      displayStep = undefined;
      welcome = new SetupWelcome(() => terminal.rows);
      try {
        return await interactive<true>("", (finish) => {
          welcome!.onContinue = () => finish(true);
          welcome!.start(() => tui.requestRender());
          return { widget: welcome!, focus: welcome! };
        });
      } finally {
        escapeStaysOnWelcome = false;
        welcomeShowing = false;
        welcome?.stop();
      }
    };

    // Returning users start at the same branded entry point, then land in the
    // change-one-setting menu. Escape walks back through those screens.
    if (isExistingInstall(opts.prefill)) {
      for (;;) {
        const intro = await showWelcome();
        if (intro === CANCEL) return "quit";
        for (;;) {
          keyHelp = "↑/↓ move  ·  Enter select  ·  Esc back  ·  Ctrl+C quit";
          const choice = await cardStep<"settings" | "later">(
            "Welcome back",
            [
              { value: "settings", label: "Review your setup", description: "Update models, tools, permissions, or appearance.", recommended: true },
              { value: "later", label: "Set up later", description: "Return to the terminal without changing anything." },
            ],
            (i) => i === 0 ? "settings" : "later",
          );
          if (choice === BACK) break;
          if (choice === CANCEL) return "quit";
          if (choice === "later") return "later";
          const result = await driveMenu(bundledRoot, bundled);
          if (result === "back") continue;
          return result;
        }
      }
    }

    // Esc at the first model step returns to the setup choice screen instead
    // of silently closing the wizard.
    for (;;) {
      const intro = await showWelcome();
      if (intro === CANCEL) return "quit";
      keyHelp = "↑/↓ move  ·  Enter select  ·  Esc back  ·  Ctrl+C quit";
      const entry = await cardStep<"simple" | "full" | "later">(
        "Choose your setup",
        [
          { value: "simple", label: "Quick setup", description: "Recommended · get started with a few guided choices.", recommended: true },
          { value: "full", label: "Customize setup", description: "Choose models, access, search, tools, and appearance." },
          { value: "later", label: "Set up later", description: "Leave everything unchanged. Run kumo setup when you’re ready." },
        ],
        (i) => i === 0 ? "simple" : i === 1 ? "full" : "later",
      );
      if (entry === BACK) continue;
      if (entry === CANCEL) return "quit";
      if (entry === "later") return "later";
      if (entry === "simple") {
        tui.stop();
        await simpleSetup(dshHome, setupIO());
        return "simple";
      }

      let returnToEntry = false;
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
          continue;
        }
        if (result === "saved") return "saved";
        if (result === CANCEL) {
          flow.cancel();
          return "quit";
        }
        if (result === BACK) {
          if (!flow.back()) {
            returnToEntry = true;
            break;
          }
          status = stepTitle(flow.step);
          continue;
        }
        try {
          flow.submit(result as Partial<SetupAnswers>);
        } catch (err) {
          // A missing answer (no main model, a key left empty) is said on the step, which
          // stays: it must never end the whole setup and lose what was already chosen.
          setStatus(`! ${(err as Error).message}`);
          await sleep(1800);
          setStatus(stepTitle(step));
          continue;
        }
        status = stepTitle(flow.step);
      }
      if (!returnToEntry) return "quit";
    }
  }

  /** T35 existing-install menu: change one thing, Save writes once. */
  async function driveMenu(bundledRoot: string, bundled: SkillMeta[]): Promise<"saved" | "simple" | "later" | "quit" | "back"> {
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
    status = "Kumo setup";
    keyHelp = "↑/↓ move  ·  Enter open  ·  Esc back  ·  Ctrl+C quit";
    for (;;) {
      displayStep = undefined;
      const pick = await selectStep(
        "Kumo setup",
        [
          { value: "models", label: "Models" },
          { value: "mode", label: "Access mode" },
          { value: "search", label: "Web search" },
          { value: "skills", label: "Skills" },
          { value: "theme", label: "Theme" },
          { value: "telemetry", label: "Usage and privacy" },
          { value: "save", label: "Save changes and exit" },
          { value: "quit", label: "Exit without saving" },
        ],
        (i) => i,
        {
          above: {
            render: (width) => [ansi.gray(fitPlain("Choose a setting to edit. Changes stay pending until you save.", width))],
            invalidate: () => {},
          },
          livePreview: (index) => {
            const names = ["Models", "Access mode", "Web search", "Skills", "Theme", "Usage and privacy"];
            const values = [
              modelsMenuValue(),
              modeMenuValue(),
              flow.answers.search.provider,
              skillsMenuValue(),
              flow.answers.theme,
              telemetryMenuValue(),
            ];
            const value = index < 6 ? `Current ${names[index]}: ${values[index]}` : "";
            return {
              render: (width) => value === "" ? [] : [ansi.gray(fitPlain(value, width))],
              invalidate: () => {},
            };
          },
          layout: { minPrimaryColumnWidth: 24, maxPrimaryColumnWidth: 24 },
          help: "↑/↓ move  ·  Enter open  ·  Esc back  ·  Ctrl+C quit",
        },
      );
      if (pick === BACK) return "back";
      if (pick === CANCEL) {
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
          status = "Kumo setup";
          keyHelp = "↑/↓ move  ·  Enter open  ·  Esc back  ·  Ctrl+C quit";
          continue;
        }
      }
      if (pick === 7) {
        flow.cancel();
        return "later";
      }
      try {
        const done = await runMenuStep(pick as number, bundled);
        if (done === CANCEL) {
          flow.cancel();
          return "quit";
        }
        // BACK from a single step = back to menu, discarding nothing (apply
        // already merged only on success; BACK merges nothing).
        status = "Kumo setup";
        keyHelp = "↑/↓ move  ·  Enter open  ·  Esc back  ·  Ctrl+C quit";
      } catch (err) {
        setStatus(`! ${(err as Error).message}. Try again`);
        await sleep(1400);
        status = "Kumo setup";
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
    displayStep = "models";
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
        { filter: true },
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
    displayStep = "roles";
    const roles: SetupAnswers["roles"] = {};
    // A first setup, with nothing chosen yet, offers the free model once as a yes or no. It is
    // never preselected: the answer decides where the user's code goes.
    let main: Skippable<RolePick | undefined> | undefined;
    if (flow.answers.roles.main === undefined) {
      const answer = await selectStep(
        "Free model (you can still change it later)",
        [
          { value: "no", label: "No, I will choose my own model" },
          { value: "yes", label: "Yes, use Space Bunny Free" },
        ],
        (i) => i,
        { initial: 0, above: new Text(SPACE_BUNNY_NOTICE.split("\n").map((line, i) => (i === 0 ? line : ansi.gray(line))).join("\n"), 0, 0) },
      );
      if (answer === BACK || answer === CANCEL) return answer;
      if (answer === 1) main = spaceBunnyPick();
    }
    main ??= await askRole("main", { required: true });
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
        items.push({ value: "skip", label: skipLabel });
      }
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

    const hasSkip = items[items.length - 1]?.value === "skip";
    const src = await selectStep(`Role: ${label}${hasSkip ? " (s skips)" : ""}`, items, (i) => i, { filter: true, ...(initial !== undefined ? { initial } : {}) });
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
      const ms = await selectStep(`Main model on ${d.baseUrl}`, modelItems, (i) => i, { filter: true });
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
    displayStep = "keys";
    const reqs = requiredKeyEnvs(flow.answers);
    if (reqs.length === 0) {
      const r = await selectStep("No API keys needed for your choices.", [{ value: "go", label: "Continue →" }], (i) => i);
      if (r === BACK || r === CANCEL) return r;
      return {};
    }
    const have = (env: string): boolean => (flow.answers.keys[env] ?? "").trim() !== "";
    let ask = reqs.filter((env) => !have(env));
    if (ask.length === 0) {
      // Every key is already in the home's .env: keep them, or type new ones.
      const first = await selectStep("API keys are already saved for your choices.", [
        { value: "keep", label: "Keep my saved keys →" },
        { value: "change", label: "Enter new keys" },
      ], (i) => i);
      if (first === BACK || first === CANCEL) return first;
      if (first === 0) return {};
      ask = reqs;
    }
    const keys = { ...flow.answers.keys };
    for (const env of ask) {
      const v = await lineStep(`Enter ${env} (input is hidden): `, true);
      if (v === BACK || v === CANCEL) return v;
      keys[env] = v.trim();
    }
    return { keys };
  }

  async function stepMode(): Promise<StepResult> {
    displayStep = "mode";
    const cur = flow.answers.permissionMode;
    const m = await cardStep(
      "Default access mode (s skips)",
      [
        { value: "ask", label: "Ask", description: "Confirm every command and write." },
        { value: "auto", label: isAscii() ? "Auto *" : "Auto ★", description: "Kumo decides; risky actions still ask.", recommended: true },
        { value: "full", label: "Full access", description: "Commands and writes run without asking." },
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
    displayStep = "search";
    setStatus("checking for a local SearXNG…");
    const detected = await detectSearxng(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {});
    setStatus(stepTitle("search"));
    const curSearch = flow.answers.search.provider;
    const s = await cardStep(
      "Web search (s skips)",
      [
        { value: "none", label: "None", description: "Keep web search disabled (default)." },
        { value: "searxng", label: "SearXNG", description: detected !== undefined ? `Detected on ${detected}` : "Connect your self-hosted instance URL." },
        { value: "brave", label: "Brave Search", description: "Connect using a Brave Search API key." },
        { value: "tavily", label: "Tavily", description: "Connect using a Tavily API key." },
        { value: "skip", label: `Skip (keep: ${curSearch})` },
      ],
      (i) => i,
      { above: new Text(ansi.gray("A search needs an index of the web. Nothing is scraped for free."), 0, 0) },
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
    displayStep = "skills";
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
    const sel = await checkStep(
      saved !== undefined && saved.length > 0
        ? `Skills: Space toggles, Enter continues, s skips (keeps ${String(saved.length)} enabled)`
        : "Skills: Space toggles, Enter continues, s skips (enables none)",
      items,
      checked,
    );
    if (sel === BACK || sel === CANCEL) return sel;
    if (sel === SKIP) return {};
    skillsSubmitted = true;
    return { skills: (sel as number[]).map((i) => (items[i] as CheckItem).value) };
  }

  async function stepTheme(): Promise<StepResult> {
    displayStep = "theme";
    keyHelp = "↑/↓ preview  ·  Enter use theme  ·  S keep current  ·  Esc back";
    const sel = await interactive<Theme | "skip">("", (finish) => {
      const picker = new SetupThemePicker(flow.answers.theme);
      picker.onSelect = (theme) => finish(theme);
      picker.onSkip = () => finish("skip");
      return { widget: picker, focus: picker };
    });
    if (sel === BACK || sel === CANCEL) return sel;
    if (sel === "skip") return {};
    return { theme: sel };
  }

  async function stepTelemetry(): Promise<StepResult> {
    displayStep = "telemetry";
    if (!updateCheckLoaded) {
      updateCheckLoaded = true;
      updateCheckChoice = readUpdateCheckChoice(await readKumoJsonDoc(dshHome)) ?? true;
    }
    const curTele = flow.answers.telemetry ? "yes" : "no";
    const sel = await cardStep("Share anonymous usage data with DeepSeek Harness? (s skips)", [
      { value: "no", label: "No", description: "Do not share anonymous usage data (default)." },
      { value: "yes", label: "Yes", description: "Share anonymous usage data with DeepSeek Harness." },
      { value: "skip", label: `Skip (keep: ${curTele})` },
    ], (i) => i, { initial: flow.answers.telemetry ? 1 : 0, above: new Text(ansi.gray("Usage data · 1/3"), 0, 0) });
    if (sel === BACK || sel === CANCEL) return sel;
    if (sel === 2) return {};
    const u = await cardStep(
      "Check npm once a day for a newer kumo and note it at startup? (nothing is sent but the version query)",
      [
        { value: "yes", label: "Yes", description: "Check npm daily and show available updates at startup.", recommended: true },
        { value: "no", label: "No", description: "Keep automatic update checks disabled." },
      ],
      (i) => i,
      { initial: updateCheckChoice ? 0 : 1, above: new Text(ansi.gray("Updates · 2/3"), 0, 0) },
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
    const sg = await cardStep(
      "Suggest the likely next prompt as dim ghost text in the empty editor?",
      [
        { value: "yes", label: "Yes", description: "Show a suggested next prompt in the empty editor (default)." },
        { value: "no", label: "No", description: "Keep next-prompt suggestions disabled." },
      ],
      (i) => i,
      { initial: suggestionsChoice ? 0 : 1, above: new Text(ansi.gray("Suggestions · 3/3"), 0, 0) },
    );
    if (sg === BACK || sg === CANCEL) return sg;
    suggestionsChoice = sg === 0;
    return { telemetry: sel === 1 };
  }

  async function stepSummary(bundledRoot: string, bundled: SkillMeta[]): Promise<StepResult> {
    displayStep = "summary";
    flow.buildPlan({ dshHome, bundledSkillsRoot: bundledRoot, bundledSkills: bundled });
    const a = flow.answers;
    const ref = (r: RolePick | undefined): string =>
      r === undefined ? "none" : `${r.cloud ?? r.discovered?.baseUrl ?? "?"} · ${r.model}`;
    const shown = new SetupSummary([
      { label: "Main", value: ref(a.roles.main) },
      { label: "Fast", value: `${ref(a.roles.fast ?? a.roles.main)}${a.roles.fast === undefined ? " (default = main)" : ""}` },
      { label: "Vision", value: ref(a.roles.vision) },
      { label: "Access", value: a.permissionMode },
      { label: "Search", value: a.search.provider },
      { label: "Skills", value: a.skills.length ? a.skills.join(", ") : "none" },
      { label: "Theme", value: a.theme },
      { label: "Telemetry", value: a.telemetry ? "yes" : "no" },
      { label: "Updates", value: updateCheckChoice ? "daily check on" : "check off" },
      { label: "Suggestions", value: suggestionsChoice ? "on" : "off" },
    ], dshHome);
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
