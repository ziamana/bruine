export interface Screen {
  write(s: string): void;
  columns: number;
}

export function dim(s: string): string {
  return `\x1b[2m${s}\x1b[22m`;
}

export function visible(s: string, columns: number): string {
  let text = s.replace(/^ +/, "");
  const max = columns - 4;
  if (text.length > max) {
    text = `…${text.slice(-(columns - 5))}`;
  }
  return text;
}

const CLEAR = "\r\x1b[2K";

export class ReasoningLine {
  #screen: Screen;
  #now: () => number;
  #active = false;
  #current = "";
  #lastFinished = "";
  #startTime = 0;

  constructor(screen: Screen, now: () => number = Date.now) {
    this.#screen = screen;
    this.#now = now;
  }

  get active(): boolean {
    return this.#active;
  }

  push(delta: string): void {
    if (delta === "") return;

    if (!this.#active) {
      this.#active = true;
      this.#startTime = this.#now();
      this.#current = "";
      this.#lastFinished = "";
    }

    const nl = delta.lastIndexOf("\n");
    if (nl !== -1) {
      const finished = this.#current + delta.slice(0, nl);
      const finishedTrimmed = finished.replace(/^ +/, "");
      if (finishedTrimmed !== "") this.#lastFinished = finishedTrimmed;
      this.#current = delta.slice(nl + 1);
    } else {
      this.#current += delta;
    }

    // Right after a "\n" the next line has not started yet: keep showing the
    // finished line (no blank flicker) until new text arrives.
    const show = this.#current !== "" ? this.#current : this.#lastFinished;
    if (show === "") return;

    this.#screen.write(CLEAR + dim(`💭 ${visible(show, this.#screen.columns)}`));
  }

  end(): void {
    if (!this.#active) return;
    const seconds = (this.#now() - this.#startTime) / 1000;
    this.#screen.write(
      CLEAR + dim(`💭 thought for ${seconds.toFixed(1)}s`) + "\n",
    );
    this.#active = false;
    this.#current = "";
    this.#lastFinished = "";
  }
}
