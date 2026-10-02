/**
 * The permanent two-row KUMO wordmark. Every motion frame occupies these cells.
 *
 * C7: the mark belongs to the setup welcome now. The interactive screen says its
 * name in a line of text instead, so the only place this is drawn is the one screen
 * where the user is not reading anything yet.
 */
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
