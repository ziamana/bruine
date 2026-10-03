import { runtimeHome } from "../compat.js";
import { toDshConfig, toolPrefix, type McpServer } from "../mcp/config.js";
import { planMcp, type McpPlan } from "../mcp/state.js";
import type { DshContext } from "./ctx.js";

/** Stable Cordis plugin name. */
export const name = "bruine-mcp";

/** Service published for `/mcp` and for the permission gate. */
export const BRUINE_MCP_SERVICE = "bruineMcp";

/** How long the session waits for its servers before it starts without the slow ones. */
export const STARTUP_BUDGET_MS = 20_000;

export type McpServerState = "connected" | "failed" | "starting" | "disabled" | "unapproved";

export interface McpServerStatus {
  server: McpServer;
  state: McpServerState;
  /** Public tool names, as the model sees them. */
  tools: string[];
  error?: string;
}

export interface BruineMcpService {
  /** Every configured server, as of now. */
  status(): McpServerStatus[];
  /** Config problems found when the session started. */
  readonly problems: readonly string[];
  /** The server a public tool name belongs to, if it is an MCP tool. */
  serverOf(tool: string): McpServer | undefined;
}

/** dsh's MCP client, loaded lazily (and replaceable in tests). */
export type McpClientModule = { apply: (ctx: unknown, config: unknown) => unknown; name?: string; inject?: unknown };

/**
 * MCP servers as tools: one dsh MCP client per configured, enabled and approved server.
 *
 * Cache rule (ARCHITECTURE section 0): the tools array is fixed for the whole session, so every
 * server is connected BEFORE the first turn, up to {@link STARTUP_BUDGET_MS}; a change to the
 * config is picked up by the next session, never in the middle of one. Every MCP tool goes
 * through bruine's own permission gate (src/gate/rules.ts), like any other tool.
 */
export async function apply(
  ctx: DshContext,
  config: { plan?: McpPlan[]; problems?: string[]; load?: () => Promise<McpClientModule>; budgetMs?: number } = {},
): Promise<void> {
  const planned = config.plan !== undefined ? { plan: config.plan, problems: config.problems ?? [] } : planMcp(runtimeHome(), process.cwd());
  const statuses: McpServerStatus[] = planned.plan.map(({ server, state }) => ({
    server,
    state: state === "ready" ? "starting" : state,
    tools: [],
  }));
  const toolsOf = (server: McpServer): string[] => {
    try {
      const schemas = (ctx.get("tools")?.schemas?.() ?? []) as Array<{ name?: string; function?: { name?: string } }>;
      return schemas
        .map((s) => s.name ?? s.function?.name ?? "")
        .filter((n) => n.startsWith(toolPrefix(server.id)));
    } catch {
      return [];
    }
  };
  const service: BruineMcpService = {
    problems: planned.problems,
    status: () =>
      statuses.map((s) => (s.state === "connected" ? { ...s, tools: toolsOf(s.server) } : { ...s })),
    serverOf: (tool) => planned.plan.find(({ server }) => tool.startsWith(toolPrefix(server.id)))?.server,
  };
  ctx.provide(BRUINE_MCP_SERVICE, service);
  for (const problem of planned.problems) ctx.logger?.warn?.(`mcp: ${problem}`);

  const ready = statuses.filter((s) => s.state === "starting");
  if (ready.length === 0) return;
  if (typeof ctx.plugin !== "function") {
    for (const s of ready) Object.assign(s, { state: "failed", error: "this dsh build cannot load plugins at runtime" });
    return;
  }
  let client: McpClientModule;
  try {
    client = await (config.load ?? (async () => (await import("@deepseek-ai/dsh-mcp-client")) as unknown as McpClientModule))();
  } catch (error) {
    for (const s of ready) Object.assign(s, { state: "failed", error: `the MCP client could not be loaded: ${(error as Error).message}` });
    return;
  }
  const started = ready.map(async (status) => {
    try {
      await Promise.resolve(ctx.plugin!(client, toDshConfig(status.server)));
      status.state = "connected";
    } catch (error) {
      status.state = "failed";
      status.error = ((error as Error)?.message ?? String(error)).split("\n")[0]!.slice(0, 200);
    }
  });
  // The session waits for its tools, but not forever: a hung server is reported, not waited on.
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.allSettled(started),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, config.budgetMs ?? STARTUP_BUDGET_MS);
      timer.unref?.();
    }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
}
