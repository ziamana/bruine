/** The port used when nothing else says otherwise. */
export const DEFAULT_PORT = 8080;

/** The port for a given environment, falling back to the default. */
export function portFor(env: Record<string, string | undefined>): number {
  const raw = env["PORT"];
  if (raw === undefined || raw === "") return DEFAULT_PORT;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) ? parsed : DEFAULT_PORT;
}
