/**
 * The full-setup flow (T21) as a pure state machine: the UI (full.ts) drives
 * it step by step; nothing touches the disk until the summary screen calls
 * commitPlan(). Esc = back(), ctrl+c = cancel() — a canceled flow can never
 * commit.
 */
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  renderSettingsYaml,
  writeEnvVar,
  reasoningSettingsFor,
  type SettingsDoc,
  type SearchChoice,
} from "./simple.js";
import { syncSkills, type SkillMeta } from "./skills.js";
import type { Discovered, TemplateCaps } from "./discover.js";

export type PermissionModeValue = "ask" | "auto" | "full";
export type Theme = "dark" | "light" | "high-contrast";

export const STEPS = [
  "models",
  "roles",
  "keys",
  "mode",
  "search",
  "skills",
  "theme",
  "telemetry",
  "summary",
] as const;
export type StepId = (typeof STEPS)[number];

export interface RolePick {
  /** A discovered server (localhost / network / tailscale / manual). */
  discovered?: Discovered;
  /** Or a cloud route handled by dsh-base / the openrouter route. */
  cloud?: "deepseek-official" | "openrouter";
  model: string;
  /**
   * Served context window, from the SERVER (`meta.n_ctx` / `/props`) or typed
   * by the user when the server does not say. Never the training size.
   */
  contextWindow?: number;
}

/** Rebuild a RolePick from a kumo.json model ref (prefill for `kumo setup`). */
export function roleFromModelRef(ref: {
  provider: string;
  model: string;
  baseUrl?: string;
  contextWindow?: number;
  /** T34: template switches captured at the last setup. */
  template?: TemplateCaps;
}): RolePick | undefined {
  if (ref.provider === "deepseek-official") return { cloud: "deepseek-official", model: ref.model };
  if (ref.provider === "openrouter") return { cloud: "openrouter", model: ref.model };
  if (typeof ref.baseUrl === "string" && ref.baseUrl !== "") {
    const u = new URL(ref.baseUrl);
    const port = Number(u.port) || (u.protocol === "https:" ? 443 : 80);
    return {
      discovered: {
        source: "manual",
        host: u.hostname,
        port,
        baseUrl: ref.baseUrl,
        models: [ref.model],
        modelInfos: [{ id: ref.model, contextWindow: ref.contextWindow }],
        ...(ref.template !== undefined ? { template: ref.template } : {}),
      },
      model: ref.model,
      ...(ref.contextWindow !== undefined ? { contextWindow: ref.contextWindow } : {}),
    };
  }
  return undefined;
}

export interface SetupAnswers {
  discoveries: Discovered[];
  roles: { main?: RolePick; fast?: RolePick; vision?: RolePick };
  /** ENV name → secret value (T21.3, stored in $DSH_HOME/.env). */
  keys: Record<string, string>;
  permissionMode: PermissionModeValue;
  search: SearchChoice;
  skills: string[];
  theme: Theme;
  telemetry: boolean;
  /**
   * T35: the parsed settings.yaml the prefill came from (source of truth).
   * Kept verbatim so Save without changes round-trips compat /
   * reasoningEfforts / contextWindow / name / displayName untouched.
   * Never set by wizard steps — only by loadPrefill.
   */
  settingsOrig?: SettingsDoc;
  /**
   * T35: the parsed kumo.json the prefill came from (for model-ref
   * preservation: name / missing baseUrl / etc stay untouched when the
   * route did not change). Never set by wizard steps.
   */
  kumoOrig?: Record<string, unknown>;
}

export function defaultAnswers(): SetupAnswers {
  return {
    discoveries: [],
    roles: {},
    keys: {},
    permissionMode: "auto", // T31: Auto is the default; must match modes.ts readDefaultMode
    search: { provider: "none" },
    skills: [],
    theme: "dark",
    telemetry: false,
  };
}

const CLOUD_KEY_ENV: Record<"deepseek-official" | "openrouter", string> = {
  "deepseek-official": "DEEPSEEK_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

/** Env names whose keys are required by the chosen cloud roles. */
export function requiredKeyEnvs(answers: SetupAnswers): string[] {
  const envs = new Set<string>();
  for (const role of [answers.roles.main, answers.roles.fast, answers.roles.vision]) {
    if (role?.cloud !== undefined) envs.add(CLOUD_KEY_ENV[role.cloud]);
  }
  return [...envs];
}

/** Does any chosen role run on a discovered server (→ local dummy key)? */
function usesLocalServer(answers: SetupAnswers): boolean {
  return [answers.roles.main, answers.roles.fast, answers.roles.vision].some(
    (r) => r?.discovered !== undefined,
  );
}

export class SetupFlow {
  #answers: SetupAnswers;
  #index = 0;
  canceled = false;

  constructor(answers: SetupAnswers = defaultAnswers()) {
    this.#answers = answers;
  }

  get answers(): SetupAnswers {
    return this.#answers;
  }

  get index(): number {
    return this.#index;
  }

  get step(): StepId {
    return STEPS[this.#index] as StepId;
  }

  get atSummary(): boolean {
    return this.#index === STEPS.length - 1;
  }

  /** Validation errors for the current step; empty array = valid. */
  validate(step: StepId = this.step): string[] {
    const a = this.#answers;
    const errors: string[] = [];
    switch (step) {
      case "models":
        break;
      case "roles":
        if (a.roles.main === undefined) errors.push("Pick a main model.");
        for (const [name, pick] of [
          ["main", a.roles.main],
          ["fast", a.roles.fast],
          ["vision", a.roles.vision],
        ] as const) {
          if (pick !== undefined && pick.model.trim() === "") errors.push(`Role ${name}: model required.`);
        }
        break;
      case "keys":
        for (const env of requiredKeyEnvs(a)) {
          const v = a.keys[env];
          if (v === undefined || v.trim() === "") errors.push(`${env} is required for the chosen cloud model.`);
        }
        break;
      default:
        break;
    }
    return errors;
  }

  /** Merge the step's result and move forward. Throws on validation error. */
  submit(patch: Partial<SetupAnswers>): void {
    const errors = this.#applyAndValidate(patch);
    if (errors.length > 0) throw new Error(errors.join(" "));
    if (this.#index < STEPS.length - 1) this.#index += 1;
  }

  /** Go back one step keeping every answer. False at the first step. */
  back(): boolean {
    if (this.#index === 0) return false;
    this.#index -= 1;
    return true;
  }

  /**
   * T35 menu: merge one step's result without moving the index.
   * Validation is deferred to saveFromMenu (roles must still be valid).
   * settingsOrig / kumoOrig are never overwritten by step patches.
   */
  apply(patch: Partial<SetupAnswers>): void {
    const { settingsOrig, kumoOrig } = this.#answers;
    this.#answers = { ...this.#answers, ...patch };
    if (settingsOrig !== undefined) this.#answers.settingsOrig = settingsOrig;
    if (kumoOrig !== undefined) this.#answers.kumoOrig = kumoOrig;
  }

  cancel(): void {
    this.canceled = true;
  }

  /** Summary-screen Save: the only path that writes, blocked after cancel. */
  async save(opts: {
    dshHome: string;
    bundledSkillsRoot: string;
    bundledSkills: SkillMeta[];
  }): Promise<void> {
    if (this.canceled) throw new Error("setup was canceled. Nothing was written");
    if (!this.atSummary) throw new Error("save is only available on the summary step");
    if (this.validate("roles").length > 0) throw new Error("no main role");
    await commitPlan(opts.dshHome, this.buildPlan(opts));
  }

  /**
   * T35 menu Save and exit: writes once, atomically, from any index.
   * Same guards as save() except the summary position (menu has no linear index).
   */
  async saveFromMenu(opts: {
    dshHome: string;
    bundledSkillsRoot: string;
    bundledSkills: SkillMeta[];
  }): Promise<void> {
    if (this.canceled) throw new Error("setup was canceled. Nothing was written");
    if (this.validate("roles").length > 0) throw new Error("no main role");
    await commitPlan(opts.dshHome, this.buildPlan(opts));
  }

  #applyAndValidate(patch: Partial<SetupAnswers>): string[] {
    const before = JSON.stringify(this.#answers);
    this.#answers = { ...this.#answers, ...patch };
    const errors = this.validate();
    if (errors.length > 0) this.#answers = JSON.parse(before) as SetupAnswers;
    return errors;
  }

  /** The files the summary screen would write; pure. */
  buildPlan(opts: { dshHome: string; bundledSkillsRoot: string; bundledSkills: SkillMeta[] }): SetupPlan {
    const a = this.#answers;
    if (a.roles.main === undefined) throw new Error("no main role");
    const fast = a.roles.fast ?? a.roles.main; // T21.2: fast defaults to main

    // T35: original providers by baseURL (settings.yaml source of truth).
    // Unchanged routes keep displayName/api/apiKeyEnv + every model entry
    // (name, contextWindow, compat, reasoningEfforts) verbatim.
    const origDoc = a.settingsOrig as Record<string, any> | undefined;
    const origProviders = (origDoc?.["llm-pi-ai"] as any)?.providers as Record<string, any> | undefined;
    const origByBaseUrl = new Map<string, string>();
    const origNames = new Set<string>();
    if (origProviders !== undefined) {
      for (const [pName, pConf] of Object.entries(origProviders)) {
        origNames.add(pName);
        if (pConf !== null && typeof pConf === "object" && typeof (pConf as any).baseURL === "string") {
          const bu = (pConf as any).baseURL as string;
          if (!origByBaseUrl.has(bu)) origByBaseUrl.set(bu, pName);
        }
      }
    }
    const origModelByProviderAndId = (providerName: string, id: string): any | undefined => {
      const p = origProviders?.[providerName];
      const models = (p as any)?.models;
      if (!Array.isArray(models)) return undefined;
      return models.find((m: any) => m !== null && typeof m === "object" && (m as any).id === id);
    };

    // Route names for discovered servers, in role order: local, local-2, …
    // T35: reuse the original provider name when the baseURL matches, so
    // agent-default-model and round-trips stay identical.
    const routeName = new Map<string, string>();
    const providers: Record<string, unknown> = {};
    const deepCopy = (v: unknown): unknown => JSON.parse(JSON.stringify(v));
    type ModelRef = {
      provider: string;
      model: string;
      baseUrl?: string;
      contextWindow?: number;
      /** T34: the chat-template switches the route serves (round-tripped). */
      template?: TemplateCaps;
    };
    const modelFor = (pick: RolePick | undefined): ModelRef | undefined => {
      if (pick === undefined) return undefined;
      if (pick.cloud !== undefined) return { provider: pick.cloud, model: pick.model };
      const d = pick.discovered;
      if (d === undefined) return undefined;
      const key = `${d.host}:${String(d.port)}`;
      let name = routeName.get(key);
      if (name === undefined) {
        const origName = origByBaseUrl.get(d.baseUrl);
        if (origName !== undefined) {
          name = origName;
        } else {
          // Fresh route: local, local-2, … avoiding original names.
          if (routeName.size === 0 && !origNames.has("local")) {
            name = "local";
          } else {
            let n = routeName.size + 1;
            if (n === 1) n = 2;
            let candidate = `local-${String(n)}`;
            while (origNames.has(candidate) || [...routeName.values()].includes(candidate)) {
              n += 1;
              candidate = `local-${String(n)}`;
            }
            name = candidate;
          }
        }
        routeName.set(key, name);
        const origConf = origProviders?.[name];
        if (origConf !== undefined && origConf !== null && typeof origConf === "object") {
          providers[name] = {
            ...(deepCopy(origConf) as Record<string, unknown>),
            baseURL: d.baseUrl,
            models: [],
          };
        } else {
          providers[name] = {
            displayName: `Kumo server ${key}`,
            api: "openai-completions",
            baseURL: d.baseUrl,
            apiKeyEnv: "KUMO_LOCAL_API_KEY",
            // T19.A.2: an `off` effort so the Auto judge can get a plain answer.
            models: [],
          };
        }
      }
      const entry = providers[name] as { models: unknown[] };
      if (!entry.models.some((m) => (m as { id: string }).id === pick.model)) {
        const preserved = origModelByProviderAndId(name, pick.model);
        if (preserved !== undefined) {
          entry.models.push(deepCopy(preserved));
        } else {
          const advertised = d.modelInfos?.find((m) => m.id === pick.model)?.contextWindow;
          const contextWindow = pick.contextWindow ?? advertised;
          // T34: a llama.cpp chat template detected in setup drives the compat
          // block; anything else keeps the T19 minimum (off + low) so the Auto
          // judge can still ask for a plain answer.
          const reasoning =
            d.template !== undefined
              ? reasoningSettingsFor(d.template)
              : { reasoningEfforts: { off: null, low: "low" } as Record<string, string | null> };
          entry.models.push({
            id: pick.model,
            name: pick.model,
            ...(contextWindow !== undefined ? { contextWindow } : {}),
            ...(reasoning.compat !== undefined ? { compat: reasoning.compat } : {}),
            reasoningEfforts: reasoning.reasoningEfforts,
          });
        }
      }
      const fresh: ModelRef = {
        provider: name,
        model: pick.model,
        baseUrl: d.baseUrl,
        ...(d.template !== undefined ? { template: d.template } : {}),
        ...(pick.contextWindow !== undefined
          ? { contextWindow: pick.contextWindow }
          : d.modelInfos?.find((m) => m.id === pick.model)?.contextWindow !== undefined
            ? { contextWindow: d.modelInfos.find((m) => m.id === pick.model)?.contextWindow }
            : {}),
      };
      return fresh;
    };

    const mainFresh = modelFor(a.roles.main)!;
    const fastFresh = modelFor(fast)!;
    const visionFresh = modelFor(a.roles.vision);
    const kumoModelsOrig = a.kumoOrig?.models as Record<string, any> | undefined;
    const reuseForRole = (role: string, freshRef: ModelRef): ModelRef => {
      const o = kumoModelsOrig?.[role];
      if (o !== null && typeof o === "object" && (o as any).provider === freshRef.provider && (o as any).model === freshRef.model) {
        return deepCopy(o) as ModelRef;
      }
      return freshRef;
    };
    // fast defaulting to main: when the user did not pick a separate fast and
    // the saved home also defaults (no fast, or fast == main), keep main's ref.
    let main: ModelRef;
    let fastRef: ModelRef;
    let visionRef: ModelRef | undefined;
    {
      const mainIsDefaultFast = a.roles.fast === undefined;
      const origFastMissingOrSame =
        kumoModelsOrig?.fast === undefined ||
        (kumoModelsOrig?.main !== undefined &&
          (kumoModelsOrig.fast as any)?.provider === (kumoModelsOrig.main as any)?.provider &&
          (kumoModelsOrig.fast as any)?.model === (kumoModelsOrig.main as any)?.model);
      main = reuseForRole("main", mainFresh);
      if (mainIsDefaultFast && origFastMissingOrSame && kumoModelsOrig !== undefined) {
        // Keep fast identical to main (as the saved home does).
        fastRef = main.provider === (kumoModelsOrig.main as any)?.provider && main.model === (kumoModelsOrig.main as any)?.model
          ? (deepCopy(kumoModelsOrig.fast ?? kumoModelsOrig.main) as ModelRef)
          : reuseForRole("fast", fastFresh);
        if (kumoModelsOrig.fast === undefined) fastRef = main;
      } else {
        fastRef = reuseForRole("fast", fastFresh);
      }
      visionRef = visionFresh !== undefined ? reuseForRole("vision", visionFresh) : undefined;
    }

    if (a.roles.main?.cloud === "openrouter" || a.roles.fast?.cloud === "openrouter" || a.roles.vision?.cloud === "openrouter") {
      const origOpenRouter = origProviders?.openrouter;
      providers.openrouter =
        origOpenRouter !== undefined && origOpenRouter !== null && typeof origOpenRouter === "object"
          ? deepCopy(origOpenRouter)
          : { apiKeyEnv: "OPENROUTER_API_KEY" };
    }

    const doc: SettingsDoc = { ...(origDoc ?? {}) };
    if (Object.keys(providers).length > 0) {
      doc["llm-pi-ai"] = { providers };
    } else {
      delete doc["llm-pi-ai"];
    }
    doc["agent-default-model"] = { provider: main.provider, model: main.model };
    // dsh's ui-theme registry only accepts light/dark/system (T21.7 note):
    // high-contrast is kumo's own setting and maps to dark for dsh surfaces.
    // T35: an original without ui-theme stays without it when the effective
    // preference is dark (implicit default) so Save-without-changes round-trips.
    // Fresh installs (no original) always write it, as before.
    {
      const pref = a.theme === "high-contrast" ? "dark" : a.theme;
      if (origDoc === undefined) {
        doc["ui-theme"] = { preference: pref };
      } else {
        const hadUi = Object.prototype.hasOwnProperty.call(origDoc, "ui-theme");
        if (hadUi) {
          doc["ui-theme"] = { preference: pref };
        } else if (pref !== "dark") {
          doc["ui-theme"] = { preference: pref };
        } else {
          delete doc["ui-theme"];
        }
      }
    }

    const env: Array<[string, string]> = [];
    if (usesLocalServer(a)) env.push(["KUMO_LOCAL_API_KEY", "local"]);
    for (const [name, value] of Object.entries(a.keys)) {
      if (value.trim() !== "") env.push([name, value.trim()]);
    }

    const kumoJson = JSON.stringify(
      {
        mode: "full",
        models: {
          main,
          fast: fastRef,
          ...(visionRef !== undefined ? { vision: visionRef } : {}),
        },
        access: a.permissionMode,
        permissionMode: a.permissionMode,
        browser: "off",
        memory: false,
        skills: a.skills,
        theme: a.theme,
        locale: "en",
        search: a.search,
        telemetry: a.telemetry,
      },
      null,
      2,
    );

    return {
      settingsYaml: renderSettingsYaml(doc),
      kumoJson: `${kumoJson}\n`,
      env,
      skills: {
        homeSkillsDir: join(opts.dshHome, "skills"),
        bundledRoot: opts.bundledSkillsRoot,
        chosen: a.skills,
      },
    };
  }
}

export interface SetupPlan {
  settingsYaml: string;
  kumoJson: string;
  env: Array<[string, string]>;
  skills: { homeSkillsDir: string; bundledRoot: string; chosen: string[] };
}

/** Writes the plan: settings.yaml + kumo.json atomically, .env merged, skills synced. */
export async function commitPlan(dshHome: string, plan: SetupPlan): Promise<void> {
  if (plan.env.some(([name]) => name === undefined)) throw new Error("bad env entry");
  await writeAtom(join(dshHome, "settings.yaml"), plan.settingsYaml, 0o600);
  // T34: per-model effort levels are runtime state (kumo-effort owns them);
  // a wizard Save rewrites kumo.json but must not forget the user's choices.
  let kumoJson = plan.kumoJson;
  try {
    const previous = JSON.parse(await readFile(join(dshHome, "kumo.json"), "utf8")) as Record<string, unknown>;
    if (previous.reasoningEffort !== undefined) {
      const doc = JSON.parse(kumoJson) as Record<string, unknown>;
      doc.reasoningEffort = previous.reasoningEffort;
      kumoJson = `${JSON.stringify(doc, null, 2)}\n`;
    }
  } catch {
    // no previous kumo.json: write the plan as-is
  }
  await writeAtom(join(dshHome, "kumo.json"), kumoJson, 0o600);
  for (const [name, value] of plan.env) {
    await writeEnvVar(join(dshHome, ".env"), name, value);
  }
  await syncSkills(plan.skills);
}

async function writeAtom(path: string, content: string, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, content, { encoding: "utf8", mode });
  await chmod(tmp, mode);
  await rename(tmp, path);
}
