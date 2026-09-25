import { join } from "node:path";

export interface Launch {
  command: string;
  args: string[];
  env: Record<string, string>;
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
