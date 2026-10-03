import { appEnv } from "../compat.js";
import { hash01 } from "./rain.js";

/**
 * The permanent three-row BRUINE wordmark, in the `future` FIGlet font: fine heavy lines that
 * read as the word at a glance. Every motion frame occupies these cells.
 *
 * C7: the mark belongs to the setup welcome now. The interactive screen says its
 * name in a line of text instead, so the only place this is drawn is the one screen
 * where the user is not reading anything yet.
 */
export const LOGO = [
  "┏┓ ┏━┓╻ ╻╻┏┓╻┏━╸",
  "┣┻┓┣┳┛┃ ┃┃┃┗┫┣╸ ",
  "┗━┛╹┗╸┗━┛╹╹ ╹┗━╸",
] as const;
export const LOGO_STOPS = ["#7dcfff", "#b4a7ff", "#ff9ed2", "#7dcfff"] as const;

/** How long a letter cell stays wet (░ ▒ ▓) before it is the letter. */
const WET = 0.09;

/**
 * The mark's rows plus one above and one below: drops fall into the mark, each letter cell is
 * wetted where one lands and fills in, and the mark lands on its permanent rows at the end.
 *
 * The first row carries the falling streaks above the letters, the next ones the letters as they
 * fill, the last a splash under a letter that has just been reached. A cell never loses what it
 * has gained: once it is lit it stays lit, which is what makes the fill read as rain collecting.
 */
export function wordmarkFrame(phase: number): string[] {
  const time = Number.isFinite(phase) ? Math.max(0, Math.min(1, phase)) : 0;
  if (time === 1) return [...LOGO];
  const width = LOGO[0].length;
  const height = LOGO.length;
  const rows: string[][] = Array.from({ length: height + 2 }, () => Array<string>(width).fill(" "));
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const target = LOGO[row]![column]!;
      if (target === " ") continue;
      // Each cell is reached at its own moment; the lower rows a little after the upper.
      const reached = 0.14 + hash01(column, row, 11) * 0.5 + row * 0.07;
      const into = (time - reached) / WET;
      if (time < reached) {
        // A streak above the cell for the moment before the drop arrives.
        if (row === 0 && reached - time < 0.2 && (column + Math.floor(time * 40)) % 2 === 0) rows[0]![column] = "│";
        continue;
      }
      rows[row + 1]![column] = into < 1 / 3 ? "░" : into < 2 / 3 ? "▒" : into < 1 ? "▓" : target;
      if (row === height - 1 && into >= 0 && into < 0.9) rows[height + 1]![column] = into < 0.45 ? "·" : "˙";
    }
  }
  return rows.map((row) => row.join(""));
}

export function terminalMotionAllowed(opts: {
  stdoutTTY?: boolean;
  env?: NodeJS.ProcessEnv;
  ascii?: boolean;
} = {}): boolean {
  const env = opts.env ?? process.env;
  const tty = opts.stdoutTTY ?? process.stdout.isTTY === true;
  return tty && opts.ascii !== true && appEnv("ASCII", env) !== "1" && env.CI !== "1" &&
    appEnv("NO_ANIMATION", env) !== "1" && env.TERM !== "dumb";
}
