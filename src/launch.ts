import { join } from "node:path";

export interface Launch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * The launcher-only flags kumo answers itself. They count ONLY as the first
 * argument, so `kumo "explain the --help flag"` reaches the model instead.
 */
export function flagMode(argv: string[]): "help" | "version" | null {
  const first = argv[0];
  if (first === "--help" || first === "-h") return "help";
  if (first === "--version" || first === "-V") return "version";
  return null;
}

export function buildLaunch(
  argv: string[],
  env: NodeJS.ProcessEnv,
  home: string,
): Launch {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) out[key] = value;
  }
  out.DSH_HOME = env.KUMO_HOME ?? join(home, ".kumo");
  return {
    command: "dsh",
    args: ["--profile", "kumo", ...argv],
    env: out,
  };
}
