/**
 * Parse JSON that may have been cut anywhere, the way tool-call arguments arrive:
 * a stream of deltas that is only valid JSON once the last one has landed.
 *
 * The result is what the text says so far, never a guess about what is coming: an
 * unfinished string is closed where it stands, a key with no value yet is dropped,
 * and every open container is closed. `undefined` means nothing usable has arrived.
 */
export function parsePartialJson(raw: string): unknown {
  const text = raw.trim();
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    // Not complete yet: close it where it stands.
  }
  let cut = text;
  // Each pass either parses or steps back to the previous safe point, so the loop
  // ends; the bound only keeps a pathological input from walking the whole string.
  for (let pass = 0; pass < 64; pass += 1) {
    try {
      return JSON.parse(closeAt(cut));
    } catch {
      const back = lastSafePoint(cut);
      if (back < 1) return undefined;
      cut = cut.slice(0, back);
    }
  }
  return undefined;
}

/** `text` with its open string and containers closed, as if the stream had ended here. */
function closeAt(text: string): string {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  let out = text;
  if (inString) {
    // A dangling backslash or a half-written \uXXXX would make the closed string invalid.
    out = out.replace(/\\u[0-9a-fA-F]{0,3}$/, "").replace(/(?<!\\)(\\\\)*\\$/, "$1");
    out += '"';
  }
  out = out.replace(/\s+$/, "");
  if (out.endsWith(":")) out += "null";
  else if (out.endsWith(",")) out = out.slice(0, -1);
  return out + stack.reverse().join("");
}

/**
 * The latest index at which the text can be cut and still be closed into valid JSON:
 * just before a comma, or just after an opening bracket, outside any string.
 */
function lastSafePoint(text: string): number {
  let inString = false;
  let escaped = false;
  let point = -1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === ",") point = i;
    else if ((ch === "{" || ch === "[") && i + 1 < text.length) point = i + 1;
  }
  return point === text.length ? -1 : point;
}
