import { appEnv } from "../compat.js";
import { stripTerminalSequences, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { bruineIcons, isAscii, asciiText, type BruineIcons } from "../render/chars.js";
import { paint } from "./palette.js";
import { WorkingComponent } from "./working.js";
import { currentEffortName, rippleFrame } from "./rain.js";
import { glowDrawable, glowMode, tintBorder, type GlowMode } from "./border-glow.js";
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
    private icons: BruineIcons = bruineIcons(),
    private readonly clock: () => number = Date.now,
  ) {
    this.#working = new WorkingComponent(Date.now, icons, activity);
    activity.subscribe(() => this.updateBorder());
    this.updateBorder();
  }
  get focused(): boolean { return this.editor.focused; }
  set focused(value: boolean) { this.editor.focused = value; this.updateBorder(); }
  get active(): boolean { return (this.activity.active && this.#working.active) || this.#ripple() !== undefined || this.#glow() !== undefined; }
  /**
   * How hard the model is asked to think shows on the frame: a slow violet at `high`, a fast one at
   * `xhigh`, every colour at `max`. Undefined when there is nothing to show or no way to show it
   * (no motion, ASCII, a terminal that cannot blend colours, `BRUINE_NO_GLOW=1`, or a frame nobody
   * is looking at).
   */
  #glow(): { mode: Exclude<GlowMode, "off">; time: number } | undefined {
    if (!this.#working.active || isAscii(this.icons) || process.env.BRUINE_NO_GLOW === "1") return undefined;
    if (!this.activity.active && !this.editor.focused) return undefined;
    const mode = glowMode(currentEffortName());
    if (mode === "off" || !glowDrawable()) return undefined;
    return { mode, time: this.clock() };
  }
  /**
   * The ring a finished turn leaves on the rule, for a second: a drop landed. It needs the same
   * motion the spinner needs (`BRUINE_NO_RIPPLE=1` turns this one off alone), and it keeps the
   * repaint loop alive only while it is showing.
   */
  #ripple(): string | undefined {
    if (this.activity.active || !this.#working.active || appEnv("NO_RIPPLE") === "1") return undefined;
    const since = this.activity.sinceStop;
    return since === undefined ? undefined : rippleFrame(since, isAscii(this.icons));
  }
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
    const ripple = this.#ripple();
    if (!framed) return (this.activity.active || ripple !== undefined) && width >= 7
      ? [this.activityRule(rows[0]!, width, ascii, ripple), ...rows.slice(1)] : rows;
    const bottom = this.editor.frameBottomRow ?? rows.length - 1;
    if (bottom < 1) return rows;
    const ink = (text: string): string => paint(this.#role ?? "faint", text);
    const box = new Box(width, { ascii, ink });
    const { tl, tr, bl, br, h } = box.glyphs;
    const top = this.activity.active || ripple !== undefined
      ? `${ink(tl)}${this.activityRule(rows[0]!, width - 2, ascii, ripple)}${ink(tr)}`
      : `${ink(tl + h)}${rows[0]}${ink(h + tr)}`;
    const lower = `${ink(bl + h)}${rows[bottom]}${ink(h + br)}`;
    const glow = this.#glow();
    const tint = (line: string, kind: "edges" | "all"): string => (glow === undefined ? line : tintBorder(line, kind, glow.mode, glow.time));
    return [tint(top, "all"), ...rows.slice(1, bottom).map(row => tint(box.row(row), "edges")), tint(lower, "all"),
      ...rows.slice(bottom + 1).map(row => `  ${row}`)];
  }
  private activityRule(original: string, width: number, ascii: boolean, ripple?: string): string {
    const rule = ascii ? "-" : "─";
    const scroll = /[↑^] \d+ more/.exec(stripTerminalSequences(original))?.[0];
    const budget = Math.max(1, width - 6);
    const suffix = scroll ? truncateToWidth(`  ${scroll}`, Math.max(0, budget - 4), ascii ? "..." : "…") : "";
    const room = Math.max(1, budget - visibleWidth(suffix));
    const label = truncateToWidth(ripple !== undefined ? paint("lavender", ripple) : this.#working.label(), room, ascii ? "..." : "…");
    const caption = label + paint("muted", suffix);
    const rest = Math.max(0, width - visibleWidth(caption) - 4);
    return `${paint("lavender", rule.repeat(2))} ${caption} ${paint("lavender", rule.repeat(rest))}`;
  }
  handleInput(data: string): void { this.content.handleInput?.(data); }
  invalidate(): void { this.content.invalidate(); }
}
