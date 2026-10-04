import { appEnv, runtimeHome, configReadPath } from "../compat.js";
import { parse as parseYaml } from "yaml";
import {
  Container,
  Editor,
  matchesKey,
  ProcessTerminal,
  SelectList,
  Spacer,
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
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { bruineIcons, type BruineIcons } from "../render/chars.js";
import { ansi, editorTheme, selectListTheme } from "./theme.js";
import { bgEnabled, colorDepth, paint, setTerminalBackdrop, type PaletteRole } from "./palette.js";
import { ChatTranscript, Gap, Margin, PlainGlyphEditor } from "./chat-layout.js";
import { FooterComponent } from "./footer.js";
import { displayModel } from "./footer.js";
import { JumpToLatest } from "./jump-latest.js";
import { readInstalledSkills } from "../setup/skills.js";
import { Shell } from "./shell.js";
import { echoLine, QuestionForm } from "./questions.js";
import type { QuestionCallComponent } from "./question-call-component.js";
import type { ReasoningComponent } from "./reasoning-component.js";
import { PromptFrame } from "./prompt-frame.js";
import type { SilenceProbe } from "./working.js";
import { withEscapeFilter } from "./escape-filter.js";
import { besideLogo, LOGO_BESIDE_GAP, LOGO_MIN_WIDTH, logoRows, paintResourceLine, planResourceLine } from "./header.js";
import { terminalMotionAllowed } from "./logo-motion.js";
import { IntroPlayer, introSetting, planIntro, readLastIntro, rememberIntro } from "./intro.js";
import { TurnActivity } from "./turn-activity.js";
import { WeatherBackdrop, readWeatherEffect, type WeatherEffect } from "./weather-effect.js";
import { QueuedPrompts } from "./queued-prompts.js";
import { ApprovalBand } from "./approval-band.js";
import { TaskPanel, type TaskItem } from "./task-panel.js";
import { createAutocomplete } from "./file-complete.js";
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
  newerVersion,
  pendingUpdateCheck,
  formatUpdateNotice,
  readBruineJsonDoc,
  readUpdateCache,
  resolveDshHome,
  updateCheckEnabled,
} from "../update.js";

export interface BruineUiHandlers {
  /** Enter on the editor (or the equivalent submit). */
  onSubmit(text: string): void;
  /** User typed or sent (for aborting background suggestion). */
  onUserActivity?: () => void;
  /** Escape: interrupt the running turn, never the app. */
  onEscape(): void;
  /** Quit request: ctrl+d, or ctrl+c on an empty editor. */
  onQuit(): void;
  /** Shift+Tab: toggle Plan/Build (T31.4). */
  onShiftTab?: () => void;
  /** Up on an empty input box while prompts are queued: the last one, taken out of the queue to edit. */
  onQueueEdit?: () => string | undefined;
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

/** What the banner says is loaded: the real skills and plugins of this session. */
export interface SessionResources {
  skills?: readonly string[];
  plugins?: readonly string[];
}

/** Columns of margin the header component keeps on each side; the layout is made for what is left. */
const HEADER_MARGIN = 1;

/** The keys the help line names, in the order a first session meets them. */
const HELP_KEYS: ReadonlyArray<readonly [string, string]> = [
  ["escape", "interrupt"],
  ["ctrl+c", "clear"],
  ["ctrl+d", "exit"],
  ["/", "commands"],
];

/** How a key is written when there is no room for its full spelling. */
const SHORT_KEYS: Record<string, string> = { escape: "esc", "ctrl+c": "^c", "ctrl+d": "^d" };

/**
 * The help line, from the longest reading that fits to the shortest.
 *
 * The keys are the part a first session cannot do without, so they are the last to
 * go: the labels ("interrupt", "clear", "exit") are dropped before a key is
 * abbreviated, and a key is abbreviated before any of them is dropped. A line that
 * does not fit is cut by the terminal into two rows, which would move the banner
 * under itself — the one thing a fixed frame must not do.
 */
/** Cells the key line takes with every label written out. */
export function helpLineCells(sep = "\u00b7"): number {
  return (
    HELP_KEYS.reduce((n, [key, label]) => n + visibleWidth(key) + 1 + visibleWidth(label), 0) + (HELP_KEYS.length - 1) * (sep.length + 2)
  );
}

export function helpLineParts(width: number, sep = "\u00b7"): Array<[string, string | undefined]> {
  const keys = HELP_KEYS.map(([key, label]) => [key, label] as [string, string]);
  const bare = HELP_KEYS.map(([key]) => [key, undefined] as [string, undefined]);
  const short = HELP_KEYS.map(([key]) => [SHORT_KEYS[key] ?? key, undefined] as [string, undefined]);
  const cells = (row: Array<[string, string | undefined]>): number =>
    row.reduce((n, [key, label]) => n + visibleWidth(key) + (label === undefined ? 0 : visibleWidth(label) + 1), 0) +
    (row.length - 1) * (sep.length + 2);
  for (const row of [keys, bare, short]) if (cells(row) <= width) return row.map(([k, l]) => [k, l] as [string, string | undefined]);
  return short.map(([k, l]) => [k, l] as [string, string | undefined]);
}

/**
 * The plugin entry points bruine itself declares.
 *
 * dsh mounts a bundle by its package exports, so this map IS the list of bruine's
 * plugins: an export that is not a module (`./cordis.patch.yml`, `./package.json`)
 * is configuration, not a plugin, and is left out by the rule rather than by name.
 * Read from the package that is running, so it cannot drift from the code.
 */
export function readBruinePlugins(): string[] {
  try {
    const raw = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
      exports?: Record<string, string>;
    };
    return Object.entries(raw.exports ?? {})
      .filter(([, target]) => typeof target === "string" && target.endsWith(".js"))
      .map(([name]) => name.replace(/^\.\//, ""))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/** Notice area directly above the editor (T24.4): one empty line when idle. */
class NoticeBox extends Container {
  override render(width: number): string[] {
    if (this.children.length === 0) return [""];
    return super.render(width);
  }
}

/** The server or provider a route talks to, for the header: a host, else a provider name. */
export function headerHost(
  bruineJson?: { models?: { main?: { baseUrl?: string; provider?: string } } },
  fallbackProvider?: string,
): string {
  const main = bruineJson?.models?.main;
  if (typeof main?.baseUrl === "string" && main.baseUrl !== "") {
    try {
      const url = new URL(main.baseUrl);
      return loopbackLabel(url) ?? url.hostname;
    } catch {
      // fall through
    }
  }
  if (typeof main?.provider === "string" && main.provider !== "") return main.provider;
  if (typeof fallbackProvider === "string" && fallbackProvider !== "") return fallbackProvider;
  return "?";
}

export function readBruineJsonForHeader(dshHome?: string): {
  models?: { main?: { baseUrl?: string; provider?: string; model?: string; name?: string; contextWindow?: number } };
} | undefined {
  try {
    const home = dshHome ?? runtimeHome();
    const p = configReadPath(home);
    if (!existsSync(p)) return undefined;
    return JSON.parse(readFileSync(p, "utf8")) as {
      models?: { main?: { baseUrl?: string; provider?: string; model?: string; name?: string; contextWindow?: number } };
    };
  } catch {
    return undefined;
  }
}

/**
 * What the header and the cockpit call the server: the address for a machine on your
 * own network (it tells you which box), the provider's display name for a cloud API
 * (a 45-character host like token-plan.ap-southeast-1.maas.aliyuncs.com says nothing).
 */
/** A loopback address says nothing a person reads; the port says which server: `localhost:8080`. */
export function loopbackLabel(url: URL): string | undefined {
  if (!/^(127\.\d+\.\d+\.\d+|localhost|\[::1\])$/.test(url.hostname)) return undefined;
  return url.port === "" ? "localhost" : `localhost:${url.port}`;
}

export function serverLabel(hostname: string, displayName?: string): string {
  const h = hostname.toLowerCase();
  const local =
    h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".lan") ||
    /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h) || h === "::1" || !h.includes(".");
  if (local) return hostname;
  if (displayName !== undefined && displayName.trim() !== "") return displayName.trim();
  // Registrable-looking tail: the last two labels (aliyuncs.com, openrouter.ai).
  return h.split(".").slice(-2).join(".");
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

/** One `llm-pi-ai.providers` entry as bruine needs to show it (T37). */
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
 * server swaps its loaded model without bruine knowing).
 */
export function readSettingsProviders(dshHome?: string): SettingsProvider[] {
  try {
    const home = dshHome ?? runtimeHome();
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

/** settings.yaml reader: default route + baseURL/name/window (real YAML parser; the hand-written one broke on bruine's own list style). */
export function readSettingsRoute(dshHome?: string): SettingsRoute | undefined {
  try {
    const home = dshHome ?? runtimeHome();
    const p = join(home, "settings.yaml");
    if (!existsSync(p)) return undefined;
    const doc = parseBruineSettingsYaml(readFileSync(p, "utf8"));
    if (doc === undefined) return undefined;
    return doc;
  } catch {
    return undefined;
  }
}

function parseBruineSettingsYaml(text: string): SettingsRoute | undefined {
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
 * The bruine TUI shell (T13a), pi-tui main-screen mode: header, chat
 * transcript, bordered multi-line editor, footer. Replaces readline while a
 * terminal is attached.
 */
export class BruineUi {
  readonly tui: TUI;
  readonly terminal: Terminal;
  readonly chat: ChatTranscript;
  readonly editor: PlainGlyphEditor;
  readonly footer: FooterComponent;
  readonly icons: BruineIcons;
  /** The frame: header, a scrollable transcript, and the band pinned under it. */
  readonly shell: Shell;
  /** D5: the one control under a held window, and the way back to the live edge. */
  readonly jumpLatest: JumpToLatest;
  /**
   * T56: the mouse. Drag to select, release to copy. It owns the gesture, the
   * clipboard, and the one terminal sequence nobody else writes, so all this
   * class does is hand it a chunk and paint what comes back.
   */
  readonly mouse: MouseFeature;
  readonly noticeBox: NoticeBox;
  /** The prompts typed during a turn, waiting for it to end. */
  readonly queued: QueuedPrompts;
  readonly taskPanel: TaskPanel;
  readonly promptFrame: PromptFrame;
  readonly activity = new TurnActivity();
  readonly weather: WeatherBackdrop;
  #animatedComponents = new Set<Component>();
  readonly header: Text;
  readonly version: string;
  /** T29: the images the `[Image N]` chips in the editor stand for. */
  readonly pendingImages = new PendingImages();
  #animation: ReturnType<typeof setInterval> | undefined;
  /** The logo's entrance in the banner, while it plays. */
  #intro: IntroPlayer | undefined;
  #closed = false;
  #noticeTimer: ReturnType<typeof setTimeout> | undefined;
  #persistentNotice: Component | undefined;
  /** A notice that arrived while a question form owned the box. */
  #pendingNotice: { text: string; red: boolean; persistent?: boolean } | undefined;
  #confirming = false;
  /** The banner's lists, read once at startup (see `#loadResources`). */
  #resources: { skills: string[]; plugins: string[] } = { skills: [], plugins: [] };
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
    handlers: BruineUiHandlers,
    terminal?: Terminal,
    icons: BruineIcons = bruineIcons(),
  ) {
    this.icons = icons;
    this.terminal = terminal ?? withEscapeFilter(new ProcessTerminal());
    this.tui = new TuiMainScreen(this.terminal);
    this.version = version;

    this.header = new Text("", 1, 0);
    this.chat = new ChatTranscript(icons);
    this.editor = new PlainGlyphEditor(this.tui, editorTheme);
    this.editor.onSubmit = (text) => {
      // A prompt is a decision to go on, so the transcript goes back to the live edge
      // with it: the answer is about to be written at the bottom of the screen.
      this.shell.toEnd();
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
    this.queued = new QueuedPrompts(icons);
    try {
      // T28b.1: settings.yaml is the source of truth; bruine.json only a fallback.
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
        const doc = readBruineJsonForHeader();
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
    this.jumpLatest = new JumpToLatest(icons);
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
      scroll: (rows) => this.scrollTranscript(rows),
      // D5: a press on the pill is a press on a control, not the start of a
      // selection. D6: so is a press on a thought that has ended. The frame is
      // composed here, so the hit test is asked here — the same reason the
      // selection's text is read here — and the pressed point goes along with it,
      // because one control now answers for two different things.
      control: {
        hit: (row, col) => this.#hitControl(row, col),
        activate: (row, col) => this.#activateControl(row, col),
      },
    });
    // C6: no cockpit. The readings live in the status bar under the editor, and a
    // side panel that says the same three numbers was a second place to keep them
    // honest. The prompt frame wraps the editor itself.
    // The editor is both what the frame draws and the thing it reads focus from:
    // there is no panel between them any more.
    this.promptFrame = new PromptFrame(this.editor, this.editor, this.activity, icons);
    // The editor, the place and the footer share one margin. The shell
    // owns the order so the transcript can be windowed: scrolled back, the band
    // below it has to stay on the last row, and only the layout knows that.
    // The bottom zone keeps the terminal's own background — the editor is framed by
    // its two rules and the status bar is plain text under it, so nothing there is a
    // painted slab.
    const bottomZones = new Container();
    bottomZones.addChild(this.queued);
    bottomZones.addChild(this.promptFrame);
    bottomZones.addChild(this.footer);
    this.shell = new Shell(
      // One blank row above the wordmark: the screen opens with air over the mark
      // instead of the mark against the top edge of the terminal.
      [new Spacer(1), this.header],
      this.chat,
      // One blank row above every block that is showing: the task panel, and the
      // notice box (the approval list, a notice, the question form) which used to
      // sit glued under the last thing the transcript said. Same rhythm as the
      // task panel above it, and nothing at all when the box is empty.
      [new Margin(new Gap(this.taskPanel)), new Margin(new Gap(this.noticeBox)), new Margin(bottomZones)],
      () => this.terminal.rows,
      this.jumpLatest,
    );
    this.weather = new WeatherBackdrop(this.shell, readWeatherEffect(runtimeHome()), {
      busy: () => this.activity.active,
      rows: () => this.terminal.rows,
      decorateRows: () => this.shell.weatherRows,
      // A selection in progress, or an approval: the one still moment means "you decide".
      paused: () => this.mouse.span !== undefined || this.activity.held,
      allowed: () => this.terminal.columns >= 12 && terminalMotionAllowed({ ascii: this.icons.think === "*" }) && colorDepth() !== "none" && appEnv("NO_RAIN") !== "1",
    });
    this.#layer.addChild(this.weather);
    this.tui.addChild(this.#layer);

    // T30: the launcher ran the 24 h registry check in the background; the
    // session only reads its cached result — never any network here, never
    // any delay.
    void this.#maybeUpdateNotice(version);

    // The banner's `[Skills]` / `[Plugins]` lists, read once, in the background:
    // the first frame must not wait on a manifest.
    void this.#loadResources();

    this.tui.addInputListener((data: string) => this.#onInput(data, handlers));
  }

  #onInput(data: string, handlers: BruineUiHandlers): ReturnType<TuiInputListener> {
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
  #onKey(data: string, handlers: BruineUiHandlers): ReturnType<TuiInputListener> {
    // A key is the user taking over: the logo is whole at once, and the key goes on to do its work.
    this.#intro?.skip();
    // T60: "the user typed something" is a question about the encoding, and
    // under the kitty protocol a letter is an escape sequence. Reading it as
    // bytes meant a background suggestion was never dismissed by typing.
    if (data.includes("\x1b[200~") || typedText(data) !== "") {
      handlers.onUserActivity?.();
    }
    // alt+v too: Windows Terminal keeps ctrl+v for its own text paste, and with only an image on
    // the clipboard it sends nothing at all, so ctrl+v never reaches bruine there.
    if ((matchesKey(data, "ctrl+v") || matchesKey(data, "alt+v")) && !this.#confirming) {
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
    if (matchesKey(data, "ctrl+o")) {
      if (this.#confirming) return { consume: true };
      this.#toolsCollapsed = !this.#toolsCollapsed;
      this.applyToolsCollapsed();
      this.requestRender();
      return { consume: true };
    }
    // PageUp/PageDown move the transcript window instead of the cursor. The editor
    // only ever used them to walk a multi-line buffer, and the cost of taking them
    // is a paste of a thousand lines; the cost of leaving them is that the one key
    // a reader reaches for scrolls the composer out of sight.
    if (!this.#confirming && (matchesKey(data, "pageUp") || matchesKey(data, "ctrl+pageUp"))) {
      this.scrollTranscript(this.#pageRows());
      return { consume: true };
    }
    if (!this.#confirming && (matchesKey(data, "pageDown") || matchesKey(data, "ctrl+pageDown"))) {
      this.scrollTranscript(-this.#pageRows());
      return { consume: true };
    }
    // End only means "follow the live edge" while the window is away from it; at
    // the live edge it is the editor's own "go to end of line".
    if (this.shell.scrolled && (matchesKey(data, "end") || matchesKey(data, "ctrl+end"))) {
      this.shell.toEnd();
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
      // Escape means "stop, and take me back to what is happening".
      if (this.shell.scrolled) this.shell.toEnd();
      handlers.onEscape();
      return { consume: true };
    }
    if (matchesKey(data, "ctrl+c")) {
      // With text in the editor, ctrl+c only clears it. With nothing to clear it
      // quits, the way ctrl+d does: the same key never does both in one press.
      if (this.editor.getText() !== "") {
        this.editor.setText("");
        this.requestRender();
      } else {
        handlers.onQuit();
      }
      return { consume: true };
    }
    if (matchesKey(data, "ctrl+d")) {
      if (this.editor.getText() === "") {
        handlers.onQuit();
        return { consume: true };
      }
    }
    // Up on an empty box while prompts wait: the last one comes back to be edited (and, sent
    // again, it queues again). Without a queue, up is the editor's own history.
    if (matchesKey(data, "up") && this.editor.getText() === "" && this.queued.items.length > 0) {
      const text = handlers.onQueueEdit?.();
      if (text !== undefined) {
        this.editor.setText(text);
        this.requestRender();
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
    const lines = this.weather.withoutWeather(() => this.tui.render(this.terminal.columns));
    return selectedText(lines, viewportTop(lines.length, this.terminal.rows), span);
  }

  /**
   * D5: is this point the jump-to-latest pill?
   *
   * Read out of the composed frame rather than from a row the pill remembers: the
   * frame is taller than the screen, so the row the pill was drawn on is not the
   * row it sits on, and only the frame knows which one that is.
   */
  #hitJumpLatest(row: number, col: number): boolean {
    const lines = this.tui.render(this.terminal.columns);
    return this.jumpLatest.hitTest(lines, viewportTop(lines.length, this.terminal.rows), row, col);
  }

  /**
   * D6: the clickable transcript block under this point, if any.
   *
   * A screen row is not a transcript row: the header sits above the transcript and
   * a held window replaces it with a slice of the document. So the row is mapped
   * through the shell that composed the frame, and the transcript is asked which
   * of its blocks owns the row that comes out.
   */
  #clickableAt(row: number): (Component & { click?: () => void }) | undefined {
    const lines = this.tui.render(this.terminal.columns);
    const at = this.shell.transcriptRowAt(row + viewportTop(lines.length, this.terminal.rows));
    return at === undefined ? undefined : (this.chat.hitTest(at) as (Component & { click?: () => void }) | undefined);
  }

  /** Is this point a control? The pill first, then whatever in the transcript claims a press. */
  #hitControl(row: number, col: number): boolean {
    if (this.#hitJumpLatest(row, col)) return true;
    return this.#clickableAt(row) !== undefined;
  }

  /** Run the control that owns the press, asked in the same order as the hit test. */
  #activateControl(row: number, col: number): void {
    const target = this.#clickableAt(row);
    if (target?.click !== undefined) {
      target.click();
      this.requestRender();
      return;
    }
    this.shell.toEnd();
    this.requestRender();
  }

  /**
   * Move the transcript window, positive towards the live edge.
   *
   * The page is the terminal minus the band, so a page is what fits: scrolling by
   * any other amount either repeats rows or skips them.
   */
  #pageRows(): number {
    return Math.max(1, this.terminal.rows - 7);
  }

  /**
   * The one door onto the window, for the keys and the wheel.
   *
   * Positive goes away from the live edge, which is the direction a wheel reports as
   * positive too, so the wheel needs no arithmetic of its own. It repaints even when
   * the window did not move, so a wheel that has reached the end still says so by
   * drawing rather than by doing nothing.
   */
  scrollTranscript(rows: number): void {
    this.shell.scrollBy(rows);
    this.requestRender();
  }

  start(): void {
    this.tui.setFocus(this.promptFrame);
    // A launch takes the whole terminal: what the shell printed before (a system
    // banner, the last command's output) is cleared from view, and bruine starts at the
    // top. Only the visible screen; the scrollback is the user's. BRUINE_NO_CLEAR=1,
    // CI and a pipe keep the terminal exactly as it was.
    if (process.stdout.isTTY === true && process.env.CI !== "1" && appEnv("NO_CLEAR") !== "1") {
      this.terminal.clearScreen();
    }
    this.tui.start();
    // T56: ask for the mouse, so a drag can be seen and copied. BRUINE_MOUSE_SELECT=0
    // and a form both keep the terminal's.
    this.mouse.start();
    void this.probeBackdrop();
    this.#startIntro();
  }

  /**
   * The logo comes in with an effect, in the banner, while the prompt is already usable.
   * Only where motion is allowed and the banner has room for the mark; `BRUINE_INTRO=off`
   * (or `"intro": "off"` in the config) keeps it still, and `BRUINE_INTRO=<effect>` pins one.
   */
  #startIntro(): void {
    if (this.#closed || this.#intro !== undefined) return;
    if (!terminalMotionAllowed() || this.icons.think === "*") return;
    if (this.terminal.columns - HEADER_MARGIN * 2 < LOGO_MIN_WIDTH) return;
    const home = runtimeHome();
    const setting = introSetting(home);
    if (setting === "off" || setting === "none" || setting === "0") return;
    const plan = planIntro({ pick: setting, last: readLastIntro(home) });
    const first = plan.steps[0]?.effect?.id;
    if (first !== undefined) rememberIntro(home, first);
    this.#intro = new IntroPlayer(plan, () => this.requestRender());
    this.#intro.start();
  }

  /** What the banner's mark is drawing: an entrance in progress, or the mark itself. */
  get introPlaying(): boolean {
    return this.#intro?.active === true;
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
    for (const component of this.#animatedComponents) {
      if (!("active" in component) || !component.active) this.#animatedComponents.delete(component);
    }
    const active = this.weather.active || this.promptFrame.active || this.taskPanel.active || this.footer.active || this.#animatedComponents.size > 0;
    if (active && this.#animation === undefined) {
      this.#animation = setInterval(() => this.requestRender(), 100);
      this.#animation.unref();
    } else if (!active && this.#animation !== undefined) {
      clearInterval(this.#animation);
      this.#animation = undefined;
    }
  }

  /** Components cross independently bundled plugins; use their stable display marker. */
  private isReasoning(component: Component): component is Component & Pick<ReasoningComponent, "active" | "onActivityChange"> {
    return "transcriptStyle" in component && component.transcriptStyle === "reasoning";
  }

  addChat(component: Component): void {
    this.chat.addChild(component);
    if ("active" in component) this.#animatedComponents.add(component);
    if (this.isReasoning(component)) {
      component.onActivityChange = active => {
        if (active) this.#animatedComponents.add(component);
        else this.#animatedComponents.delete(component);
        if (this.activity.active && this.activity.state !== "Waiting for model") this.activity.setState(active ? "Thinking" : "Working");
        this.requestRender();
      };
      if (component.active && this.activity.active && this.activity.state !== "Waiting for model") this.activity.setState("Thinking");
    }
    this.requestRender();
  }

  /**
   * The user's prompt opens a turn, so the shell numbers it (T55 P1b) — for the
   * receipt that closes the turn, not for a label on the prompt. The band used to
   * carry a right-aligned `turn N` above the question, which was one more thing
   * to read before the thing that was actually asked, and a number that said
   * nothing the transcript does not already show.
   */
  addUserPrompt(text: string): void {
    this.#turn += 1;
    this.addChat(userMessageComponent(text));
  }

  /** How many turns this session has run. */
  get turn(): number {
    return this.#turn;
  }

  removeChat(component: Component): void {
    this.chat.removeChild(component);
    if (this.isReasoning(component)) component.onActivityChange = undefined;
    this.#animatedComponents.delete(component);
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

  /** Show the prompts waiting for the running turn (an empty list hides the block). */
  setQueued(items: readonly string[]): void {
    this.queued.set(items);
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
    // "@" files work with or without the fd binary (fallback walker in file-complete.ts).
    this.editor.setAutocompleteProvider(createAutocomplete(commands, process.cwd()));
    this.editor.setAutocompleteMaxVisible(10);
  }

  /** Fresh conversation view (T31.2): empty chat, no groups, no ghost/notice. */
  clearChat(): void {
    if (this.#closed) return;
    this.activity.stop();
    this.chat.clear();
    for (const component of this.#animatedComponents) {
      if (this.isReasoning(component)) component.onActivityChange = undefined;
    }
    this.#animatedComponents.clear();
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

  /** Show the waiting state immediately on submit; content advances the activity. */
  /** Where the working label reads how long the model has been quiet (bruine-silence). */
  setSilenceProbe(probe: SilenceProbe | undefined): void {
    this.promptFrame.silence = probe;
  }

  showWorking(): void {
    if (this.#closed) return;
    this.footer.beginTurn();
    this.activity.start("Waiting for model");
    this.requestRender();
  }

  /**
   * T37: the route changed under us, so the memoized header host is stale.
   * The vision answer is keyed by route and re-probes on its own.
   */
  /**
   * `/reload`: re-read what the terminal and `settings.yaml` say, in place, and
   * redraw. It is deliberately not a code reload: the modules are already loaded,
   * so a change in `src/` still needs a build and a restart. What it does cover is
   * everything bruine memoized at startup and would otherwise show stale for the
   * whole session: the route behind the status bar, and the painted surfaces (the
   * terminal background, re-probed with OSC 11).
   *
   * The route is never swapped from here. The agent is bound to the route it
   * started on, and a header that advertised a route the session is not on would
   * be a lie; a moved route is reported instead, with the command that does move.
   */
  async reload(): Promise<ReloadReport> {
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

  /**
   * The banner: the wordmark with the version and the server beside it, the way out
   * under that, then what is loaded.
   *
   * The mark is three rows and stays still: it is the same on every frame and every
   * terminal that can draw it, and it gives the first screen its identity without a
   * sweep or a boot sequence. Beside it, row one names the build and where the model
   * is served, row two is the key line. Under a blank row, skills and plugins are one
   * line each, a label and the names that fit with the rest counted, and the command
   * that lists them all. The route is the status bar's, not the banner's.
   *
   * Without room for the mark (under about forty-five columns), or on an ASCII
   * terminal, the same two facts are two plain lines.
   */
  headerText(width = this.terminal.columns - HEADER_MARGIN * 2): string {
    const ascii = this.icons.think === "*";
    const sep = ascii ? "-" : "\u00b7";
    const keys = (room: number): string =>
      helpLineParts(room, sep)
        .map(([key, label]) =>
          label === undefined ? this.#ink("text")(key) : `${this.#ink("text")(key)} ${this.#ink("muted")(label)}`,
        )
        .join(this.#ink("faint")(` ${sep} `));
    const rows: string[] = [];
    if (!ascii && width >= LOGO_MIN_WIDTH) {
      const [top, middle, bottom] = this.#intro?.rows() ?? logoRows();
      const version = this.#ink("text")(`v${this.version}`);
      if (besideLogo(width) >= helpLineCells(sep)) {
        rows.push(`${top}${LOGO_BESIDE_GAP}${version}${this.#hostCell(sep)}`, `${middle}${LOGO_BESIDE_GAP}${keys(besideLogo(width))}`, bottom);
      } else {
        // Not enough room to keep the key labels next to the mark: the mark keeps the
        // build and the host, and the key line takes the full width under it.
        rows.push(`${top}${LOGO_BESIDE_GAP}${version}`, `${middle}${LOGO_BESIDE_GAP}${this.#hostName()}`, bottom, keys(width));
      }
    } else {
      const mark = ascii ? "|" : "\u258c";
      rows.push(`${this.#ink("sky")(mark)} ${this.#ink("text")("bruine")} ${this.#ink("muted")(`v${this.version}`)}${this.#hostCell(sep)}`, keys(width));
    }
    const lineSep = ascii ? " - " : " \u00b7 ";
    const ellipsis = ascii ? "..." : "\u2026";
    const ink = { label: this.#ink("lavender"), name: this.#ink("muted"), chrome: this.#ink("faint") };
    const resources = [
      planResourceLine("skills", this.#resources.skills, width, { hint: "/skills", sep: lineSep, ellipsis }),
      // bruine's own plugins are how it is built, not something to read on every start:
      // they are counted, and their names are one command away.
      planResourceLine("plugins", this.#resources.plugins.length === 0 ? [] : [`${String(this.#resources.plugins.length)} loaded`], width, { hint: "/plugins", sep: lineSep, ellipsis }),
    ].flatMap((plan) => (plan === undefined ? [] : [paintResourceLine(plan, width, ink, lineSep)]));
    // The blank row is what makes the lines read as a list rather than as more
    // chrome: the eye needs a gap to change register.
    if (resources.length > 0) rows.push("", ...resources);
    // Whatever the host is called, a row never wraps the banner onto another line.
    return rows.map((row) => truncateToWidth(row, width)).join("\n");
  }

  /** Paint in a palette role, unless the terminal cannot read colour. */
  #ink(role: PaletteRole): (s: string) => string {
    return this.icons.think === "*" ? (s) => s : (s) => paint(role, s);
  }

  /**
   * What the session loaded, told once and drawn many times.
   *
   * The startup load reads the real sources (the skills manifest bruine wrote, the
   * plugin entry points of the package that is running); a caller that knows better
   * — a plugin mounting something extra — replaces the list it owns.
   */
  /** The plugins this session loaded, for /plugins: the header only counts them. */
  get pluginNames(): readonly string[] {
    return this.#resources.plugins;
  }

  setResources(next: SessionResources): void {
    if (next.skills !== undefined) this.#resources.skills = [...next.skills];
    if (next.plugins !== undefined) this.#resources.plugins = [...next.plugins];
    this.requestRender();
  }

  /**
   * The banner's list, read once at startup and never during a render.
   *
   * A render happens on every keystroke; reading a manifest there is how a header
   * becomes the slowest thing in the app. Both sources are best effort: a profile
   * with no skills, or a package that cannot be read, simply has no section.
   */
  async #loadResources(): Promise<void> {
    const plugins = readBruinePlugins();
    let skills: string[] = [];
    try {
      const home = runtimeHome();
      skills = (await readInstalledSkills(join(home, "skills"))).map((entry) => entry.name);
    } catch {
      skills = [];
    }
    if (plugins.length === 0 && skills.length === 0) return;
    this.#resources = { plugins, skills };
    this.requestRender();
  }

  updateHeader(): void {
    if (this.#closed) return;
    this.header.setText(this.headerText());
  }

  /** The host or provider of the live route, read once: the header is repainted often. */
  #cachedHost: string | undefined;

  #host(): string {
    if (this.#cachedHost === undefined) {
      let host: string | undefined;
      try {
        const route = readSettingsRoute();
        if (route?.baseUrl !== undefined && route.baseUrl !== "") {
          const url = new URL(route.baseUrl);
          host = loopbackLabel(url) ?? serverLabel(url.hostname, route.providerDisplayName);
        } else if (route?.provider !== undefined && route.provider !== "" && route.provider !== "local") {
          host = route.provider;
        }
      } catch {
        host = undefined;
      }
      this.#cachedHost = host ?? headerHost(readBruineJsonForHeader(), this.footer.state.provider);
    }
    return this.#cachedHost;
  }

  /** The host or provider alone, muted, for the row where it has the mark to itself. */
  #hostName(): string {
    const host = this.#host();
    return host === "" || host === "?" ? "" : this.#ink("muted")(host);
  }

  /** `  ·  127.0.0.1`: where the model is served, so the first screen says which server answers. */
  #hostCell(sep: string): string {
    const host = this.#host();
    return host === "" || host === "?" ? "" : `  ${this.#ink("faint")(sep)}  ${this.#ink("muted")(host)}`;
  }

  /** T37: the route changed under us, so the memoized header host is stale. */
  resetRouteCache(): void {
    this.#cachedHost = undefined;
    this.updateHeader();
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
   * Paint a receipt segment. The numbers are `text` (12.14:1 on the surface), the
   * words that name them `muted` (5.10:1), the separators `faint` (3.20:1), and the
   * mark is the one accent.
   *
   * The line is the most important text a turn prints, and it is mostly separators
   * and unit words: painting those as low as possible left the whole receipt reading
   * as the palest thing on screen, with the numbers one step above it. It used to be
   * worse, a single raw `dim`, which is not a palette role at all.
   */
  #paintReceipt(segments: ReceiptSegment[]): string {
    return segments
      .map((s) => {
        if (s.role === "value") return ansi.text(s.text);
        if (s.role === "sep") return ansi.faint(s.text);
        if (s.role === "ok") return ansi.green(s.text);
        if (s.role === "fail") return ansi.red(s.text);
        return ansi.gray(s.text);
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
    this.activity.stop();
    this.footer.endTurn();
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
      const doc = await readBruineJsonDoc(home);
      // The TUI shell only exists on an interactive terminal, so the TTY
      // gate was already passed by the launcher.
      if (!updateCheckEnabled({ doc, isTTY: true })) return;
      // What the cache already knew; otherwise the launch's check, the moment it answers.
      let text = noticeForStartup({ cache: await readUpdateCache(home), current: version });
      if (text === undefined) {
        const latest = newerVersion(await pendingUpdateCheck(), version);
        if (latest !== undefined) text = formatUpdateNotice(latest, version);
      }
      if (text !== undefined && !this.#closed) {
        this.showPersistentNotice(text);
        this.requestRender();
      }
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
      ansi.red("Enable full access? bruine will run commands and edit files without asking."),
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
        this.tui.setFocus(this.promptFrame);
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
  get effect(): WeatherEffect { return this.weather.effect; }

  setEffect(effect: WeatherEffect): void {
    this.weather.effect = effect;
    this.requestRender();
  }

  askChoice(
    title: string,
    items: SelectItem[],
    opts: { initial?: number; preview?: (index: number) => void; keys?: readonly string[] } = {},
  ): Promise<number> {
    if (this.#closed) return Promise.resolve(-1);
    if (opts.keys !== undefined && opts.keys.length === items.length) return this.#askApproval(title, items, opts.keys);
    this.clearNoticeBox();
    this.#setConfirming(true);
    const titleText = new Text(ansi.yellow(title), 1, 0);
    const list = new SelectList(items, Math.max(items.length, 5), selectListTheme);
    if (opts.initial !== undefined && opts.initial >= 0 && opts.initial < items.length) {
      list.setSelectedIndex(opts.initial);
    }
    list.onSelectionChange = (item) => opts.preview?.(items.indexOf(item));
    this.noticeBox.addChild(titleText);
    this.noticeBox.addChild(list);
    this.requestRender();
    return new Promise((resolve) => {
      const finish = (index: number) => {
        this.#setConfirming(false);
        this.clearNoticeBox();
        this.tui.setFocus(this.promptFrame);
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
   * An approval: the turn is waiting on the person, so it says so everywhere at once. The
   * band is the one framed amber block, the prompt box steps back, the turn's clock stops,
   * the rain stops, and the queue's own key hints leave the screen to the band's.
   */
  #askApproval(title: string, items: SelectItem[], keys: readonly string[]): Promise<number> {
    this.clearNoticeBox();
    this.#setConfirming(true);
    const band = new ApprovalBand(title, items.map((item, i) => ({ key: keys[i]!, label: item.label })), this.icons);
    this.noticeBox.addChild(band);
    this.activity.hold();
    this.queued.quiet = true;
    this.requestRender();
    return new Promise((resolve) => {
      const finish = (index: number) => {
        this.queued.quiet = false;
        this.activity.release();
        this.#setConfirming(false);
        this.clearNoticeBox();
        this.tui.setFocus(this.promptFrame);
        this.requestRender();
        resolve(index);
      };
      band.onSelect = (index) => finish(index);
      band.onCancel = () => finish(-1);
      this.tui.setFocus(band);
      this.requestRender();
    });
  }

  /** The question call in the chat that the next form answers; one is open at a time. */
  #questionCall: QuestionCallComponent | undefined;

  /** Draw the model's question call and remember it: the form's answers settle it. */
  addQuestionCall(call: QuestionCallComponent): void {
    this.#questionCall = call;
    this.addChat(call);
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
    const form = new QuestionForm(questions, this.icons, this.version);
    this.noticeBox.addChild(form);
    this.requestRender();
    return new Promise((resolve) => {
      const finish = (answers: Array<{ id: string; selected: string[]; custom?: string }> | undefined) => {
        this.#setConfirming(false);
        this.clearNoticeBox();
        this.tui.setFocus(this.promptFrame);
        const resolved = answers ?? questions.map((q) => ({ id: q.id, selected: [], custom: "skipped by the user" }));
        if (this.#questionCall !== undefined) this.#questionCall.answer(resolved);
        else {
          // No call was drawn for these questions (an agent whose stream this UI is
          // not showing): the record of what was asked and chosen is one line each.
          for (const a of resolved) {
            const q = questions.find((qq) => qq.id === a.id);
            if (q !== undefined) this.addChat(new Text(ansi.dim(echoLine(q.question, a.selected[0] ?? a.custom ?? "skipped")), 1, 0));
          }
        }
        this.#questionCall = undefined;
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
    this.#intro?.skip();
    clearInterval(this.#animation);
    this.#animation = undefined;
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
