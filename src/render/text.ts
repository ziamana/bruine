import type { Screen } from "./reasoning.js";

export class TextStream {
  #screen: Screen;
  #first = true;
  #lastChar = "";

  constructor(screen: Screen) {
    this.#screen = screen;
  }

  push(delta: string): void {
    if (delta === "") return;
    this.#first = false;
    this.#screen.write(delta);
    this.#lastChar = delta[delta.length - 1] ?? "";
  }

  end(): void {
    if (this.#first) return;
    if (this.#lastChar !== "\n") {
      this.#screen.write("\n");
    }
    this.#first = true;
    this.#lastChar = "";
  }
}
