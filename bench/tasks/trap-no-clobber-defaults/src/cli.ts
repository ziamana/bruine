import { readFileSync } from "node:fs";
import type { CliArgs } from "./args.ts";
import { mergeSettings, parseSettings, type Settings } from "./config.ts";

/** What the CLI does: read its settings, then say hello. */
export function run(args: CliArgs): string {
  let settings: Settings = mergeSettings({});
  if (args.configPath !== undefined) {
    const text = readFileSync(args.configPath, "utf8");
    settings = mergeSettings(parseSettings(text));
  }
  return `${settings.greeting} from ${settings.host}:${String(settings.port)}`;
}
