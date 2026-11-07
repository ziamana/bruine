/**
 * The result a `tool/result` session event carries.
 *
 * dsh 0.2 puts the call id, the blocks and the error flag on the tool message itself
 * (`{ role: "tool", toolCallId, content, isError }`); dsh 0.1 wrapped them in one `tool-result`
 * block of the message's content. Both shapes are read: a session written by bruine 0.1 is still
 * replayed by `/resume` and read by the bench.
 */
export interface ToolResultView {
  id: string;
  ok: boolean;
  output: string;
}

function textOf(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter((b): b is { type: "text"; text: string } => b !== null && typeof b === "object" && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

export function toolResultOf(message: unknown): ToolResultView | undefined {
  if (message === null || typeof message !== "object") return undefined;
  const m = message as { toolCallId?: unknown; content?: unknown; isError?: unknown };
  if (m.toolCallId !== undefined) {
    return { id: String(m.toolCallId), ok: m.isError !== true, output: textOf(m.content) };
  }
  const block = Array.isArray(m.content) ? (m.content[0] as { type?: unknown; toolCallId?: unknown; content?: unknown; isError?: unknown } | undefined) : undefined;
  if (block?.type === "tool-result" && block.toolCallId !== undefined) {
    return { id: String(block.toolCallId), ok: block.isError !== true, output: textOf(block.content) };
  }
  return undefined;
}
