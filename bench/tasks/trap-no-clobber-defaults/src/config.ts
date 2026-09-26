/** The settings the CLI runs with. */
export interface Settings {
  host: string;
  port: number;
  greeting: string;
}

export const DEFAULTS: Settings = { host: "127.0.0.1", port: 8080, greeting: "hello" };

/** Parse a settings file (flat JSON object of the three known keys). */
export function parseSettings(text: string): Partial<Settings> {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const out: Partial<Settings> = {};
  if (typeof raw["host"] === "string") out.host = raw["host"];
  if (typeof raw["port"] === "number") out.port = raw["port"];
  if (typeof raw["greeting"] === "string") out.greeting = raw["greeting"];
  return out;
}

/** The defaults, overridden by whatever the file holds. */
export function mergeSettings(file: Partial<Settings>): Settings {
  return { ...DEFAULTS, ...file };
}
