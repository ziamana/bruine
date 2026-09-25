import {
  Container,
  Editor,
  matchesKey,
  ProcessTerminal,
  SelectList,
  Text,
  TuiMainScreen,
  type Component,
  type OverlayHandle,
  type SelectItem,
  type TUI,
  type Terminal,
} from "@earendil-works/pi-tui";
import { kumoIcons, type KumoIcons } from "../render/chars.js";
import { ansi, editorTheme, selectListTheme } from "./theme.js";
import { ChatTranscript, PlainGlyphEditor } from "./chat-layout.js";
import { FooterComponent } from "./footer.js";
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
  /** Escape: interrupt the running turn, never the app. */
  onEscape(): void;
  /** Quit request: ctrl+d, or ctrl+c twice within 500 ms. */
  onQuit(): void;
  /** Tab: toggle Plan/Build (T16.A). */
  onTab?: () => void;
  /** Shift+Tab: cycle Ask/Auto/Full (T16.B). */
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

/**
 * The kumo TUI shell (T13a), pi-tui main-screen mode: header, chat
 * transcript, bordered multi-line editor, footer. Replaces readline while a
 * terminal is attached.
 */
export class KumoUi {
  readonly tui: TUI;
  readonly terminal: Terminal;
  readonly chat: Container;
  readonly editor: Editor;
  readonly footer: FooterComponent;
  readonly icons: KumoIcons;
  readonly noticeBox: NoticeBox;
  #lastCtrlC = 0;
  #animation: ReturnType<typeof setInterval> | undefined;
  #closed = false;
  #noticeTimer: ReturnType<typeof setTimeout> | undefined;
  #persistentNotice: Component | undefined;
  #confirming = false;

  constructor(
    version: string,
    handlers: KumoUiHandlers,
    terminal?: Terminal,
    icons: KumoIcons = kumoIcons(),
  ) {
    this.icons = icons;
    this.terminal = terminal ?? new ProcessTerminal();
    this.tui = new TuiMainScreen(this.terminal);

    const header = new Text(
      `${ansi.bold(`kumo v${version}`)}\n${ansi.gray(
        "escape interrupt · ctrl+c clear · ctrl+d exit · / commands",
      )}`,
      1,
      0,
    );
    this.chat = new ChatTranscript();
    this.editor = new PlainGlyphEditor(this.tui, editorTheme);
    this.editor.onSubmit = (text) => {
      // T30: the update notice stays until the first prompt.
      if (this.#persistentNotice !== undefined) {
        this.noticeBox.removeChild(this.#persistentNotice);
        this.#persistentNotice = undefined;
      }
      handlers.onSubmit(text);
    };
    this.footer = new FooterComponent(icons);
    this.noticeBox = new NoticeBox();

    this.tui.addChild(header);
    this.tui.addChild(this.chat);
    this.tui.addChild(this.noticeBox);
    this.tui.addChild(this.editor);
    this.tui.addChild(this.footer);

    // T30: the launcher ran the 24 h registry check in the background; the
    // session only reads its cached result — never any network here, never
    // any delay.
    void this.#maybeUpdateNotice(version);

    this.tui.addInputListener((data: string) => {
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
      if (handlers.onTab !== undefined && matchesKey(data, "tab")) {
        handlers.onTab();
        this.requestRender();
        return { consume: true };
      }
      if (handlers.onShiftTab !== undefined && matchesKey(data, "shift+tab")) {
        handlers.onShiftTab();
        this.requestRender();
        return { consume: true };
      }
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
      return {};
    });
  }

  start(): void {
    this.tui.setFocus(this.editor);
    this.tui.start();
  }

  requestRender(): void {
    if (this.#closed) return;
    this.tui.requestRender();
    const active = this.chat.children.some((c) => (c as Component & { active?: boolean }).active);
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

  rememberHistory(text: string): void {
    this.editor.addToHistory(text);
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
   * A pi-tui select shown as a modal overlay (T13d). Resolves with the
   * chosen index, or -1 on cancel (escape / ctrl+c).
   */
  askChoice(title: string, items: SelectItem[]): Promise<number> {
    return new Promise((resolve) => {
      const titleText = new Text(ansi.yellow(title), 1, 0);
      const list = new SelectList(items, Math.max(items.length, 5), selectListTheme);
      const overlay: ChoiceOverlay = new ChoiceOverlay(titleText, list);
      let handle: OverlayHandle | undefined;
      const finish = (index: number) => {
        if (handle !== undefined) handle.hide();
        this.tui.setFocus(this.editor);
        this.requestRender();
        resolve(index);
      };
      list.onSelect = (item) => finish(items.indexOf(item));
      list.onCancel = () => finish(-1);
      handle = this.tui.showOverlay(overlay);
      handle.focus();
    });
  }

  /** Graceful shutdown: drain pending key-release bytes, then stop. */
  async shutdown(): Promise<void> {
    this.#closed = true;
    clearInterval(this.#animation);
    this.#animation = undefined;
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
