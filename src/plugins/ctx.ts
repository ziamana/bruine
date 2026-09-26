/**
 * Minimal structural view of the Cordis/dsh context surface kumo plugins use.
 * Kept local on purpose: kumo must not type-couple to a specific copy of
 * @deepseek-ai/cordis (the runtime context comes from dsh's own tree).
 */
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
    askChoice(title: string, items: Array<{ value: string; label: string }>): Promise<number>;
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
    addChat(component: any): void;
    removeChat?(component: any): void;
    showNotice?(text: string, opts?: { red?: boolean }): void;
    confirmFullAccess?(): Promise<boolean>;
    footer: { set(next: Record<string, unknown>): void; tpsReset?(): void };
    requestRender(): void;
    icons: { think: string; prompt: string; ok: string; fail: string; bullet: string; spark: string };
  };
}
