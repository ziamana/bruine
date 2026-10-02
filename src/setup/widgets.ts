import { isAscii } from "../render/chars.js";
/**
 * The setup wizard's own widgets (T53): the fields a step is built from, with
 * no knowledge of the flow. They filter as you type, mask secrets, and never
 * own a file — the wizard decides what a Save writes.
 */
import {
  SelectList,
  isKeyRelease,
  matchesKey,
  type Component,
  type SelectItem,
  type SelectListLayoutOptions,
  visibleWidth,
  truncateToWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { ansi, selectListTheme } from "../ui/theme.js";
import { dropLastChar, typedText } from "../ui/keys.js";

/** Shorten a plain string to `width` cells, marking the cut with an ellipsis. */
export function fitPlain(value: string, width: number): string {
  if (visibleWidth(value) <= width) return value;
  if (width <= 0) return "";
  let result = "";
  let cells = 0;
  for (const char of value) {
    const size = visibleWidth(char);
    if (cells + size > width - 1) break;
    result += char;
    cells += size;
  }
  return `${result}…`;
}

/** One-line text input; secret mode masks every typed char with `*`. */
export class LineInput implements Component {
  onSubmit?: (value: string) => void;
  #value = "";
  #done = false;
  constructor(
    private readonly prompt: string,
    private readonly secret: boolean,
  ) {}
  render(width: number): string[] {
    const shown = this.secret ? "*".repeat([...this.#value].length) : this.#value;
    const line = `${ansi.yellow(this.prompt)}${shown}`;
    return wrapTextWithAnsi(line, Math.max(1, width));
  }
  invalidate(): void {}
  handleInput(data: string): void {
    if (this.#done) return;
    // T60: the kitty protocol turns a typed letter into `CSI 115 u`, and the
    // guard below dropped every one of them: this field accepted nothing at all
    // on a terminal with the protocol on.
    if (isKeyRelease(data)) return;
    if (matchesKey(data, "backspace")) {
      this.#value = dropLastChar(this.#value);
      return;
    }
    if (matchesKey(data, "enter")) {
      this.#done = true;
      this.onSubmit?.(this.#value);
      return;
    }
    this.#value += typedText(data);
  }
}

/** Filter a display label while retaining the original item used by the flow. */
export class SetupFilterList implements Component {
  onSelect?: (item: SelectItem) => void;
  onSelectionChange?: (item: SelectItem) => void;
  #filter = "";
  #filtering = false;
  #list: SelectList;
  #visible: SelectItem[];
  constructor(private items: SelectItem[], private maxVisible = 10, private layout?: SelectListLayoutOptions) {
    this.#visible = items;
    this.#list = this.makeList(items);
  }
  get filtering(): boolean { return this.#filtering; }
  getSelectedItem(): SelectItem | null { return this.#list.getSelectedItem(); }
  setSelectedIndex(index: number): void { this.#list.setSelectedIndex(Math.max(0, this.#visible.indexOf(this.items[index]!))); }
  setHeight(rows: number): void {
    const limit = Math.max(1, rows - 1);
    if (limit !== this.maxVisible) { this.maxVisible = limit; this.refresh(); }
  }
  private makeList(items: SelectItem[]): SelectList {
    const list = new SelectList(items, this.maxVisible, { ...selectListTheme, noMatch: () => ansi.gray("No matching options") }, this.layout);
    list.onSelect = item => this.onSelect?.(item);
    list.onSelectionChange = item => this.onSelectionChange?.(item);
    return list;
  }
  private refresh(): void {
    const selected = this.getSelectedItem();
    const query = this.#filter.toLocaleLowerCase();
    this.#visible = this.items.filter(item => `${item.label} ${item.description ?? ""}`.toLocaleLowerCase().includes(query));
    this.#list = this.makeList(this.#visible);
    if (selected) this.#list.setSelectedIndex(Math.max(0, this.#visible.indexOf(selected)));
    const next = this.getSelectedItem();
    if (next) this.onSelectionChange?.(next);
  }
  clearFilter(): boolean {
    if (!this.#filtering) return false;
    this.#filter = ""; this.#filtering = false; this.refresh(); return true;
  }
  render(width: number): string[] {
    const caption = this.#filtering ? `Filter: ${this.#filter}_` : "Filter: type to filter";
    return [truncateToWidth(ansi.gray(caption), width), ...this.#list.render(width)];
  }
  handleInput(data: string): void {
    if (isKeyRelease(data)) return;
    if (matchesKey(data, "escape")) { this.clearFilter(); return; }
    if (matchesKey(data, "backspace")) { this.#filter = dropLastChar(this.#filter); this.refresh(); return; }
    const typed = typedText(data);
    if (typed) {
      if (!this.#filtering && typed === "/") this.#filtering = true;
      else { this.#filtering = true; this.#filter += typed; this.refresh(); }
      return;
    }
    if (this.#visible.length) this.#list.handleInput(data);
  }
  invalidate(): void { this.#list.invalidate(); }
}

/** A CheckList row: `disabled` rows are group headers — no box, not toggleable. */
export interface CheckItem {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

/** Space toggles checkboxes, Enter confirms. */
export class CheckList implements Component {
  #filter = "";
  #filtering = false;
  onDone?: (indices: number[]) => void;
  onSkip?: () => void;
  #cursor = 0;
  #top = 0;
  constructor(
    private readonly items: CheckItem[],
    readonly checked: Set<number>,
    private maxVisible = 10,
  ) {
    this.#cursor = this.#nearest(0, 1) ?? 0;
  }
  get filtering(): boolean { return this.#filtering; }
  setHeight(rows: number): void { this.maxVisible = Math.max(1, rows - 1); }
  clearFilter(): boolean {
    if (!this.#filtering) return false;
    this.#filter = ""; this.#filtering = false; this.#top = 0; return true;
  }
  #matches(item: CheckItem): boolean {
    return `${item.label} ${item.description ?? ""}`.toLocaleLowerCase().includes(this.#filter.toLocaleLowerCase());
  }
  #visible(): number[] {
    if (!this.#filter) return this.items.map((_, i) => i);
    const found = new Set<number>();
    let group: number | undefined;
    this.items.forEach((item, i) => {
      if (item.disabled) { group = i; return; }
      if (this.#matches(item)) { if (group !== undefined) found.add(group); found.add(i); }
    });
    return [...found];
  }
  /** Search in original indices: a filtered-out check remains selected. */
  #nearest(from: number, dir: number): number | undefined {
    for (let i = from; i >= 0 && i < this.items.length; i += dir) {
      if (this.items[i]?.disabled !== true && this.#matches(this.items[i]!)) return i;
    }
    return undefined;
  }
  render(width: number): string[] {
    const visible = this.#visible();
    const cursor = visible.indexOf(this.#cursor);
    if (cursor < this.#top) this.#top = Math.max(0, cursor);
    if (cursor >= this.#top + this.maxVisible) this.#top = cursor - this.maxVisible + 1;
    const lines = [truncateToWidth(ansi.gray(this.#filtering ? `Filter: ${this.#filter}_` : "Filter: type to filter"), width)];
    if (!visible.length) return [...lines, ansi.gray("No matching skills")];
    for (const i of visible.slice(this.#top, this.#top + this.maxVisible)) {
      const item = this.items[i]!;
      const text = item.description ? `${item.label}  ·  ${item.description}` : item.label;
      if (item.disabled) { lines.push(truncateToWidth(ansi.bold(ansi.gray(`  ${text}`)), width)); continue; }
      const mark = this.checked.has(i) ? "[x] " : "[ ] ";
      const arrow = isAscii() ? "> " : "→ ";
      const prefix = i === this.#cursor ? ansi.cyan(arrow) : "  ";
      lines.push(truncateToWidth(`${prefix}${mark}${text}`, width));
    }
    return lines;
  }
  invalidate(): void {}
  handleInput(data: string): void {
    if (isKeyRelease(data)) return;
    // T35: `s` skips the whole step (keep current), same as the Skip item. T60:
    // read through the decoder, so the shortcut survives the kitty protocol.
    const typed = typedText(data).toLowerCase();
    if (!this.#filtering && typed === "s") {
      this.onSkip?.();
      return;
    }
    if (matchesKey(data, "escape")) { this.clearFilter(); return; }
    if (matchesKey(data, "backspace")) {
      this.#filter = dropLastChar(this.#filter);
      this.#cursor = this.#nearest(0, 1) ?? this.#cursor;
      this.#top = 0; return;
    }
    if (typed && !matchesKey(data, "space")) {
      if (!this.#filtering && typed === "/") this.#filtering = true;
      else {
        this.#filtering = true; this.#filter += typed;
        this.#cursor = this.#nearest(0, 1) ?? this.#cursor;
        this.#top = 0;
      }
      return;
    }
    if (matchesKey(data, "up")) {
      this.#cursor = this.#nearest(this.#cursor - 1, -1) ?? this.#cursor;
      return;
    }
    if (matchesKey(data, "down")) {
      this.#cursor = this.#nearest(this.#cursor + 1, 1) ?? this.#cursor;
      return;
    }
    if (matchesKey(data, "space")) {
      const item = this.items[this.#cursor];
      if (!item || item.disabled === true || !this.#matches(item)) return;
      if (this.checked.has(this.#cursor)) this.checked.delete(this.#cursor);
      else this.checked.add(this.#cursor);
      return;
    }
    if (matchesKey(data, "enter")) {
      this.onDone?.([...this.checked].sort((a, b) => a - b));
    }
  }
}

export interface SetupSummaryRow { label: string; value: string; }

/** A compact two-column review with enough room left for the Save action. */
export class SetupSummary implements Component {
  constructor(private rows: SetupSummaryRow[], private destination: string) {}
  render(width: number): string[] {
    const labelWidth = Math.min(12, Math.max(1, Math.floor(width * 0.42)));
    const valueWidth = Math.max(1, width - labelWidth - 1);
    const lines = this.rows.map(row => `${ansi.gray(truncateToWidth(row.label, labelWidth).padEnd(labelWidth))} ${ansi.text(truncateToWidth(row.value, valueWidth))}`);
    return [...lines, "", ansi.gray(truncateToWidth(`Save to ${this.destination}`, width)), ...wrapTextWithAnsi(ansi.gray("settings.yaml · kumo.json · .env · skills/"), Math.max(1, width))];
  }
  invalidate(): void {}
}