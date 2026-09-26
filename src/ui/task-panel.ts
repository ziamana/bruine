import type { Component } from "@earendil-works/pi-tui";
import { clipCells, spinnerFrame } from "../render/reasoning.js";
import { withoutEmoji, type KumoIcons } from "../render/chars.js";
import { ansi } from "./theme.js";

export const TASKS_HELP = "ctrl+t  show all tasks";

export type TaskStatus = "pending" | "in_progress" | "completed";
export interface TaskItem {
  content: string;
  status: TaskStatus;
}

function safeText(value: string): string {
  return withoutEmoji(value).replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(/\s+/g, " ").trim();
}

/** Read a dsh todo/write payload without trusting tool-produced display text. */
export function taskItems(raw: unknown): TaskItem[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const items: TaskItem[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") return undefined;
    const value = item as { content?: unknown; status?: unknown };
    if (typeof value.content !== "string" || !["pending", "in_progress", "completed"].includes(String(value.status))) return undefined;
    items.push({ content: safeText(value.content), status: value.status as TaskStatus });
  }
  return items;
}

/** The live task list; all writes replace the preceding snapshot. */
export class TaskPanel implements Component {
  tasks: TaskItem[] = [];
  expanded = false;

  constructor(private readonly icons: KumoIcons, private readonly now: () => number = Date.now) {}

  get active(): boolean {
    return this.visible && this.tasks.some((item) => item.status === "in_progress");
  }

  get visible(): boolean {
    return this.tasks.some((item) => item.status !== "completed");
  }

  get done(): number {
    return this.tasks.filter((item) => item.status === "completed").length;
  }

  /** Return a completion count only when an open list just became complete. */
  setTasks(tasks: TaskItem[]): number | undefined {
    const wasOpen = this.visible;
    this.tasks = tasks.map((item) => ({ ...item, content: safeText(item.content) }));
    return wasOpen && tasks.length > 0 && !this.visible ? tasks.length : undefined;
  }

  clearTasks(): void {
    this.tasks = [];
    this.expanded = false;
  }

  toggleExpanded(): void {
    this.expanded = !this.expanded;
  }

  private selectedIndexes(): number[] {
    if (this.expanded || this.tasks.length <= 6) return this.tasks.map((_, i) => i);
    const active = this.tasks.flatMap((item, i) => item.status === "in_progress" ? [i] : []);
    const anchors = active.length > 0 ? active : [this.tasks.findIndex((item) => item.status === "pending")];
    const ranked = this.tasks.map((_, i) => ({ i, distance: Math.min(...anchors.map((a) => Math.abs(i - a))) }));
    ranked.sort((a, b) => a.distance - b.distance || a.i - b.i);
    return ranked.slice(0, 5).map(({ i }) => i).sort((a, b) => a - b);
  }

  /** Plain text snapshot for pipes: one block per todo/write, no animation. */
  plainLines(): string[] {
    if (this.tasks.length === 0) return [];
    return [`Tasks ${this.done}/${this.tasks.length}`, ...this.tasks.map((item) => {
      const mark = item.status === "completed" ? this.icons.ok : item.status === "pending" ? (this.icons.think === "*" ? "o" : "○") : (this.icons.think === "*" ? "*" : "✻");
      return `${mark} ${item.content}`;
    })];
  }

  render(width: number): string[] {
    if (!this.visible) return [];
    const available = Math.max(1, width - 4);
    const indexes = this.selectedIndexes();
    const lines = [`  ${ansi.bold(`Tasks  ${this.done}/${this.tasks.length}`)}`];
    for (const i of indexes) {
      const item = this.tasks[i]!;
      const mark = item.status === "completed" ? ansi.green(this.icons.ok)
        : item.status === "in_progress" ? ansi.bold(spinnerFrame(this.now(), this.icons))
          : (this.icons.think === "*" ? "o" : "○");
      const content = clipCells(item.content, Math.max(1, available - 2));
      lines.push(`  ${mark} ${item.status === "completed" ? ansi.dim(content) : item.status === "in_progress" ? ansi.bold(content) : content}`);
    }
    if (indexes.length < this.tasks.length) {
      lines.push(`  ${ansi.dim(`… ${this.tasks.length - indexes.length} more`)}`);
    }
    return lines;
  }

  invalidate(): void {}
}
