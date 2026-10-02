import type { Component } from "@earendil-works/pi-tui";
import { kumoIcons, type KumoIcons } from "../render/chars.js";
import { paint } from "./palette.js";
import { WorkingComponent, type WorkingState } from "./working.js";

interface PromptEditor {
  focused: boolean;
  borderColor: (text: string) => string;
}

/** Own the input rules and the activity row without changing editor input. */
export class PromptFrame implements Component {
  #working: WorkingComponent | undefined;
  constructor(
    private content: Component,
    private editor: PromptEditor,
    private state: () => WorkingState = () => "Working",
    private icons: KumoIcons = kumoIcons(),
    private now: () => number = Date.now,
  ) {}
  start(): void { this.#working ??= new WorkingComponent(this.now, this.icons); }
  stop(): void { this.#working = undefined; }
  get active(): boolean { return this.#working?.active === true; }
  render(width: number): string[] {
    const role = this.#working || this.editor.focused ? "lavender" : "faint";
    this.editor.borderColor = text => paint(role, this.icons.think === "*" ? text.replaceAll("─", "-").replaceAll("↑", "^").replaceAll("↓", "v") : text);
    const rows = this.content.render(width);
    if (!this.#working) return rows;
    this.#working.state = this.state();
    return [this.#working.line(width), ...rows];
  }
  handleInput(data: string): void { (this.content as Component & { handleInput?: (data: string) => void }).handleInput?.(data); }
  invalidate(): void { this.content.invalidate(); }
}
