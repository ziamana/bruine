/**
 * The full-setup flow (T21) as a pure state machine: the UI (full.ts) drives
 * it step by step; nothing touches the disk until the summary screen calls
 * commitPlan(). Esc = back(), ctrl+c = cancel() — a canceled flow can never
 * commit.
 */
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  renderSettingsYaml,
  writeEnvVar,
  type SettingsDoc,
  type SearchChoice,
} from "./simple.js";
import { syncSkills, type SkillMeta } from "./skills.js";
import type { Discovered } from "./discover.js";

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
}

export function defaultAnswers(): SetupAnswers {
  return {
    discoveries: [],
    roles: {},
    keys: {},
    permissionMode: "ask",
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

    // Route names for discovered servers, in role order: local, local-2, …
    const routeName = new Map<string, string>();
    const providers: Record<string, unknown> = {};
    type ModelRef = { provider: string; model: string; baseUrl?: string; contextWindow?: number };
    const modelFor = (pick: RolePick | undefined): ModelRef | undefined => {
      if (pick === undefined) return undefined;
      if (pick.cloud !== undefined) return { provider: pick.cloud, model: pick.model };
      const d = pick.discovered;
      if (d === undefined) return undefined;
      const key = `${d.host}:${String(d.port)}`;
      let name = routeName.get(key);
      if (name === undefined) {
        name = routeName.size === 0 ? "local" : `local-${String(routeName.size + 1)}`;
        routeName.set(key, name);
        providers[name] = {
          displayName: `Kumo server ${key}`,
          api: "openai-completions",
          baseURL: d.baseUrl,
          apiKeyEnv: "KUMO_LOCAL_API_KEY",
          // T19.A.2: an `off` effort so the Auto judge can get a plain answer.
          models: [],
        };
      }
      const entry = providers[name] as { models: unknown[] };
      if (!entry.models.some((m) => (m as { id: string }).id === pick.model)) {
        const advertised = d.modelInfos?.find((m) => m.id === pick.model)?.contextWindow;
        const contextWindow = pick.contextWindow ?? advertised;
        entry.models.push({
          id: pick.model,
          name: pick.model,
          ...(contextWindow !== undefined ? { contextWindow } : {}),
          reasoningEfforts: { off: null, low: "low" },
        });
      }
      return {
        provider: name,
        model: pick.model,
        baseUrl: d.baseUrl,
        ...(pick.contextWindow !== undefined
          ? { contextWindow: pick.contextWindow }
          : d.modelInfos?.find((m) => m.id === pick.model)?.contextWindow !== undefined
            ? { contextWindow: d.modelInfos.find((m) => m.id === pick.model)?.contextWindow }
            : {}),
      };
    };

    const main = modelFor(a.roles.main)!;
    const fastRef = modelFor(fast)!;
    const visionRef = modelFor(a.roles.vision);

    if (a.roles.main?.cloud === "openrouter" || a.roles.fast?.cloud === "openrouter" || a.roles.vision?.cloud === "openrouter") {
      providers.openrouter = { apiKeyEnv: "OPENROUTER_API_KEY" };
    }

    const doc: SettingsDoc = {};
    if (Object.keys(providers).length > 0) {
      doc["llm-pi-ai"] = { providers };
    }
    doc["agent-default-model"] = { provider: main.provider, model: main.model };
    // dsh's ui-theme registry only accepts light/dark/system (T21.7 note):
    // high-contrast is kumo's own setting and maps to dark for dsh surfaces.
    doc["ui-theme"] = {
      preference: a.theme === "high-contrast" ? "dark" : a.theme,
    };

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
  await writeAtom(join(dshHome, "kumo.json"), plan.kumoJson, 0o600);
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
