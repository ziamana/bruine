/**
 * Minimal structural view of the Cordis/dsh context surface kumo plugins use.
 * Kept local on purpose: kumo must not type-couple to a specific copy of
 * @deepseek-ai/cordis (the runtime context comes from dsh's own tree).
 */
import type { ClipboardImage } from "../image/clipboard.js";
import type { VisionAnswer } from "../image/vision.js";
export interface DshContext {
  get(service: string): any;
  /** Mount another Cordis plugin (T34: kumo-effort from kumo-repl). */
  plugin?(plugin: unknown, config?: unknown): unknown;
  provide(name: string, value: unknown): void;
  inject(services: string[], callback: (ctx: any) => void): void;
  on(event: string, listener: (...args: any[]) => any): () => void;
  logger?: {
    error(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    info(...args: unknown[]): void;
  };
}

/** The service published by kumo-startup and consumed by kumo-repl. */
export interface KumoStartup {
  initialPrompt?: string;
  headless?: { prompts: string[]; format: "text" | "json" | "stream-json" };
}

/** The service published by kumo-repl once its agent exists. */
export interface KumoRepl {
  agent: any;
  /**
   * T34: the dsh ModelSelectionRef holder. dsh reads `.current` at prompt
   * assembly and request time, so replacing it changes the NEXT request's
   * parameters only — never the system prompt or the tools.
   */
  selection?: { current?: { provider: string; model: string; reasoningEffort?: string } };
  /** Non-TTY mode: ask one line on the readline interface. */
  ask?: (question: string) => Promise<string>;
  /** TTY mode: the pi-tui shell (askChoice, addChat, footer). */
  ui?: {
    /** `opts.initial` starts the cursor on a row (T37: the current route). */
    askChoice(
      title: string,
      items: Array<{ value: string; label: string }>,
      opts?: { initial?: number },
    ): Promise<number>;
    askQuestions?(
      questions: Array<{
        id: string;
        question: string;
        header?: string;
        options?: Array<{ label: string; description?: string }>;
        multiSelect?: boolean;
      }>,
    ): Promise<Array<{ id: string; selected: string[]; custom?: string }> | undefined>;
    setGhost?(text: string): void;
    clearGhost?(): void;
    /** T29: the images behind the `[Image N]` chips, and the vision answer. */
    pendingImages: {
      resolve(text: string): ClipboardImage[];
      release(images: readonly ClipboardImage[]): void;
      clear(): void;
    };
    routeSeesImages?(): Promise<VisionAnswer>;
    addChat(component: any): void;
    /** T55 P1b: the prompt opens a turn, so the shell numbers it and the band shows it. */
    addUserPrompt(text: string): void;
    removeChat?(component: any): void;
    showNotice?(text: string, opts?: { red?: boolean }): void;
    confirmFullAccess?(): Promise<boolean>;
    /** T37: drops the memoized header host after a route switch. */
    resetRouteCache?(): void;
    footer: { set(next: Record<string, unknown>): void; tpsReset?(): void };
    requestRender(): void;
    icons: { think: string; prompt: string; ok: string; fail: string; bullet: string; spark: string; folder: string };
  };
}
