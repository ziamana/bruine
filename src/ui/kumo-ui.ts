import {
  Container,
  Editor,
  matchesKey,
  ProcessTerminal,
  SelectList,
  Text,
  TuiMainScreen,
  CombinedAutocompleteProvider,
  type Component,
  type OverlayHandle,
  type SelectItem,
  type SlashCommand,
  type TUI,
  type Terminal,
} from "@earendil-works/pi-tui";
import { kumoIcons, type KumoIcons } from "../render/chars.js";
import { ansi, editorTheme, selectListTheme } from "./theme.js";
import { ChatTranscript, PlainGlyphEditor } from "./chat-layout.js";
import { FooterComponent } from "./footer.js";
import { displayModel } from "./footer.js";
import { QuestionForm } from "./questions.js";
import { WorkingComponent } from "./working.js";
import { TaskPanel, type TaskItem } from "./task-panel.js";
import { CollapsedToolsComponent, groupRuns, turnSummary, type GroupedTool } from "./tool-group.js";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  noticeForStartup,
  readKumoJsonDoc,
  readUpdateCache,
  resolveDshHome,
  updateCheckEnabled,
} from "../update.js";

export interface KumoUiHandlers {
  /** Enter on the editor (or the equivalent submit). */
  onSubmit(text: string): void;
  /** User typed or sent (for aborting background suggestion). */
  onUserActivity?: () => void;
  /** Escape: interrupt the running turn, never the app. */
  onEscape(): void;
  /** Quit request: ctrl+d, or ctrl+c twice within 500 ms. */
  onQuit(): void;
  /** Shift+Tab: toggle Plan/Build (T31.4). */
  onShiftTab?: () => void;
}

/** Overlay container that forwards key input to its SelectList. */
class ChoiceOverlay implements Component {
  constructor(
    private readonly title: Component,
    private readonly list: SelectList,
  ) {}

  render(width: number): string[] {
    return [...this.title.render(width), ...this.list.render(width)];
  }

  handleInput(data: string): void {
    this.list.handleInput(data);
  }

  invalidate(): void {
    this.title.invalidate();
    this.list.invalidate();
  }
}

/** Notice area directly above the editor (T24.4): one empty line when idle. */
class NoticeBox extends Container {
  override render(width: number): string[] {
    if (this.children.length === 0) return [""];
    return super.render(width);
  }
}

/** Startup cloud frames (T27.4): block/braille `kumo`, no emoji. */
export const STARTUP_FRAMES = [
  "░ kumo",
  "▒ kumo",
  "▓ kumo",
  "█ kumo",
  "⡿ kumo ⡿",
  "⣿ kumo ⣿",
];

export function shouldAnimateStartup(opts: {
  stdoutTTY?: boolean;
  env?: NodeJS.ProcessEnv;
  ascii?: boolean;
} = {}): boolean {
  const env = opts.env ?? process.env;
  const tty = opts.stdoutTTY ?? process.stdout.isTTY === true;
  if (!tty) return false;
  if (opts.ascii === true) return false;
  if (env.KUMO_ASCII === "1") return false;
  if (env.CI === "1") return false;
  if (env.KUMO_NO_ANIMATION === "1") return false;
  return true;
}

/** Host for header: base URL hostname, or provider for cloud (pure; tested). */
export function headerHost(
  kumoJson?: { models?: { main?: { baseUrl?: string; provider?: string } } },
  fallbackProvider?: string,
): string {
  const main = kumoJson?.models?.main;
  if (typeof main?.baseUrl === "string" && main.baseUrl !== "") {
    try {
      return new URL(main.baseUrl).hostname;
    } catch {
      // fall through
    }
  }
  if (typeof main?.provider === "string" && main.provider !== "") return main.provider;
  if (typeof fallbackProvider === "string" && fallbackProvider !== "") {
    if (fallbackProvider === "local") return "local";
    return fallbackProvider;
  }
  return "?";
}

export function readKumoJsonForHeader(dshHome?: string): {
  models?: { main?: { baseUrl?: string; provider?: string; model?: string; name?: string; contextWindow?: number } };
} | undefined {
  try {
    const home = dshHome ?? process.env.DSH_HOME ?? join(homedir(), ".kumo");
    const p = join(home, "kumo.json");
    if (!existsSync(p)) return undefined;
    return JSON.parse(readFileSync(p, "utf8")) as {
      models?: { main?: { baseUrl?: string; provider?: string; model?: string; name?: string; contextWindow?: number } };
    };
  } catch {
    return undefined;
  }
}

export interface SettingsRoute {
  provider: string;
  model: string;
  baseUrl?: string;
  name?: string;
  contextWindow?: number;
}

/** Minimal settings.yaml reader (T28b.1): default route + baseURL/name/window. No YAML dep. */
export function readSettingsRoute(dshHome?: string): SettingsRoute | undefined {
  try {
    const home = dshHome ?? process.env.DSH_HOME ?? join(homedir(), ".kumo");
    const p = join(home, "settings.yaml");
    if (!existsSync(p)) return undefined;
    const doc = parseKumoSettingsYaml(readFileSync(p, "utf8"));
    if (doc === undefined) return undefined;
    return doc;
  } catch {
    return undefined;
  }
}

function unquoteYaml(s: string): string | number {
  const t = s.trim();
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    try {
      return JSON.parse(t) as string;
    } catch {
      return t.slice(1, -1);
    }
  }
  if (/^-?\d+$/.test(t)) return Number(t);
  return t;
}

function parseKumoSettingsYaml(text: string): SettingsRoute | undefined {
  const lines = text.split(/\r?\n/);
  // Indentation stack of {indent, kind, obj} for maps and model list items.
  interface Frame {
    indent: number;
    obj: Record<string, unknown>;
  }
  const root: Record<string, unknown> = {};
  const stack: Frame[] = [{ indent: -1, obj: root }];
  let providers: Record<string, unknown> | undefined;
  let currentModelItem: Record<string, unknown> | undefined;
  const top = (): Frame => stack[stack.length - 1]!;
  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, "");
    if (line.trim() === "") continue;
    const indent = line.search(/\S/);
    const content = line.trim();
    while (stack.length > 1 && indent <= top().indent) {
      const popped = stack.pop()!;
      if (popped.obj === currentModelItem) currentModelItem = undefined;
    }
    if (content.startsWith("- ")) {
      const item: Record<string, unknown> = {};
      const rest = content.slice(2).trim();
      if (rest !== "") {
        const m = /^([^:]+):\s*(.*)$/.exec(rest);
        if (m !== null) item[m[1]!.trim()] = unquoteYaml(m[2] ?? "");
      }
      const parent = top().obj;
      // The `models:` line itself created a placeholder map; a list takes over.
      let arr = parent.models;
      if (!Array.isArray(arr)) {
        arr = [];
        parent.models = arr;
      }
      (arr as Array<Record<string, unknown>>).push(item);
      stack.push({ indent, obj: item });
      currentModelItem = item;
      continue;
    }
    const m = /^([^:]+):\s*(.*)$/.exec(content);
    if (m === null) continue;
    const key = m[1]!.trim();
    const value = m[2] ?? "";
    if (value !== "") {
      top().obj[key] = unquoteYaml(value);
      currentModelItem = undefined;
    } else {
      const child: Record<string, unknown> = {};
      top().obj[key] = child;
      stack.push({ indent, obj: child });
      if (key === "providers") providers = child;
      currentModelItem = undefined;
    }
  }
  const agent = root["agent-default-model"] as Record<string, unknown> | undefined;
  const provider = typeof agent?.provider === "string" ? (agent.provider as string) : undefined;
  const model = typeof agent?.model === "string" ? (agent.model as string) : undefined;
  if (provider === undefined || model === undefined) return undefined;
  const pi = root["llm-pi-ai"] as Record<string, unknown> | undefined;
  const provs = pi?.providers as Record<string, Record<string, unknown>> | undefined;
  const route = provs?.[provider] as Record<string, unknown> | undefined;
  const baseUrl = typeof route?.baseURL === "string" ? (route.baseURL as string) : undefined;
  const models = Array.isArray(route?.models) ? (route.models as Array<Record<string, unknown>>) : [];
  const entry =
    models.find((e) => typeof e.id === "string" && (e.id as string) === model) ?? models[0];
  const name = entry !== undefined && typeof entry.name === "string" ? (entry.name as string) : undefined;
  const contextWindow =
    entry !== undefined && typeof entry.contextWindow === "number" ? (entry.contextWindow as number) : undefined;
  return {
    provider,
    model,
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...(name !== undefined ? { name } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
  };
}

/**
 * The kumo TUI shell (T13a), pi-tui main-screen mode: header, chat
 * transcript, bordered multi-line editor, footer. Replaces readline while a
 * terminal is attached.
 */
export class KumoUi {
  readonly tui: TUI;
  readonly terminal: Terminal;
  readonly chat: Container;
  readonly editor: PlainGlyphEditor;
  readonly footer: FooterComponent;
  readonly icons: KumoIcons;
  readonly noticeBox: NoticeBox;
  readonly taskPanel: TaskPanel;
  readonly header: Text;
  readonly version: string;
  #lastCtrlC = 0;
  #animation: ReturnType<typeof setInterval> | undefined;
  #closed = false;
  #noticeTimer: ReturnType<typeof setTimeout> | undefined;
  #persistentNotice: Component | undefined;
  #confirming = false;
  #animTimer: ReturnType<typeof setInterval> | undefined;
  #cachedHost: string | undefined;
  #toolsCollapsed = true;

  constructor(
    version: string,
    handlers: KumoUiHandlers,
    terminal?: Terminal,
    icons: KumoIcons = kumoIcons(),
  ) {
    this.icons = icons;
    this.terminal = terminal ?? new ProcessTerminal();
    this.tui = new TuiMainScreen(this.terminal);
    this.version = version;

    this.header = new Text("", 1, 0);
    this.chat = new ChatTranscript(icons);
    this.editor = new PlainGlyphEditor(this.tui, editorTheme);
    this.editor.onSubmit = (text) => {
      this.showWorking();
      // T30: the update notice stays until the first prompt.
      if (this.#persistentNotice !== undefined) {
        this.noticeBox.removeChild(this.#persistentNotice);
        this.#persistentNotice = undefined;
      }
      handlers.onSubmit(text);
    };
    this.footer = new FooterComponent(icons);
    this.taskPanel = new TaskPanel(icons);
    this.noticeBox = new NoticeBox();
    try {
      // T28b.1: settings.yaml is the source of truth; kumo.json only a fallback.
      const route = readSettingsRoute();
      if (route !== undefined) {
        const init: Record<string, unknown> = { model: route.model, provider: route.provider };
        if (route.name !== undefined) init.modelName = route.name;
        if (route.contextWindow !== undefined && route.contextWindow > 0) {
          init.contextWindow = route.contextWindow;
          init.contextUsed = 0;
        }
        this.footer.set(init as never);
      } else {
        const doc = readKumoJsonForHeader();
        const main = doc?.models?.main;
        if (main !== undefined) {
          const init: Record<string, unknown> = {};
          if (typeof main.model === "string" && main.model !== "") init.model = main.model;
          if (typeof main.name === "string" && main.name !== "") init.modelName = main.name;
          if (typeof main.provider === "string" && main.provider !== "") init.provider = main.provider;
          if (typeof main.contextWindow === "number" && main.contextWindow > 0) {
            init.contextWindow = main.contextWindow;
            init.contextUsed = 0;
          }
          if (Object.keys(init).length > 0) this.footer.set(init as never);
        }
      }
    } catch {
      // startup footer is best effort; repl sets model/provider shortly after
    }
    this.updateHeader();

    this.tui.addChild(this.header);
    this.tui.addChild(this.chat);
    this.tui.addChild(this.taskPanel);
    this.tui.addChild(this.noticeBox);
    this.tui.addChild(this.editor);
    this.tui.addChild(this.footer);

    // T30: the launcher ran the 24 h registry check in the background; the
    // session only reads its cached result — never any network here, never
    // any delay.
    void this.#maybeUpdateNotice(version);

    this.tui.addInputListener((data: string) => {
      if (
        data.includes("\x1b[200~") ||
        (!data.startsWith("\x1b") && [...data].some((ch) => (ch.codePointAt(0) ?? 0) >= 32))
      ) {
        handlers.onUserActivity?.();
      }
      if (matchesKey(data, "ctrl+t")) {
        if (this.#confirming) return { consume: true };
        this.taskPanel.toggleExpanded();
        this.requestRender();
        return { consume: true };
      }
      if (matchesKey(data, "ctrl+o")) {
        if (this.#confirming) return { consume: true };
        this.#toolsCollapsed = !this.#toolsCollapsed;
        this.applyToolsCollapsed();
        this.requestRender();
        return { consume: true };
      }
      if (this.#confirming) {
        if (matchesKey(data, "tab") || matchesKey(data, "shift+tab")) {
          return { consume: true };
        }
        if (matchesKey(data, "escape")) {
          return {};
        }
        if (matchesKey(data, "ctrl+c") || matchesKey(data, "ctrl+d")) {
          return { consume: true };
        }
        return {};
      }
      if (handlers.onShiftTab !== undefined && matchesKey(data, "shift+tab")) {
        handlers.onShiftTab();
        this.requestRender();
        return { consume: true };
      }
      // T31.4: Tab is completion only (the Editor owns it). Never a mode action.
      if (matchesKey(data, "escape")) {
        handlers.onEscape();
        return { consume: true };
      }
      if (matchesKey(data, "ctrl+c")) {
        const now = Date.now();
        if (this.#lastCtrlC !== 0 && now - this.#lastCtrlC < 500) {
          handlers.onQuit();
        } else {
          this.editor.setText("");
          this.requestRender();
        }
        this.#lastCtrlC = now;
        return { consume: true };
      }
      if (matchesKey(data, "ctrl+d")) {
        if (this.editor.getText() === "") {
          handlers.onQuit();
          return { consume: true };
        }
      }
      const ghost = this.editor.ghost;
      const empty = this.editor.getText() === "";
      if (ghost !== "" && empty) {
        if (data === "\x1b[C" || data === "\x06") {
          this.editor.setText(ghost);
          this.editor.clearGhost();
          this.requestRender();
          return { consume: true };
        }
        if (data === "\r" || data === "\n") {
          return { consume: true };
        }
        if (!data.startsWith("\x1b") && [...data].some((ch) => (ch.codePointAt(0) ?? 0) >= 32)) {
          this.editor.clearGhost();
          this.requestRender();
          return {};
        }
      }
      return {};
    });
  }

  start(): void {
    this.tui.setFocus(this.editor);
    this.tui.start();
    if (shouldAnimateStartup({ ascii: this.icons.think === "*" })) {
      let i = 0;
      this.#animTimer = setInterval(() => {
        if (this.#closed) {
          if (this.#animTimer !== undefined) clearInterval(this.#animTimer);
          this.#animTimer = undefined;
          return;
        }
        if (i < STARTUP_FRAMES.length) {
          const frame = STARTUP_FRAMES[i]!;
          this.header.setText(
            `${frame}\n${ansi.gray("escape interrupt · ctrl+c clear · ctrl+d exit · / commands")}`,
          );
          this.requestRender();
          i += 1;
        } else {
          if (this.#animTimer !== undefined) clearInterval(this.#animTimer);
          this.#animTimer = undefined;
          this.updateHeader();
          this.requestRender();
        }
      }, 83);
      this.#animTimer.unref?.();
    }
  }

  requestRender(): void {
    if (this.#closed) return;
    this.updateHeader();
    this.tui.requestRender();
    const active = this.taskPanel.active || this.chat.children.some((c) => (c as Component & { active?: boolean }).active);
    if (active && this.#animation === undefined) {
      this.#animation = setInterval(() => this.requestRender(), 100);
      this.#animation.unref();
    } else if (!active && this.#animation !== undefined) {
      clearInterval(this.#animation);
      this.#animation = undefined;
    }
  }

  addChat(component: Component): void {
    this.chat.addChild(component);
    this.requestRender();
  }

  removeChat(component: Component): void {
    this.chat.removeChild(component);
    this.requestRender();
  }

  /** Replace the visible task list after a todo/write event. */
  setTasks(tasks: TaskItem[]): void {
    const completed = this.taskPanel.setTasks(tasks);
    if (completed !== undefined) {
      this.addChat(new Text(ansi.dim(`${this.icons.ok} ${completed} tasks done`), 1, 0));
    }
    this.requestRender();
  }

  /** For /new integration: clear the panel without adding a chat line. */
  clearTasks(): void {
    this.taskPanel.clearTasks();
    this.requestRender();
  }

  rememberHistory(text: string): void {
    this.editor.addToHistory(text);
  }

  /** Slash-command + file completion on the editor (T31.1). */
  setAutocompleteCommands(commands: SlashCommand[]): void {
    this.editor.setAutocompleteProvider(new CombinedAutocompleteProvider(commands, process.cwd()));
    this.editor.setAutocompleteMaxVisible(10);
  }

  /** Fresh conversation view (T31.2): empty chat, no groups, no ghost/notice. */
  clearChat(): void {
    if (this.#closed) return;
    this.chat.clear();
    this.#collapsedGroups = [];
    this.#toolsCollapsed = true;
    this.editor.clearGhost();
    this.clearNoticeBox();
    this.requestRender();
  }

  /** Ghost next-prompt suggestion in the empty editor (T28B). */
  setGhost(text: string): void {
    if (this.#closed) return;
    if (this.editor.getText() !== "") return;
    this.editor.setGhost(text);
    this.requestRender();
  }

  clearGhost(): void {
    if (this.editor.ghost === "") return;
    this.editor.clearGhost();
    this.requestRender();
  }

  /** Show Working immediately on submit (T27b.5), removed on first chunk. */
  showWorking(): void {
    if (this.#closed) return;
    const has = this.chat.children.some(
      (c) => (c as { constructor?: { name?: string } }).constructor?.name === "WorkingComponent",
    );
    if (has) return;
    this.chat.addChild(new WorkingComponent(Date.now, this.icons));
    this.requestRender();
  }

  /** Header first line (T27.4, T28b.1): settings route first, kumo.json fallback. */
  headerFirstLine(): string {
    const st = this.footer.state;
    const model = displayModel(st.model, st.modelName);
    if (this.#cachedHost === undefined) {
      let host: string | undefined;
      try {
        const route = readSettingsRoute();
        if (route?.baseUrl !== undefined && route.baseUrl !== "") {
          host = new URL(route.baseUrl).hostname;
        } else if (route?.provider !== undefined && route.provider !== "" && route.provider !== "local") {
          host = route.provider;
        }
      } catch {
        host = undefined;
      }
      this.#cachedHost = host ?? headerHost(readKumoJsonForHeader(), st.provider);
    }
    const host = this.#cachedHost ?? "?";
    const sep = this.icons.think === "*" ? "-" : "·";
    return `${ansi.bold("kumo")}  ${sep}  ${model}  ${sep}  ${host}  ${ansi.dim(`v${this.version}`)}`;
  }

  updateHeader(): void {
    if (this.#closed) return;
    if (this.#animTimer !== undefined) return;
    this.header.setText(
      `${this.headerFirstLine()}\n${ansi.gray("escape interrupt · ctrl+c clear · ctrl+d exit · / commands")}`,
    );
  }

  get toolsCollapsed(): boolean {
    return this.#toolsCollapsed;
  }

  #collapsedGroups: Array<{
    collapsed: CollapsedToolsComponent;
    excess: Array<{ comp: unknown }>;
    index: number;
  }> = [];

  /** Collapse/expand all tool groups for ctrl+o (T27.2). */
  applyToolsCollapsed(): void {
    for (const g of this.#collapsedGroups) {
      const inChat = this.chat.children.includes(g.collapsed as never);
      if (this.#toolsCollapsed && !inChat) {
        for (const e of g.excess) this.chat.removeChild(e.comp as never);
        this.chat.children.splice(Math.min(Math.max(0, g.index), this.chat.children.length), 0, g.collapsed as never);
      } else if (!this.#toolsCollapsed && inChat) {
        this.chat.removeChild(g.collapsed as never);
        g.excess.forEach((e, k) => {
          this.chat.children.splice(
            Math.min(Math.max(0, g.index + k), this.chat.children.length),
            0,
            e.comp as never,
          );
        });
      }
    }
    this.requestRender();
  }

  /** Turn end from render (T27.2+3): collapse groups + summary line. */
  onTurnEnd(info: {
    tools: Array<{ tool: string; ok: boolean; seconds: number; comp: unknown; breakBefore?: boolean; hidden?: boolean }>;
    wallSec: number;
    outputTokens: number;
    cancelled: boolean;
    error: boolean;
  }): void {
    if (this.#closed) return;
    const ascii = this.icons.think === "*";
    if (info.cancelled) {
      const line = turnSummary({
        tools: 0,
        wallSec: info.wallSec,
        outputTokens: 0,
        cancelled: true,
        okMark: ascii ? "v" : "✓",
        cancelMark: ascii ? "-" : "·",
      });
      if (line !== undefined) this.addChat(new Text(ansi.dim(line), 1, 0));
      return;
    }
    if (info.error) return;
    let offset = 0;
    let segment: Array<{ tool: string; ok: boolean; seconds: number }> = [];
    let segStart = 0;
    const flushSegment = (): void => {
      for (const run of groupRuns(segment)) {
        if (run.count > 2) {
          const gStart = segStart + run.start;
          const comps = info.tools.slice(gStart, gStart + run.count).map((t) => t.comp);
          const excess = comps.slice(2).map((comp) => ({ comp }));
          const excessSecs = info.tools
            .slice(gStart + 2, gStart + run.count)
            .reduce((a, t) => a + t.seconds, 0);
          const collapsed = new CollapsedToolsComponent(run.tool, run.count - 2, excessSecs, this.icons);
          const firstExcess = excess[0]?.comp;
          const index =
            firstExcess !== undefined ? this.chat.children.indexOf(firstExcess as never) : this.chat.children.length;
          const at = Math.max(0, Math.min(index < 0 ? this.chat.children.length : index, this.chat.children.length));
          if (this.#toolsCollapsed) {
            for (const e of excess) this.chat.removeChild(e.comp as never);
            this.chat.children.splice(at, 0, collapsed as never);
          }
          this.#collapsedGroups.push({ collapsed, excess, index: at });
        }
      }
    };
    for (const t of info.tools) {
      if (t.hidden === true) {
        if (segment.length > 0) {
          flushSegment();
          segment = [];
        }
        offset += 1;
        segStart = offset;
        continue;
      }
      if (t.breakBefore === true && segment.length > 0) {
        flushSegment();
        segment = [];
        segStart = offset;
      }
      segment.push({ tool: t.tool, ok: t.ok, seconds: t.seconds });
      offset += 1;
    }
    flushSegment();
    const line = turnSummary({
      tools: info.tools.length,
      wallSec: info.wallSec,
      outputTokens: info.outputTokens,
      cancelled: false,
      okMark: ascii ? "v" : "✓",
      cancelMark: ascii ? "-" : "·",
    });
    if (line !== undefined) this.addChat(new Text(ansi.dim(line), 1, 0));
  }

  /** Transient dim (or red) notice directly above the editor for 3 s (T24.4). */
  showNotice(text: string, opts: { red?: boolean } = {}): void {
    if (this.#closed) return;
    this.clearNoticeBox();
    const line = new Text(opts.red === true ? ansi.red(text) : ansi.dim(text), 1, 0);
    this.noticeBox.addChild(line);
    this.requestRender();
    if (this.#noticeTimer !== undefined) clearTimeout(this.#noticeTimer);
    this.#noticeTimer = setTimeout(() => {
      this.#noticeTimer = undefined;
      this.clearNoticeBox();
      this.requestRender();
    }, 3000);
    this.#noticeTimer.unref?.();
  }

  clearNoticeBox(): void {
    if (this.#noticeTimer !== undefined) {
      clearTimeout(this.#noticeTimer);
      this.#noticeTimer = undefined;
    }
    this.#persistentNotice = undefined;
    for (const child of [...this.noticeBox.children]) {
      this.noticeBox.removeChild(child);
    }
  }

  /** A dim notice that stays (T30 update line) until the first prompt. */
  showPersistentNotice(text: string): void {
    if (this.#closed) return;
    this.clearNoticeBox();
    const line = new Text(ansi.dim(text), 1, 0);
    this.#persistentNotice = line;
    this.noticeBox.addChild(line);
    this.requestRender();
  }

  /**
   * T30: read the cached update check (written by the launcher's background
   * check) and show the one-line notice when a newer version is known.
   * Gated by the same off switches; any failure stays silent.
   */
  async #maybeUpdateNotice(version: string): Promise<void> {
    try {
      const home = resolveDshHome();
      const doc = await readKumoJsonDoc(home);
      // The TUI shell only exists on an interactive terminal, so the TTY
      // gate was already passed by the launcher.
      if (!updateCheckEnabled({ doc, isTTY: true })) return;
      const text = noticeForStartup({ cache: await readUpdateCache(home), current: version });
      if (text !== undefined) this.showPersistentNotice(text);
    } catch {
      // an update notice must never break the session
    }
  }

  /**
   * Full access confirmation as an inline SelectList above the editor (T24.4).
   * Red title, items Cancel (default) / Enable. Resolves true for Enable.
   */
  confirmFullAccess(): Promise<boolean> {
    if (this.#closed) return Promise.resolve(false);
    this.clearNoticeBox();
    this.#confirming = true;
    const title = new Text(
      ansi.red("Enable full access? kumo will run commands and edit files without asking."),
      1,
      0,
    );
    const items: SelectItem[] = [
      { value: "cancel", label: "Cancel" },
      { value: "enable", label: "Enable" },
    ];
    const list = new SelectList(items, Math.max(items.length, 5), selectListTheme);
    this.noticeBox.addChild(title);
    this.noticeBox.addChild(list);
    this.requestRender();
    return new Promise((resolve) => {
      const finish = (ok: boolean) => {
        this.#confirming = false;
        this.clearNoticeBox();
        this.tui.setFocus(this.editor);
        this.requestRender();
        resolve(ok);
      };
      list.onSelect = (item) => finish(items.indexOf(item) === 1);
      list.onCancel = () => finish(false);
      this.tui.setFocus(list);
      this.requestRender();
    });
  }

  /**
   * A pi-tui select above the editor (T27b.1, never over chat lines).
   * Resolves with the chosen index, or -1 on cancel (escape).
   */
  askChoice(title: string, items: SelectItem[]): Promise<number> {
    if (this.#closed) return Promise.resolve(-1);
    this.clearNoticeBox();
    this.#confirming = true;
    const titleText = new Text(ansi.yellow(title), 1, 0);
    const list = new SelectList(items, Math.max(items.length, 5), selectListTheme);
    this.noticeBox.addChild(titleText);
    this.noticeBox.addChild(list);
    this.requestRender();
    return new Promise((resolve) => {
      const finish = (index: number) => {
        this.#confirming = false;
        this.clearNoticeBox();
        this.tui.setFocus(this.editor);
        this.requestRender();
        resolve(index);
      };
      list.onSelect = (item) => finish(items.indexOf(item));
      list.onCancel = () => finish(-1);
      this.tui.setFocus(list);
      this.requestRender();
    });
  }

  /**
   * Multi-question form above the editor (T28A, never over chat).
   * Resolves with answers, or undefined when skipped (Esc).
   */
  askQuestions(
    questions: Array<{
      id: string;
      question: string;
      header?: string;
      options?: Array<{ label: string; description?: string }>;
      multiSelect?: boolean;
    }>,
  ): Promise<Array<{ id: string; selected: string[]; custom?: string }> | undefined> {
    if (this.#closed) return Promise.resolve(undefined);
    this.clearNoticeBox();
    this.#confirming = true;
    const form = new QuestionForm(questions);
    this.noticeBox.addChild(form);
    this.requestRender();
    return new Promise((resolve) => {
      const finish = (answers: Array<{ id: string; selected: string[]; custom?: string }> | undefined) => {
        this.#confirming = false;
        this.clearNoticeBox();
        this.tui.setFocus(this.editor);
        this.requestRender();
        resolve(answers);
      };
      form.onDone = (a) => finish(a === undefined ? undefined : a);
      this.tui.setFocus(form);
      this.requestRender();
    });
  }

  /** Graceful shutdown: drain pending key-release bytes, then stop. */
  async shutdown(): Promise<void> {
    this.#closed = true;
    clearInterval(this.#animation);
    this.#animation = undefined;
    if (this.#animTimer !== undefined) {
      clearInterval(this.#animTimer);
      this.#animTimer = undefined;
    }
    if (this.#noticeTimer !== undefined) {
      clearTimeout(this.#noticeTimer);
      this.#noticeTimer = undefined;
    }
    try {
      await this.terminal.drainInput(300, 50);
    } catch {
      // best effort
    }
    this.tui.stop();
  }
}
