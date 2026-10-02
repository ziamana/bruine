/** The permanent two-row KUMO wordmark. Every motion frame occupies these cells. */
export const LOGO = ["█▄▀ █ █ █▀▄▀█ █▀█", "█ █ █▄█ █ ▀ █ █▄█"] as const;
export const LOGO_STOPS = ["#7dcfff", "#b4a7ff", "#ff9ed2", "#7dcfff"] as const;

/** A four-row fall and fold that lands on the permanent two-row mark. */
export function wordmarkFrame(phase: number): string[] {
  const time = Number.isFinite(phase) ? Math.max(0, Math.min(1, phase)) : 0;
  if (time === 1) return [...LOGO];
  const width = LOGO[0].length;
  const rows: string[][] = Array.from({ length: 4 }, () => Array<string>(width).fill(" "));

  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const target = LOGO[row % 2]![column]!;
      if (target === " ") continue;
      if (time < 0.75) {
        // Staggered vertical traces make the fall readable while every lit
        // subline remains in place until the fold begins.
        const first = 0.025 + row * 0.073 + ((column * 5 + row * 3) % 11) * 0.012;
        if (time < first) continue;
        const topFirst = (column + row) % 2 === 0;
        const second = 0.46 + ((column * 3 + row * 7) % 10) * 0.028;
        rows[row]![column] = time >= second ? "█" : topFirst ? "▀" : "▄";
        continue;
      }

      const fold = (time - 0.75) / 0.25;
      const columnDelay = ((column * 3 + row * 5) % 7) / 35;
      if (row < 2) {
        if (fold < 0.22 + row * 0.22 + columnDelay) rows[row]![column] = "█";
      } else {
        rows[row]![column] = fold >= 0.38 + columnDelay ? LOGO[row - 2]![column]! : "█";
      }
    }
  }
  return rows.map((row) => row.join(""));
}

/** The unlit half of the mark: the same block material, at a fifth of the ink. */
const GHOST = "░";
/** The cell just behind the head, so the wave has a shoulder and not an edge. */
const SHOULDER = "▓";

/**
 * How far the lit head has travelled, in cells. An exponential ease-out from a
 * seed that is already lit, and deliberately short of the end: while the
 * session is still unknown the tail stays ghosted, because a loading mark that
 * reaches 100% on a clock is telling the user a thing nobody has established.
 */
export function litCells(phase: number): number {
  const time = Number.isFinite(phase) ? Math.max(0, Math.min(1, phase)) : 0;
  return Math.round((0.1 + 0.82 * (1 - Math.exp(-3.4 * time))) * LOGO[0].length);
}

/**
 * The mark being written: the whole wordmark stays legible from the first frame
 * as a ghost, and light travels left to right through it. Two rows, no extra
 * furniture, and the frame a user watches is already the frame the session
 * header keeps once the boot is over.
 */
export function ignitionFrame(phase: number): string[] {
  const head = litCells(phase) - 1;
  return LOGO.map((line) =>
    [...line]
      .map((glyph, column) => {
        if (glyph === " ") return glyph;
        if (column > head + 1) return GHOST;
        return column === head + 1 ? SHOULDER : glyph;
      })
      .join(""),
  );
}

/** A small echo of the same material while the model has not replied yet. */
export const WAITING_FRAMES = ["░   ", "▒░  ", "▓▒░ ", "█▓▒░", " ▓█▒", "  ▒▓", "   ░"] as const;

export function terminalMotionAllowed(opts: {
  stdoutTTY?: boolean;
  env?: NodeJS.ProcessEnv;
  ascii?: boolean;
} = {}): boolean {
  const env = opts.env ?? process.env;
  const tty = opts.stdoutTTY ?? process.stdout.isTTY === true;
  return tty && opts.ascii !== true && env.KUMO_ASCII !== "1" && env.CI !== "1" &&
    env.KUMO_NO_ANIMATION !== "1" && env.TERM !== "dumb";
}
