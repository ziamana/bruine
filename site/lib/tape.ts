/** One run of cells with one style: column, text, foreground, background, flags (1 bold, 2 italic, 4 dim, 8 inverse, 16 underline). */
export type Span = [col: number, text: string, fg: string | null, bg: string | null, flags: number];

export interface Tape {
  cols: number;
  rows: number;
  fps: number;
  markers: Record<string, number>;
  /** Every distinct screen row, once. */
  rowTable: Span[][];
  /** Each frame of the recording, as indexes into rowTable. */
  frames: number[][];
  stills: Record<"retry" | "image" | "light", number[]>;
  lightBackground: string;
}

const escape = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * A row as HTML: each run is placed at its column, so a glyph the font draws a little wide or
 * narrow never pushes the rest of the row out of its cells.
 */
export function rowHtml(row: Span[]): string {
  let html = "";
  for (const [col, text, fg, bg, flags] of row) {
    const [ink, ground] = flags & 8 ? [bg ?? "var(--term-bg)", fg ?? "var(--term-fg)"] : [fg, bg];
    if (!text.trim() && !ground) continue;
    const style = [`left:${col}ch`, `width:${[...text].length}ch`, ink ? `color:${ink}` : "", ground ? `background:${ground}` : ""].filter(Boolean).join(";");
    const cls = [flags & 1 ? "b" : "", flags & 2 ? "i" : "", flags & 4 ? "d" : "", flags & 16 ? "u" : ""].filter(Boolean).join(" ");
    html += `<span style="${style}"${cls ? ` class="${cls}"` : ""}>${escape(text)}</span>`;
  }
  return html;
}

/** Draws screens into a fixed set of row elements, touching only the rows that changed. */
export class Screen {
  #rows: HTMLElement[];
  #shown: number[];
  #cache = new Map<number, string>();

  constructor(
    host: HTMLElement,
    private readonly tape: Tape,
  ) {
    host.replaceChildren();
    this.#rows = Array.from({ length: tape.rows }, () => {
      const row = document.createElement("div");
      row.className = "term-row";
      host.append(row);
      return row;
    });
    this.#shown = Array(tape.rows).fill(-1);
  }

  draw(rows: number[]): void {
    for (let y = 0; y < this.#rows.length; y += 1) {
      const id = rows[y] ?? 0;
      if (this.#shown[y] === id) continue;
      let html = this.#cache.get(id);
      if (html === undefined) {
        html = rowHtml(this.tape.rowTable[id] ?? []);
        this.#cache.set(id, html);
      }
      this.#rows[y]!.innerHTML = html;
      this.#shown[y] = id;
    }
  }

  frameAt(seconds: number): number[] {
    const i = Math.max(0, Math.min(this.tape.frames.length - 1, Math.round(seconds * this.tape.fps)));
    return this.tape.frames[i]!;
  }
}

/** Phones get the same session recorded at 56 columns, so the text stays readable. */
export const NARROW = "(max-width: 860px)";

const loading = new Map<string, Promise<Tape>>();
/** The recording, fetched once per width however many windows play it. */
export function loadTape(url: string): Promise<Tape> {
  let tape = loading.get(url);
  if (!tape) {
    tape = fetch(url).then((r) => r.json() as Promise<Tape>);
    loading.set(url, tape);
  }
  return tape;
}
