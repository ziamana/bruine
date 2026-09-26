import { pad } from "./util.ts";

/** A date, formatted the way the report wants it. */
export function formatDate(value: Date): string {
  return pad(value.toISOString().slice(0, 10), 10);
}
