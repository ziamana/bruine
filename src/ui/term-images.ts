import { getCapabilities, setCapabilityOverrides, type ImageProtocol } from "@earendil-works/pi-tui";

/**
 * Which graphics protocol, if any, shows an image the model read.
 *
 * pi-tui recognises Kitty, Ghostty, WezTerm and Warp (kitty) and iTerm2 from their environment.
 * It does not know Konsole, which has shown inline images since 22.04: its kitty support has no
 * placeholders, so the iTerm2 protocol is the one that holds there. `BRUINE_IMAGES` decides for
 * any terminal: `kitty`, `iterm2`, or `blocks` (the coloured half-blocks every 24-bit terminal draws).
 *
 * `undefined` leaves pi-tui's own detection (and its `PI_IMAGE_PROTOCOL`) alone.
 */
export function imageProtocolFor(env: NodeJS.ProcessEnv = process.env): ImageProtocol | undefined {
  const asked = env.BRUINE_IMAGES?.trim().toLowerCase();
  if (asked === "kitty" || asked === "iterm2") return asked;
  if (asked === "blocks" || asked === "off" || asked === "none" || asked === "0") return null;
  // herdr is a multiplexer too, and it inherits the host terminal's variables (KONSOLE_VERSION,
  // KITTY_WINDOW_ID…): the picture is not passed through, and the rows it was given stay behind as
  // blank boxes while the live area is drawn again and again. Blocks, unless BRUINE_IMAGES says otherwise.
  if (env.HERDR_ENV !== undefined || env.HERDR_PANE_ID !== undefined) return null;
  // Under a multiplexer the sequences are not passed through reliably: pi-tui says no, and so do we.
  if (env.TMUX !== undefined || (env.TERM ?? "").startsWith("tmux") || (env.TERM ?? "").startsWith("screen")) return undefined;
  const konsole = Number.parseInt(env.KONSOLE_VERSION ?? "", 10);
  if (Number.isFinite(konsole) && konsole >= 220400) return "iterm2";
  return undefined;
}

/** Apply the choice before the terminal starts, so the cell size is asked for when images are on. */
export function applyImageProtocol(env: NodeJS.ProcessEnv = process.env): void {
  const protocol = imageProtocolFor(env);
  if (protocol !== undefined) setCapabilityOverrides({ images: protocol });
}

/** The protocol images are sent with now, or null when the transcript draws them in half-blocks. */
export function imageProtocol(): ImageProtocol {
  return getCapabilities().images;
}

/**
 * The rows of a rendered screen that an image covers, so nothing (the rain) draws over them.
 *
 * A kitty image is placed from the line that carries it (`r=` rows tall); an iTerm2 image is drawn
 * from its last line, after moving up over the rows above it (`ESC [ n A`).
 */
export function imageRows(lines: readonly string[]): Set<number> {
  const rows = new Set<number>();
  lines.forEach((line, at) => {
    if (line.includes("\x1b_G")) {
      const tall = Number.parseInt(/[;,]r=(\d+)/.exec(line)?.[1] ?? "1", 10);
      for (let i = 0; i < Math.max(1, tall); i += 1) rows.add(at + i);
    } else if (line.includes("\x1b]1337;File=")) {
      const up = Number.parseInt(/\x1b\[(\d+)A\x1b\]1337;File=/.exec(line)?.[1] ?? "0", 10);
      for (let i = 0; i <= up; i += 1) rows.add(at - i);
    }
  });
  return rows;
}

/**
 * Split a rendered line at the image it carries: the text before it, and the escape sequence
 * (with the cursor-up an iTerm2 image is drawn after). Undefined for a line with no image.
 *
 * The sequence carries the whole picture in base64, so it must never be measured as text,
 * clipped, or padded after: the layout paints the row first and places the image last.
 */
export function splitImageLine(line: string): { before: string; sequence: string } | undefined {
  const kitty = line.indexOf("\x1b_G");
  const iterm = /(?:\x1b\[\d+A)?\x1b\]1337;File=/.exec(line);
  const at = kitty >= 0 ? kitty : iterm?.index ?? -1;
  if (at < 0) return undefined;
  return { before: line.slice(0, at), sequence: line.slice(at) };
}
