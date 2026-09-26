/** Project-scoped choices for the REPL's resume picker. */
export interface RecentSession {
  id: string;
  createdAt: number;
  title: string;
}

interface SessionQueryLike {
  listSessions(): Promise<Array<{
    header: { id: string; cwd?: string; createdAt: number; origin?: string };
    persisted: boolean;
  }>>;
  readTitle?(id: string): Promise<{ title: string } | undefined>;
}

/** A missing query service means this dsh build cannot resume sessions. */
export async function recentSessions(
  query: SessionQueryLike | undefined,
  cwd: string,
  excludeId?: string,
): Promise<RecentSession[]> {
  if (query === undefined) return [];
  const rows = (await query.listSessions())
    .filter((row) => row.persisted && row.header.cwd === cwd && row.header.origin !== "subagent" && row.header.id !== excludeId)
    .sort((a, b) => b.header.createdAt - a.header.createdAt)
    .slice(0, 20);
  return Promise.all(rows.map(async (row) => {
    let title = "Untitled conversation";
    try { title = (await query.readTitle?.(row.header.id))?.title ?? title; } catch { /* title is optional */ }
    return { id: row.header.id, createdAt: row.header.createdAt, title };
  }));
}

export function sessionChoice(row: RecentSession): string {
  const date = new Date(row.createdAt).toLocaleString();
  return `${date}  ${row.title.slice(0, 60)}`;
}

/** Show the latest saved dialogue without asking the model to replay history. */
export function restoredDialogue(session: { snapshotEvents?(): unknown }): Array<{ role: "user" | "assistant"; text: string }> {
  const events = session.snapshotEvents?.();
  if (!Array.isArray(events)) return [];
  const messages: Array<{ role: "user" | "assistant"; text: string }> = [];
  for (const event of events) {
    if (event?.type !== "user/message" && event?.type !== "assistant/message") continue;
    if (event.type === "user/message" && event.data?.source?.kind !== "user") continue;
    const blocks = event.type === "assistant/message" ? event.data?.message?.content : event.data?.content;
    if (!Array.isArray(blocks)) continue;
    const text = blocks.filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text).join("\n").trim();
    if (text !== "") messages.push({ role: event.type === "user/message" ? "user" : "assistant", text });
  }
  return messages.slice(-20);
}
