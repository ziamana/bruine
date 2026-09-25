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
import { FooterComponent } from "./footer.js";

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
  #lastCtrlC = 0;

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
    this.chat = new Container();
    this.editor = new Editor(this.tui, editorTheme);
    this.editor.onSubmit = (text) => handlers.onSubmit(text);
    this.footer = new FooterComponent(icons);

    this.tui.addChild(header);
    this.tui.addChild(this.chat);
    this.tui.addChild(this.editor);
    this.tui.addChild(this.footer);

    this.tui.addInputListener((data: string) => {
      if (handlers.onTab !== undefined && matchesKey(data, "tab")) {
        handlers.onTab();
        return { consume: true };
      }
      if (handlers.onShiftTab !== undefined && matchesKey(data, "shift+tab")) {
        handlers.onShiftTab();
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
    this.tui.requestRender();
  }

  addChat(component: Component): void {
    this.chat.addChild(component);
    this.requestRender();
  }

  removeChat(component: Component): void {
    this.chat.removeChild(component);
  }

  rememberHistory(text: string): void {
    this.editor.addToHistory(text);
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
    try {
      await this.terminal.drainInput(300, 50);
    } catch {
      // best effort
    }
    this.tui.stop();
  }
}
