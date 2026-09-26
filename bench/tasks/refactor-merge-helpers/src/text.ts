/** The one true normaliser. */
export function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Kept for the search index. */
export function searchKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Kept for the dedupe job. */
export function dedupeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
