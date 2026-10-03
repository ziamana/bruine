import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fingerprint, readMcpServers, type McpServer } from "./config.js";

/**
 * What bruine remembers about MCP servers, in `mcp-state.json` in bruine's home: which project servers
 * the user approved (by fingerprint, so a changed command asks again) and which servers were
 * turned off with `/mcp disable`. The configs themselves are never rewritten.
 */
export interface McpState {
  user: { disabled: string[] };
  projects: Record<string, { approved: Record<string, string>; disabled: string[] }>;
}

export const MCP_STATE_FILE = "mcp-state.json";

const empty = (): McpState => ({ user: { disabled: [] }, projects: {} });

/** The key a project is remembered by: its absolute path (case-folded on Windows). */
export function projectKey(dir: string, platform: NodeJS.Platform = process.platform): string {
  const abs = path.resolve(dir);
  return platform === "win32" ? abs.toLowerCase() : abs;
}

export function readMcpState(home: string): McpState {
  try {
    const doc = JSON.parse(readFileSync(path.join(home, MCP_STATE_FILE), "utf8")) as Partial<McpState>;
    return {
      user: { disabled: Array.isArray(doc.user?.disabled) ? doc.user.disabled.filter((s) => typeof s === "string") : [] },
      projects: doc.projects !== null && typeof doc.projects === "object" ? doc.projects : {},
    };
  } catch {
    return empty();
  }
}

export function writeMcpState(home: string, state: McpState): void {
  mkdirSync(home, { recursive: true });
  const target = path.join(home, MCP_STATE_FILE);
  const temp = `${target}.${String(process.pid)}.tmp`;
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, target);
}

function project(state: McpState, dir: string): { approved: Record<string, string>; disabled: string[] } {
  const key = projectKey(dir);
  const entry = state.projects[key] ?? { approved: {}, disabled: [] };
  entry.approved ??= {};
  entry.disabled ??= [];
  state.projects[key] = entry;
  return entry;
}

/** A user server is the user's own; a project server runs only once approved, as it is now. */
export function isApproved(state: McpState, dir: string, server: McpServer): boolean {
  if (server.source === "user") return true;
  return state.projects[projectKey(dir)]?.approved?.[server.name] === fingerprint(server);
}

export function isDisabled(state: McpState, dir: string, server: McpServer): boolean {
  if (server.disabled) return true;
  if (server.source === "user") return state.user.disabled.includes(server.name);
  return state.projects[projectKey(dir)]?.disabled?.includes(server.name) ?? false;
}

export function approve(state: McpState, dir: string, servers: McpServer[]): void {
  const entry = project(state, dir);
  for (const server of servers) if (server.source === "project") entry.approved[server.name] = fingerprint(server);
}

/** Turn a server on or off for the next sessions; turning a project server on also approves it. */
export function setEnabled(state: McpState, dir: string, server: McpServer, enabled: boolean): void {
  const list = server.source === "user" ? state.user.disabled : project(state, dir).disabled;
  const at = list.indexOf(server.name);
  if (enabled && at >= 0) list.splice(at, 1);
  if (!enabled && at < 0) list.push(server.name);
  if (enabled) approve(state, dir, [server]);
}

export type McpPlan = { server: McpServer; state: "ready" | "disabled" | "unapproved" };

/** Every configured server and whether this session will start it. */
export function planMcp(home: string, dir: string, env: NodeJS.ProcessEnv = process.env): { plan: McpPlan[]; problems: string[] } {
  const { servers, problems } = readMcpServers(home, dir, env);
  const state = readMcpState(home);
  return {
    problems,
    plan: servers.map((server) => ({
      server,
      state: isDisabled(state, dir, server) ? "disabled" : isApproved(state, dir, server) ? "ready" : "unapproved",
    })),
  };
}
