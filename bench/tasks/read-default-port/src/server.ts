import { portFor } from "./config.ts";

/** Start the HTTP server. */
export function start(env: Record<string, string | undefined> = process.env): number {
  const port = portFor(env);
  console.log(`listening on ${String(port)}`);
  return port;
}
