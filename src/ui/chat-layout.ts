import { Container, Editor, truncateToWidth } from "@earendil-works/pi-tui";
import { kumoIcons, withoutEmoji, type KumoIcons } from "../render/chars.js";
import { ansi } from "./theme.js";

/** Collapse thresholds matching pi-tui Editor (T27.5): >10 lines or >1000 chars. */
export function pasteChip(text: string): string | undefined {
  const lines = text.split("\n").length;
  if (lines > 10) return ansi.chip(`[Pasted ${String(lines)} lines]`);
  if (text.length > 1000) return ansi.chip(`[Pasted ${String(text.length)} chars]`);
  return undefined;
}

/** Render pi-tui paste markers as chips: `[paste #1 +22 lines]` → `[Pasted 22 lines]`. */
export function chipMarkers(line: string): string {
  return line
    .replace(/\[paste #\d+ \+(\d+) lines\]/g, (_, n) => ansi.chip(`[Pasted ${String(n)} lines]`))
    .replace(/\[paste #\d+ (\d+) chars\]/g, (_, n) => ansi.chip(`[Pasted ${String(n)} chars]`));
}

/** Own block spacing/padding once, without changing the model's transcript. */
export class ChatTranscript extends Container {
  constructor(private icons: KumoIcons = kumoIcons()) {
    super();
  }
  render(width: number): string[] {
    const inner = Math.max(1, width - 4);
    const lines: string[] = [];
    const railChar = this.icons.think === "*" ? "|" : "│";
    for (const child of this.children) {
      const block = child.render(inner);
      if (!block.length) continue;
      const rail = (child as { rail?: "blue" | "red" }).rail;
      lines.push("");
      for (const line of block) {
        const clean = withoutEmoji(line);
        if (rail === undefined) {
          lines.push(truncateToWidth(`  ${clean}`, width));
        } else {
          const colored = rail === "red" ? ansi.red(railChar) : ansi.blue(railChar);
          lines.push(truncateToWidth(`  ${colored} ${clean}`, width));
        }
      }
    }
    return lines;
  }
}

/** Keep user content intact internally while applying the same display policy. */
export class PlainGlyphEditor extends Editor {
  render(width: number): string[] {
    return super.render(width).map((line) => chipMarkers(withoutEmoji(line)));
  }
}
