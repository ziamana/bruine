import { gradientStops } from "./palette.js";
import { readSettingsRoute } from "./kumo-ui.js";
import {
  ASSEMBLY_STEPS,
  condensationFrame,
  LOGO_STOPS,
  terminalMotionAllowed,
  wordmarkFrame,
} from "./logo-motion.js";

interface BootOutput {
  write(text: string): unknown;
  isTTY?: boolean;
  columns?: number;
  rows?: number;
}

export interface BootRoute {
  model: string;
  host: string;
}

const DURATION_MS = 900;
const DELAY_MS = 250;
const FRAME_MS = 32;
const SYNC_START = "\x1b[?2026h";
const SYNC_END = "\x1b[?2026l";

/** Owns the terminal only until the interactive TUI acknowledges the handoff. */
export class BootLoader {
  #delay: ReturnType<typeof setTimeout> | undefined;
  #tick: ReturnType<typeof setInterval> | undefined;
  #started = 0;
  #hasStarted = false;
  #lastAttempt = 0;
  #lastLines: string[] = [];
  #shown = false;
  #stopped = false;
  #skipped = false;
  #spawned = false;
  #route: BootRoute | undefined;
  #ready = false;
  #cursorHidden = false;
  readonly enabled: boolean;
  readonly animated: boolean;

  constructor(
    private readonly output: BootOutput = process.stdout,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    this.enabled = output.isTTY === true;
    this.animated = terminalMotionAllowed({ stdoutTTY: output.isTTY, env });
  }

  start(): void {
    if (!this.enabled || this.#hasStarted || this.#stopped) return;
    this.#hasStarted = true;
    this.#started = Date.now();
    this.#delay = setTimeout(() => {
      this.#delay = undefined;
      this.#draw();
      if (!this.animated || this.#skipped || this.#stopped || this.#compact()) return;
      this.#lastAttempt = Date.now();
      this.#tick = setInterval(() => {
        const elapsed = Date.now() - this.#lastAttempt;
        if (elapsed < FRAME_MS) return;
        this.#lastAttempt += Math.floor(elapsed / FRAME_MS) * FRAME_MS;
        this.#draw();
        if (this.#phase() >= 1) this.#stopTick();
      }, 16);
      this.#tick.unref?.();
    }, DELAY_MS);
    this.#delay.unref?.();
    process.on("SIGWINCH", this.#onResize);
  }

  /** Called only after spawn returned a child process. */
  processSpawned(): void {
    if (this.#stopped) return;
    this.#spawned = true;
    if (this.#shown) this.#draw();
  }

  /** Called only with the route reported by the ready child. */
  processReady(route?: BootRoute): void {
    if (this.#stopped) return;
    this.#ready = true;
    this.#route = route;
    if (this.#shown) this.#draw();
  }

  /** A key lands the mark immediately and ends the animation loop. */
  skip(): void {
    if (this.#stopped || !this.animated) return;
    this.#skipped = true;
    this.#stopTick();
    if (this.#shown) this.#draw();
  }

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    if (this.#delay !== undefined) clearTimeout(this.#delay);
    this.#delay = undefined;
    this.#stopTick();
    process.off("SIGWINCH", this.#onResize);
    if (!this.#shown) return;
    const up = this.#lastLines.length - 1;
    let clear = SYNC_START;
    for (let row = this.#lastLines.length - 1; row >= 0; row -= 1) {
      clear += "\r\x1b[2K";
      if (row > 0) clear += "\x1b[1A";
    }
    if (up < 0) clear += "\r";
    if (this.#cursorHidden) clear += "\x1b[?25h";
    this.output.write(clear + SYNC_END);
    this.#shown = false;
    this.#lastLines = [];
    this.#cursorHidden = false;
  }

  #stopTick(): void {
    if (this.#tick !== undefined) clearInterval(this.#tick);
    this.#tick = undefined;
  }

  #phase(): number {
    return this.#skipped ? 1 : Math.min(1, (Date.now() - this.#started) / DURATION_MS);
  }

  #compact(): boolean {
    return !this.animated || (this.output.columns ?? 80) < 48;
  }

  #status(): string | undefined {
    if (this.#route !== undefined) {
      const clean = (value: string): string => value.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 80);
      return `route ${clean(this.#route.model)} (${clean(this.#route.host)})`;
    }
    if (this.#ready) return undefined;
    return this.#spawned ? "starting the session" : undefined;
  }

  #draw(): void {
    if (this.#stopped) return;
    const columns = this.output.columns ?? 80;
    const status = this.#status();
    if (this.#compact()) {
      const text = `kumo${status === undefined ? "" : `  ${status}`}`;
      this.#paint([text.slice(0, columns)], false);
      this.#stopTick();
      return;
    }
    const phase = this.#phase();
    const frame = (this.output.rows ?? 24) < 8
      ? condensationFrame(Math.round(phase * (ASSEMBLY_STEPS - 1)))
      : wordmarkFrame(phase);
    const left = " ".repeat(Math.max(0, Math.floor((columns - 17) / 2)));
    const lines = frame.map((line, row) => {
      const colored = gradientStops(line, [...LOGO_STOPS], phase < 0.75 ? phase * 0.3 : 0);
      const suffix = row === frame.length - 1 && status !== undefined && left.length + 20 + status.length <= columns
        ? `   ${status}` : "";
      return `${left}${colored}${suffix}`;
    });
    this.#paint(lines, true);
  }

  #paint(lines: string[], animate: boolean): void {
    if (this.#shown && lines.length === this.#lastLines.length && lines.every((line, i) => line === this.#lastLines[i])) return;
    if (!animate && !this.#shown) {
      this.output.write(lines[0] ?? "");
      this.#shown = true;
      this.#lastLines = lines;
      return;
    }
    let bytes = SYNC_START;
    if (animate && !this.#cursorHidden) {
      bytes += "\x1b[?25l";
      this.#cursorHidden = true;
    } else if (!animate && this.#cursorHidden) {
      bytes += "\x1b[?25h";
      this.#cursorHidden = false;
    }
    if (!this.#shown) {
      bytes += lines.join("\r\n");
    } else if (lines.length !== this.#lastLines.length) {
      if (this.#lastLines.length > 1) bytes += `\x1b[${this.#lastLines.length - 1}A`;
      for (let row = 0; row < this.#lastLines.length; row += 1) {
        bytes += "\r\x1b[2K";
        if (row < this.#lastLines.length - 1) bytes += "\x1b[1B";
      }
      if (this.#lastLines.length > 1) bytes += `\x1b[${this.#lastLines.length - 1}A`;
      bytes += `\r${lines.join("\r\n")}`;
    } else {
      if (lines.length > 1) bytes += `\x1b[${lines.length - 1}A`;
      for (let row = 0; row < lines.length; row += 1) {
        if (lines[row] !== this.#lastLines[row]) bytes += `\r\x1b[2K${lines[row]}`;
        if (row < lines.length - 1) bytes += "\x1b[1B";
      }
      bytes += "\r";
    }
    this.output.write(bytes + SYNC_END);
    this.#shown = true;
    this.#lastLines = lines;
  }

  #onResize = (): void => {
    if (this.#stopped || !this.#shown) return;
    this.#draw();
  };
}

/** The child waits for the launcher to erase its drawing before pi-tui starts. */
export async function awaitBootHandoff(
  env: NodeJS.ProcessEnv = process.env,
  channel: Pick<NodeJS.Process, "send" | "on" | "off"> = process,
): Promise<void> {
  if (env.KUMO_BOOT_IPC !== "1" || typeof channel.send !== "function") return;
  let route: BootRoute | undefined;
  if (env.DSH_HOME !== undefined) {
    const known = readSettingsRoute(env.DSH_HOME);
    if (known !== undefined) {
      let host: string | undefined;
      try {
        if (known.baseUrl !== undefined) host = new URL(known.baseUrl).hostname;
      } catch {
        host = undefined;
      }
      if (host === undefined && known.provider !== "local") host = known.provider;
      if (host !== undefined) route = { model: known.name ?? known.model, host };
    }
  }
  await new Promise<void>((resolve) => {
    const done = (): void => {
      clearTimeout(timeout);
      channel.off("message", onMessage);
      resolve();
    };
    const onMessage = (message: unknown): void => {
      if (typeof message === "object" && message !== null && "type" in message && message.type === "kumo:boot-cleared") done();
    };
    const timeout = setTimeout(done, 2000);
    timeout.unref?.();
    channel.on("message", onMessage);
    channel.send?.({ type: "kumo:ui-ready", ...(route === undefined ? {} : { route }) });
  });
}
