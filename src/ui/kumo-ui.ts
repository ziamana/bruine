import { parse as parseYaml } from "yaml";
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
  type RgbColor,
  type SelectItem,
  type SlashCommand,
  type TUI,
  type Terminal,
  type TuiInputListener,
} from "@earendil-works/pi-tui";
import { kumoIcons, type KumoIcons } from "../render/chars.js";
import { ansi, editorTheme, selectListTheme } from "./theme.js";
import { bgEnabled, colorDepth, gradientStops, setTerminalBackdrop } from "./palette.js";
import { LOGO_STOPS, terminalMotionAllowed, wordmarkFrame } from "./logo-motion.js";
import { ChatTranscript, ConsoleBand, Gap, Margin, PlainGlyphEditor } from "./chat-layout.js";
import { FooterComponent } from "./footer.js";
import { displayModel } from "./footer.js";
import { QuestionForm } from "./questions.js";
import { WorkingComponent } from "./working.js";
import { TaskPanel, type TaskItem } from "./task-panel.js";
import { DashboardPanel, DockRow } from "./dock.js";
import {
  CollapsedToolsComponent,
  groupRuns,
  turnReceipt,
  type GroupedTool,
  type ReceiptSegment,
} from "./tool-group.js";
import { userMessageComponent } from "./assistant-text.js";
import {
  draggedImagePath,
  readClipboardImage,
  readImageFile,
  rejectionNotice,
  type ClipboardRead,
} from "../image/clipboard.js";
import { PendingImages } from "../image/pending.js";
import { selectedText, SelectionLayer, viewportTop, type SelectionSpan } from "./selection.js";
import { MouseFeature, type CopyClipboard } from "./mouse.js";
import { ChangedFilesComponent, type ChangedFile } from "./changes.js";
import { typedText } from "./keys.js";

/** T29: where a paste gets its bytes; injectable so tests never spawn a tool. */
export type ClipboardImageReader = () => Promise<ClipboardRead>;

const defaultClipboardRead: ClipboardImageReader = () => readClipboardImage();

import { NO_VISION_NOTICE, probeVision, settingsEntryAnswer, type VisionAnswer } from "../image/vision.js";
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
  /**
   * T56: where a mouse selection is written. Left out, the platform clipboard
   * is used, which means a test never spawns wl-copy.
   */
  copyText?: CopyClipboard;
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
  /** settings.yaml provider displayName, when present (T33b error lines). */
  providerDisplayName?: string;
  /** True when the model entry carries compat.thinkingFormat (T34/T33b). */
  hasCompat?: boolean;
  /** T29: what the route's own model entry says about images. */
  vision?: VisionAnswer;
}

/** What a `/reload` found. `route: "moved"` never means the session moved. */
export interface ReloadReport {
  /** Whether settings.yaml still points at the route this session is on. */
  route: "unchanged" | "moved" | "unreadable";
  /** The route the session is really on, as `provider / model`. */
  live: string;
  /** The route settings.yaml now names, when it is not the live one. */
  moved: string | undefined;
  /** Whether the terminal answered OSC 11 for its background. */
  background: "read" | "kept";
}

/** One `provider / model` label, the way the header and the footer name it. */
export function routeLabel(route: { provider?: string; model?: string; name?: string }): string {
  const model = displayModel(route.model, route.name);
  return route.provider === undefined || route.provider === "" ? model : `${route.provider} / ${model}`;
}

/** One `llm-pi-ai.providers` entry as kumo needs to show it (T37). */
export interface SettingsProvider {
  id: string;
  displayName?: string;
  baseUrl?: string;
  /** The env var holding the key, when the route declares one. */
  apiKeyEnv?: string;
  models: Array<{ id: string; name?: string; contextWindow?: number }>;
}

/**
 * T37: every provider settings.yaml declares, not only the default one. The
 * model picker needs the whole set: a route that setup already wrote is
 * offered even when the server does not advertise it right now (a llama.cpp
 * server swaps its loaded model without kumo knowing).
 */
export function readSettingsProviders(dshHome?: string): SettingsProvider[] {
  try {
    const home = dshHome ?? process.env.DSH_HOME ?? join(homedir(), ".kumo");
    const p = join(home, "settings.yaml");
    if (!existsSync(p)) return [];
    const doc = parseYaml(readFileSync(p, "utf8")) as any;
    const providers = doc?.["llm-pi-ai"]?.providers;
    if (providers === null || typeof providers !== "object") return [];
    const out: SettingsProvider[] = [];
    for (const [id, route] of Object.entries(providers as Record<string, any>)) {
      if (route === null || typeof route !== "object") continue;
      const models: SettingsProvider["models"] = [];
      if (Array.isArray(route.models)) {
        for (const entry of route.models) {
          if (entry === null || typeof entry !== "object" || typeof entry.id !== "string") continue;
          const model: SettingsProvider["models"][number] = { id: entry.id };
          if (typeof entry.name === "string") model.name = entry.name;
          if (typeof entry.contextWindow === "number") model.contextWindow = entry.contextWindow;
          models.push(model);
        }
      }
      const provider: SettingsProvider = { id, models };
      if (typeof route.displayName === "string") provider.displayName = route.displayName;
      if (typeof route.baseURL === "string") provider.baseUrl = route.baseURL;
      if (typeof route.apiKeyEnv === "string") provider.apiKeyEnv = route.apiKeyEnv;
      out.push(provider);
    }
    return out;
  } catch {
    return [];
  }
}

/** settings.yaml reader: default route + baseURL/name/window (real YAML parser; the hand-written one broke on kumo's own list style). */
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

function parseKumoSettingsYaml(text: string): SettingsRoute | undefined {
  const doc = parseYaml(text) as any;
  const def = doc?.["agent-default-model"];
  const provider = typeof def?.provider === "string" ? def.provider : undefined;
  const model = typeof def?.model === "string" ? def.model : undefined;
  if (provider === undefined || model === undefined) return undefined;
  const route = doc?.["llm-pi-ai"]?.providers?.[provider];
  const entry = Array.isArray(route?.models)
    ? route.models.find((m: any) => m !== null && typeof m === "object" && m.id === model)
    : undefined;
  const out: SettingsRoute = { provider, model };
  if (typeof route?.baseURL === "string") out.baseUrl = route.baseURL;
  if (typeof entry?.name === "string") out.name = entry.name;
  if (typeof entry?.contextWindow === "number") out.contextWindow = entry.contextWindow;
  if (typeof route?.displayName === "string") out.providerDisplayName = route.displayName;
  if (entry?.compat?.thinkingFormat !== undefined) out.hasCompat = true;
  // T29: only carried when settings.yaml actually declares it. Silence means
  // "ask the server", not "no images", and a missing key keeps this route
  // object exactly as it was before T29.
  const vision = settingsEntryAnswer(entry);
  if (vision !== "unknown") out.vision = vision;
  return out;
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
  /**
   * T56: the mouse. Drag to select, release to copy. It owns the gesture, the
   * clipboard, and the one terminal sequence nobody else writes, so all this
   * class does is hand it a chunk and paint what comes back.
   */
  readonly mouse: MouseFeature;
  readonly noticeBox: NoticeBox;
  readonly taskPanel: TaskPanel;
  readonly dock: DockRow;
  readonly header: Text;
  readonly version: string;
  /** T29: the images the `[Image N]` chips in the editor stand for. */
  readonly pendingImages = new PendingImages();
  #lastCtrlC = 0;
  #animation: ReturnType<typeof setInterval> | undefined;
  #headerSweep: ReturnType<typeof setInterval> | undefined;
  #headerSweepPhase = 0;
  #headerSweepStarted = false;
  #closed = false;
  #noticeTimer: ReturnType<typeof setTimeout> | undefined;
  #persistentNotice: Component | undefined;
  /** A notice that arrived while a question form owned the box. */
  #pendingNotice: { text: string; red: boolean; persistent?: boolean } | undefined;
  #confirming = false;
  #cachedHost: string | undefined;
  /** T56: the frame, with the mouse selection painted on top of it. */
  #layer: SelectionLayer;
  /** T55 P1b: turns run so far, shared by the band label and the turn receipt. */
  #turn = 0;
  #toolsCollapsed = true;
  /** T29: the last vision answer, kept per route so ctrl+v stays instant. */
  #visionKey: string | undefined;
  #visionAnswer: VisionAnswer | undefined;

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
      // Working is shown by the render plugin on turn/start, AFTER the prompt echo
      // (showing it here put it above the user's message on the real server).
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

    // T56: every row goes through one layer, because a selection can cross the
    // transcript, the task panel and the console band, and only the composed
    // frame knows which line a screen row belongs to.
    this.#layer = new SelectionLayer(
      () => this.mouse.span,
      () => this.terminal.rows,
    );
    this.mouse = new MouseFeature({
      tui: this.tui,
      terminal: this.terminal,
      repaint: () => this.requestRender(),
      notify: (text, opts) => this.showNotice(text, opts),
      readText: (span) => this.#readSelection(span),
      copy: handlers.copyText,
    });
    this.#layer.addChild(this.header);
    this.#layer.addChild(this.chat);
    this.#layer.addChild(new Margin(new Gap(this.taskPanel)));
    this.#layer.addChild(new Margin(this.noticeBox));
    // Cockpit (Nuage + Cockpit mix): live speed/cache/context next to the editor on
    // wide color terminals; ctrl+b hides it. Basic/ASCII terminals keep the plain editor.
    this.dock = new DockRow(
      this.editor,
      new DashboardPanel(
        () => this.footer.state,
        this.footer.speed,
        () => {
          const cur = this.taskPanel.tasks.find((t) => t.status === "in_progress");
          return { done: this.taskPanel.done, total: this.taskPanel.tasks.length, ...(cur !== undefined ? { current: cur.content } : {}) };
        },
        () => {
          this.headerFirstLine();
          return this.#cachedHost ?? "";
        },
      ),
    );
    this.dock.visible = this.fancyHeader;
    this.footer.compact = (w) => this.dock.shown(w);
    // The editor, the cockpit and the footer share one painted surface (T40).
    this.#layer.addChild(new ConsoleBand([this.dock, this.footer]));
    this.tui.addChild(this.#layer);

    // T30: the launcher ran the 24 h registry check in the background; the
    // session only reads its cached result — never any network here, never
    // any delay.
    void this.#maybeUpdateNotice(version);

    this.tui.addInputListener((data: string) => this.#onInput(data, handlers));
  }

  #onInput(data: string, handlers: KumoUiHandlers): ReturnType<TuiInputListener> {
    const mouse = this.mouse.read(data);
    if (mouse.handled) {
      // A chunk can carry a release and the key typed after it in one read. The
      // shell still decides what that key means, and handing the leftover back
      // is how pi-tui routes it to the focused component: poking the editor's
      // handleInput by hand needed a private accessor and reached one layer
      // deeper than its contract allows.
      if (mouse.rest === "") return { consume: true };
      this.#onKey(mouse.rest, handlers);
      return { data: mouse.rest };
    }
    return this.#onKey(data, handlers);
  }

  /** Everything that is a key: the mode switches, the editor, the slash commands. */
  #onKey(data: string, handlers: KumoUiHandlers): ReturnType<TuiInputListener> {
    // T60: "the user typed something" is a question about the encoding, and
    // under the kitty protocol a letter is an escape sequence. Reading it as
    // bytes meant a background suggestion was never dismissed by typing.
    if (data.includes("\x1b[200~") || typedText(data) !== "") {
      handlers.onUserActivity?.();
    }
    if (matchesKey(data, "ctrl+v") && !this.#confirming) {
      void this.pasteClipboardImage();
      return { consume: true };
    }
    // T29: a dropped image arrives as a bracketed paste carrying its path.
    // Only a single-chunk paste is claimed, so a split paste still reaches
    // the editor as the text it is.
    if (data.includes("\x1b[200~") && data.includes("\x1b[201~") && !this.#confirming) {
      const start = data.indexOf("\x1b[200~") + "\x1b[200~".length;
      const file = draggedImagePath(data.slice(start, data.indexOf("\x1b[201~")));
      if (file !== undefined) {
        void this.pasteDroppedImage(file);
        return { consume: true };
      }
    }
    if (matchesKey(data, "ctrl+t")) {
      if (this.#confirming) return { consume: true };
      this.taskPanel.toggleExpanded();
      this.requestRender();
      return { consume: true };
    }
    if (matchesKey(data, "ctrl+b")) {
      if (this.#confirming) return { consume: true };
      this.dock.visible = !this.dock.visible;
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
      // Tab accepts, like every other shell suggestion. It cannot steal the
      // editor's completion: a suggestion only ever shows on an empty
      // buffer, and completion only matters once something has been typed.
      // T60: right and ctrl+f, matched by name: `[C` is the right arrow in
      // one encoding only, and `` is ctrl+f in one encoding only.
      if (matchesKey(data, "right") || matchesKey(data, "ctrl+f") || matchesKey(data, "tab")) {
        this.editor.setText(ghost);
        this.editor.clearGhost();
        this.requestRender();
        return { consume: true };
      }
      if (matchesKey(data, "enter")) {
        return { consume: true };
      }
      if (typedText(data) !== "") {
        this.editor.clearGhost();
        this.requestRender();
        return {};
      }
    }
    return {};
  }

  /**
   * T56: a form owns the screen, so the terminal gets its mouse back. The wheel
   * and the native selection belong to the terminal, and a form is exactly the
   * moment the user wants them: they are reading what came before to answer it.
   */
  #setConfirming(value: boolean): void {
    if (this.#confirming === value) return;
    this.#confirming = value;
    this.mouse.setFormsUp(value);
  }

  /** T56: the visible text of a selection, read out of the frame we compose. */
  #readSelection(span: SelectionSpan): string {
    const lines = this.tui.render(this.terminal.columns);
    return selectedText(lines, viewportTop(lines.length, this.terminal.rows), span);
  }

  start(): void {
    this.tui.setFocus(this.editor);
    this.tui.start();
    // T56: ask for the mouse, so a drag can be seen and copied. KUMO_MOUSE_SELECT=0
    // and a form both keep the terminal's.
    this.mouse.start();
    void this.probeBackdrop();
  }

  /**
   * Ask the terminal for its real background (OSC 11) and re-derive the painted
   * surfaces from it, so the console band sits on the terminal's own palette
   * instead of imposing the hand-tuned dark Nuage values on a light or tinted
   * terminal.
   *
   * The query is a non-printing sequence, so it cannot disturb what is on
   * screen, and pi-tui keeps swallowing the reply after the timeout, so a slow
   * terminal can never leak the response into the input stream as keystrokes.
   * A terminal that never answers simply keeps the authored surfaces.
   */
  async probeBackdrop(): Promise<RgbColor | undefined> {
    if (this.#closed || !bgEnabled()) return undefined;
    let rgb: RgbColor | undefined;
    try {
      rgb = await this.tui.queryTerminalBackgroundColor({ timeoutMs: 150 });
    } catch {
      return undefined;
    }
    if (rgb === undefined || this.#closed) return undefined;
    setTerminalBackdrop(rgb);
    this.requestRender();
    return rgb;
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
    if (component instanceof WorkingComponent) this.#startHeaderSweep();
    this.requestRender();
  }

  #startHeaderSweep(): void {
    if (this.#headerSweepStarted || this.#turn > 1 || !this.fancyHeader || !terminalMotionAllowed()) return;
    this.#headerSweepStarted = true;
    const started = Date.now();
    this.#headerSweep = setInterval(() => {
      this.#headerSweepPhase = Math.min(1, (Date.now() - started) / 420);
      if (this.#headerSweepPhase >= 1) {
        clearInterval(this.#headerSweep);
        this.#headerSweep = undefined;
        this.#headerSweepPhase = 0;
      }
      this.requestRender();
    }, 32);
    this.#headerSweep.unref?.();
  }

  /**
   * The user's prompt opens a turn, so it carries the turn number and the band
   * shows it (T55 P1b). One place numbers the turns, so the label on the band and
   * the number on the receipt can never drift apart.
   */
  addUserPrompt(text: string): void {
    this.#turn += 1;
    const comp = userMessageComponent(text) as Component & { turn?: number };
    comp.turn = this.#turn;
    this.addChat(comp);
  }

  /** How many turns this session has run. */
  get turn(): number {
    return this.#turn;
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

  /**
   * T29 — can the model behind the current route see an image? settings.yaml
   * answers first, then one probe of the server's own `/v1/models`, and the
   * answer is cached per route so ctrl+v never waits on the network twice.
   */
  async routeSeesImages(): Promise<VisionAnswer> {
    const route = readSettingsRoute();
    if (route === undefined) return "unknown";
    if (route.vision !== undefined && route.vision !== "unknown") return route.vision;
    const key = `${route.baseUrl ?? ""}|${route.model}`;
    if (this.#visionKey === key && this.#visionAnswer !== undefined) return this.#visionAnswer;
    const answer = route.baseUrl === undefined ? "unknown" : await probeVision(route.baseUrl, route.model);
    this.#visionKey = key;
    this.#visionAnswer = answer;
    return answer;
  }

  /**
   * T29 — turn one clipboard result into a chip. Returns whether the image is
   * now in the editor, so the caller knows whether to consume the key.
   */
  async #attachClipboard(read: ClipboardRead): Promise<boolean> {
    switch (read.kind) {
      case "image":
        this.editor.insertTextAtCursor(this.pendingImages.add(read.image));
        this.requestRender();
        return true;
      case "no-tool":
        // One line, because a notice that wraps is a notice nobody reads. Drag
        // and drop needs no helper at all, so it is the way out that works
        // right now, whatever the machine is missing.
        this.showNotice(`Cannot paste an image: ${read.install}. Or drag the image in.`, { red: true });
        return false;
      case "rejected":
        this.showNotice(rejectionNotice(read.reason), { red: true });
        return false;
      case "failed":
        this.showNotice(rejectionNotice(read.detail), { red: true });
        return false;
      default:
        this.showNotice("No image in the clipboard.");
        return false;
    }
  }

  /** T29 — ctrl+v: read the OS clipboard, and refuse a model that cannot see. */
  async pasteClipboardImage(read: ClipboardImageReader = defaultClipboardRead): Promise<boolean> {
    if ((await this.routeSeesImages()) === "no") {
      this.showNotice(NO_VISION_NOTICE, { red: true });
      return false;
    }
    return this.#attachClipboard(await read());
  }

  /** T29 — a dropped image path becomes the same chip as a clipboard paste. */
  async pasteDroppedImage(file: string, read?: () => Promise<ClipboardRead>): Promise<boolean> {
    if ((await this.routeSeesImages()) === "no") {
      this.showNotice(NO_VISION_NOTICE, { red: true });
      return false;
    }
    return this.#attachClipboard(await (read?.() ?? readImageFile(file)));
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
    this.#startHeaderSweep();
    this.requestRender();
  }

  /**
   * T37: the route changed under us, so the memoized header host is stale.
   * The vision answer is keyed by route and re-probes on its own.
   */
  resetRouteCache(): void {
    this.#cachedHost = undefined;
  }

  /**
   * `/reload`: re-read what the terminal and `settings.yaml` say, in place, and
   * redraw. It is deliberately not a code reload: the modules are already loaded,
   * so a change in `src/` still needs a build and a restart. What it does cover is
   * everything kumo memoized at startup and would otherwise show stale for the
   * whole session: the header's host, the route behind the footer, and the painted
   * surfaces (the terminal background, re-probed with OSC 11).
   *
   * The route is never swapped from here. The agent is bound to the route it
   * started on, and a header that advertised a route the session is not on would
   * be a lie; a moved route is reported instead, with the command that does move.
   */
  async reload(): Promise<ReloadReport> {
    this.resetRouteCache();
    const report: ReloadReport = { route: "unchanged", live: this.liveRouteLabel(), moved: undefined, background: "kept" };
    try {
      const route = readSettingsRoute();
      if (route === undefined) {
        report.route = "unreadable";
      } else {
        const wanted = routeLabel(route);
        if (wanted !== report.live) {
          report.route = "moved";
          report.moved = wanted;
        }
      }
    } catch {
      report.route = "unreadable";
    }
    // A terminal that answers OSC 11 re-derives the surfaces; one that does not
    // leaves the current ones, which is what `background: "kept"` says out loud.
    report.background = (await this.probeBackdrop()) === undefined ? "kept" : "read";
    this.updateHeader();
    this.requestRender();
    return report;
  }

  /** The route the session is really on, as the header and footer show it. */
  liveRouteLabel(): string {
    const st = this.footer.state;
    return routeLabel({ provider: st.provider, model: st.model, name: st.modelName });
  }

  /** Header first line (T27.4, T28b.1): settings route first, kumo.json fallback. */
  headerFirstLine(includeBrand = true): string {
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
    const details = `${ansi.text(model)}  ${ansi.faint(sep)}  ${ansi.gray(host)}  ${ansi.faint(`v${this.version}`)}`;
    return includeBrand ? `${ansi.bold("kumo")}  ${ansi.faint(sep)}  ${details}` : details;
  }

  /** The big gradient wordmark is for color terminals; basic/ASCII keep one line. */
  get fancyHeader(): boolean {
    const d = colorDepth();
    return this.icons.think !== "*" && (d === "truecolor" || d === "256");
  }

  headerText(): string {
    // The line that says how to quit has to be readable, not decorative. It used
    // to be `faint` on a color terminal while the plain terminal got `muted`, so
    // the words a first-time user needs were the hardest ones to read.
    const help = ansi.gray("escape interrupt · ctrl+c clear · ctrl+d exit · / commands");
    if (!this.fancyHeader) return `${this.headerFirstLine()}\n${help}`;
    const mark = wordmarkFrame(1);
    return [
      "",
      ` ${gradientStops(mark[0]!, [...LOGO_STOPS], this.#headerSweepPhase)}`,
      ` ${gradientStops(mark[1]!, [...LOGO_STOPS], this.#headerSweepPhase)}   ${this.headerFirstLine(false)}`,
      "",
      ` ${help}`,
    ].join("\n");
  }

  updateHeader(): void {
    if (this.#closed) return;
    this.header.setText(this.headerText());
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
  /**
   * Paint a receipt segment (T55). The numbers get `muted`, which is 5.10:1 on the
   * surface; the labels and separators get `faint` at 3.20:1; the mark is the one
   * accent. The line used to be a single raw `dim`, which is not a palette role
   * at all, so the only record of what a turn cost was the least legible ink in
   * the transcript.
   */
  #paintReceipt(segments: ReceiptSegment[]): string {
    return segments
      .map((s) => {
        if (s.role === "value") return ansi.gray(s.text);
        if (s.role === "ok") return ansi.green(s.text);
        if (s.role === "fail") return ansi.red(s.text);
        return ansi.faint(s.text);
      })
      .join("");
  }

  /**
   * T59: what the turn did to the files, printed under the receipt.
   *
   * It arrives a frame or two after the receipt, because the workspace is read
   * with a process and the receipt must not wait for one. An empty list prints
   * nothing at all: a "changed" line with no files is noise, and a turn that
   * touched nothing is the common case.
   */
  showTurnChanges(files: readonly ChangedFile[]): void {
    if (this.#closed || files.length === 0) return;
    this.addChat(new ChangedFilesComponent(files, process.cwd()));
    this.requestRender();
  }

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
      this.addChat(new Text(this.#paintReceipt(turnReceipt({
        tools: 0, wallSec: info.wallSec, outputTokens: 0, cancelled: true, turn: this.turn,
        okMark: ascii ? "v" : "✓", cancelMark: ascii ? "-" : "·",
      })), 0, 0));
      return;
    }
    if (info.error) {
      // T55: a failed turn gets its receipt too, in rose. The turn where the
      // numbers matter most used to be the one that showed none.
      this.addChat(new Text(this.#paintReceipt(turnReceipt({
        tools: 0, wallSec: info.wallSec, outputTokens: info.outputTokens, cancelled: false,
        turn: this.turn, error: true, okMark: ascii ? "x" : "✗", cancelMark: ascii ? "-" : "·",
      })), 0, 0));
      return;
    }
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
    // T55: the receipt closes the turn the band opened, structured so the numbers
    // are readable, and on the same left edge as the prose above it (the extra
    // padding column it used to carry put it off the grid).
    this.addChat(new Text(this.#paintReceipt(turnReceipt({
      tools: info.tools.length,
      wallSec: info.wallSec,
      outputTokens: info.outputTokens,
      cancelled: false,
      turn: this.turn,
      // The cache only when the model actually reported one.
      cachePct: this.footer.state.cachePct,
      okMark: ascii ? "v" : "✓",
      cancelMark: ascii ? "-" : "·",
    })), 0, 0));
  }

  /** Transient dim (or red) notice directly above the editor for 3 s (T24.4). */
  showNotice(text: string, opts: { red?: boolean } = {}): void {
    if (this.#closed) return;
    // A question form owns the notice box while it is up. Clearing it here took
    // the form off the screen while it kept every key, so the form vanished and
    // the user's Enter went nowhere: the request never resolved.
    if (this.#confirming) {
      this.#pendingNotice = { text, red: opts.red === true };
      return;
    }
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
    if (this.#confirming) {
      this.#pendingNotice = { text, red: false, persistent: true };
      return;
    }
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
    this.#setConfirming(true);
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
        this.#setConfirming(false);
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
   * T37: `initial` starts the cursor on a row (the current route), so Enter
   * without moving keeps what is already in use.
   */
  askChoice(title: string, items: SelectItem[], opts: { initial?: number } = {}): Promise<number> {
    if (this.#closed) return Promise.resolve(-1);
    this.clearNoticeBox();
    this.#setConfirming(true);
    const titleText = new Text(ansi.yellow(title), 1, 0);
    const list = new SelectList(items, Math.max(items.length, 5), selectListTheme);
    if (opts.initial !== undefined && opts.initial >= 0 && opts.initial < items.length) {
      list.setSelectedIndex(opts.initial);
    }
    this.noticeBox.addChild(titleText);
    this.noticeBox.addChild(list);
    this.requestRender();
    return new Promise((resolve) => {
      const finish = (index: number) => {
        this.#setConfirming(false);
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
    this.#setConfirming(true);
    const form = new QuestionForm(questions);
    this.noticeBox.addChild(form);
    this.requestRender();
    return new Promise((resolve) => {
      const finish = (answers: Array<{ id: string; selected: string[]; custom?: string }> | undefined) => {
        this.#setConfirming(false);
        this.clearNoticeBox();
        this.tui.setFocus(this.editor);
        this.requestRender();
        // Whatever arrived while the form was up is shown now, not swallowed.
        const pending = this.#pendingNotice;
        this.#pendingNotice = undefined;
        resolve(answers);
        if (pending !== undefined) {
          if (pending.persistent === true) this.showPersistentNotice(pending.text);
          else this.showNotice(pending.text, { red: pending.red });
        }
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
    if (this.#headerSweep !== undefined) clearInterval(this.#headerSweep);
    this.#headerSweep = undefined;
    // T56: give the mouse back, whatever was in flight.
    this.mouse.stop();
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
