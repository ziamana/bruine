import { formatDate } from "./dates.ts";

export interface Row {
  at: Date;
  label: string;
}

/** The report body: one line per row. */
export function render(rows: Row[]): string {
  return rows.map((row) => `${formatDate(row.at)} ${row.label}`).join("\n");
}
