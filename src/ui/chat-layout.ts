import { Container, Editor, truncateToWidth } from "@earendil-works/pi-tui";
import { withoutEmoji } from "../render/chars.js";

/** Own block spacing/padding once, without changing the model's transcript. */
export class ChatTranscript extends Container {
  render(width: number): string[] {
    const inner = Math.max(1, width - 4);
    const lines: string[] = [];
    for (const child of this.children) {
      const block = child.render(inner);
      if (!block.length) continue;
      lines.push("");
      for (const line of block) lines.push(truncateToWidth(`  ${withoutEmoji(line)}`, width));
    }
    return lines;
  }
}

/** Keep user content intact internally while applying the same display policy. */
export class PlainGlyphEditor extends Editor {
  render(width: number): string[] { return super.render(width).map(withoutEmoji); }
}
