import { stripTerminalSequences, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { kumoIcons, isAscii, asciiText, type KumoIcons } from "../render/chars.js";
import { paint } from "./palette.js";
import { WorkingComponent } from "./working.js";
import { Box } from "./box.js";

import { TurnActivity } from "./turn-activity.js";

interface PromptEditor {
  focused: boolean;
  borderColor: (text: string) => string;
  readonly frameBottomRow?: number;
}

/** Own the input rules and their activity label without changing editor input. */
export class PromptFrame implements Component {
  #working: WorkingComponent;
  #role: "lavender" | "faint" | undefined;
  constructor(
    private content: Component,
    private editor: PromptEditor,
    readonly activity: TurnActivity = new TurnActivity(),
    private icons: KumoIcons = kumoIcons(),
  ) {
    this.#working = new WorkingComponent(Date.now, icons, activity);
    activity.subscribe(() => this.updateBorder());
    this.updateBorder();
  }
  get focused(): boolean { return this.editor.focused; }
  set focused(value: boolean) { this.editor.focused = value; this.updateBorder(); }
  get active(): boolean { return this.activity.active && this.#working.active; }
  private updateBorder(): void {
    const role = this.activity.active || this.editor.focused ? "lavender" : "faint";
    if (role === this.#role) return;
    this.#role = role;
    this.editor.borderColor = text => paint(role, asciiText(text, isAscii(this.icons), "editor"));
  }
  render(width: number): string[] {
    const ascii = isAscii(this.icons);
    const framed = width >= 12;
    const rows = this.content.render(framed ? width - 4 : width);
    if (!rows.length) return rows;
    if (!framed) return this.activity.active && width >= 7
      ? [this.activityRule(rows[0]!, width, ascii), ...rows.slice(1)] : rows;
    const bottom = this.editor.frameBottomRow ?? rows.length - 1;
    if (bottom < 1) return rows;
    const ink = (text: string): string => paint(this.#role ?? "faint", text);
    const box = new Box(width, { ascii, ink });
    const { tl, tr, bl, br, h } = box.glyphs;
    const top = this.activity.active
      ? `${ink(tl)}${this.activityRule(rows[0]!, width - 2, ascii)}${ink(tr)}`
      : `${ink(tl + h)}${rows[0]}${ink(h + tr)}`;
    const lower = `${ink(bl + h)}${rows[bottom]}${ink(h + br)}`;
    return [top, ...rows.slice(1, bottom).map(row => box.row(row)), lower,
      ...rows.slice(bottom + 1).map(row => `  ${row}`)];
  }
  private activityRule(original: string, width: number, ascii: boolean): string {
    const rule = ascii ? "-" : "─";
    const scroll = /[↑^] \d+ more/.exec(stripTerminalSequences(original))?.[0];
    const budget = Math.max(1, width - 6);
    const suffix = scroll ? truncateToWidth(`  ${scroll}`, Math.max(0, budget - 4), ascii ? "..." : "…") : "";
    const room = Math.max(1, budget - visibleWidth(suffix));
    const label = truncateToWidth(this.#working.label(), room, ascii ? "..." : "…");
    const caption = label + paint("muted", suffix);
    const rest = Math.max(0, width - visibleWidth(caption) - 4);
    return `${paint("lavender", rule.repeat(2))} ${caption} ${paint("lavender", rule.repeat(rest))}`;
  }
  handleInput(data: string): void { this.content.handleInput?.(data); }
  invalidate(): void { this.content.invalidate(); }
}
