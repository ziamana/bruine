import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { configReadPath } from "../compat.js";

/**
 * MCP servers, as the user wrote them and as dsh's client needs them.
 *
 * The format is Claude Code's (`mcpServers` with `command`/`args`/`env` for a local program, or
 * `type: "http"` with `url`/`headers` for a service), so a server row copied from Claude Code,
 * Cursor or a server's README works as it is. It is read from two places: `mcpServers` in
 * bruine.json in bruine's home (the user's own) and `.mcp.json` at the root of the project (shared
 * with the repository, so approved once per project before it may run anything: see trust.ts).
 *
 * bruine adds four optional keys per server: `disabled`, `alwaysAllow` (tool names that run
 * without asking), `readOnly` (the server only reads: usable in Plan mode, never asks) and
 * `timeout` (milliseconds per tool call).
 */

export type McpSource = "user" | "project";

export interface McpServer {
  /** The name as written in the config. */
  name: string;
  /** The namespace of its tools (`mcp__<id>__<tool>`): the name, made safe for dsh. */
  id: string;
  source: McpSource;
  transport: "stdio" | "streamable-http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  alwaysAllow: string[];
  readOnly: boolean;
  disabled: boolean;
}

export interface McpReadResult {
  servers: McpServer[];
  /** What could not be used, one line each, naming the server and the file. */
  problems: string[];
}

/** The file a project's shared servers live in, at the project root. */
export const PROJECT_MCP_FILE = ".mcp.json";

/**
 * `${VAR}` and `${VAR:-default}` from the environment, as Claude Code expands them. An unset
 * variable without a default becomes empty and is reported, so a missing token is visible
 * instead of a silent 401 from the server.
 */
export function expandEnv(text: string, env: NodeJS.ProcessEnv, missing: Set<string>): string {
  return text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_, name: string, fallback: string | undefined) => {
    const value = env[name];
    if (value !== undefined && value !== "") return value;
    if (fallback !== undefined) return fallback;
    missing.add(name);
    return "";
  });
}

/** A namespace dsh accepts (`[A-Za-z0-9_-]{1,32}`), stable for a given name. */
export function serverId(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  if (safe !== "" && safe.length <= 32 && safe === name) return safe;
  // A changed or shortened name gets a short hash, so two different names never collide.
  const hash = createHash("sha256").update(name).digest("hex").slice(0, 6);
  return `${(safe === "" ? "server" : safe).slice(0, 25)}_${hash}`;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

function stringRecord(v: unknown): Record<string, string> | undefined {
  if (!isRecord(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, value] of Object.entries(v)) if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") out[k] = String(value);
  return out;
}

/** Parse one `mcpServers` object. Bad rows are reported and skipped; good ones are kept. */
export function parseMcpServers(raw: unknown, source: McpSource, file: string, env: NodeJS.ProcessEnv = process.env): McpReadResult {
  const servers: McpServer[] = [];
  const problems: string[] = [];
  if (raw === undefined) return { servers, problems };
  if (!isRecord(raw)) return { servers, problems: [`${file}: mcpServers must be an object of servers by name.`] };
  for (const [name, row] of Object.entries(raw)) {
    if (!isRecord(row)) {
      problems.push(`${name} (${file}): not an object.`);
      continue;
    }
    const missing = new Set<string>();
    const x = (s: string): string => expandEnv(s, env, missing);
    const xRecord = (r: Record<string, string> | undefined): Record<string, string> | undefined =>
      r === undefined ? undefined : Object.fromEntries(Object.entries(r).map(([k, v]) => [k, x(v)]));
    const type = typeof row.type === "string" ? row.type.toLowerCase() : row.url !== undefined ? "http" : "stdio";
    const common = {
      name,
      id: serverId(name),
      source,
      alwaysAllow: Array.isArray(row.alwaysAllow) ? row.alwaysAllow.filter((t): t is string => typeof t === "string") : [],
      readOnly: row.readOnly === true,
      disabled: row.disabled === true,
      ...(typeof row.timeout === "number" && row.timeout > 0 ? { timeoutMs: Math.round(row.timeout) } : {}),
    };
    if (type === "stdio") {
      if (typeof row.command !== "string" || row.command.trim() === "") {
        problems.push(`${name} (${file}): a local server needs a "command".`);
        continue;
      }
      const args = Array.isArray(row.args) ? row.args.filter((a): a is string => typeof a === "string").map(x) : [];
      servers.push({
        ...common,
        transport: "stdio",
        command: x(row.command),
        args,
        ...(stringRecord(row.env) !== undefined ? { env: xRecord(stringRecord(row.env)) } : {}),
        ...(typeof row.cwd === "string" ? { cwd: x(row.cwd) } : {}),
      });
    } else if (type === "http" || type === "streamable-http") {
      if (typeof row.url !== "string" || !/^https?:\/\//i.test(row.url)) {
        problems.push(`${name} (${file}): an HTTP server needs a "url" starting with http:// or https://.`);
        continue;
      }
      servers.push({
        ...common,
        transport: "streamable-http",
        url: x(row.url),
        ...(stringRecord(row.headers) !== undefined ? { headers: xRecord(stringRecord(row.headers)) } : {}),
      });
    } else if (type === "sse") {
      problems.push(`${name} (${file}): the old SSE transport is not supported; use the server's Streamable HTTP endpoint with "type": "http".`);
      continue;
    } else {
      problems.push(`${name} (${file}): unknown type "${String(row.type)}" (use "stdio" or "http").`);
      continue;
    }
    if (missing.size > 0) problems.push(`${name} (${file}): ${[...missing].join(", ")} ${missing.size === 1 ? "is" : "are"} not set in the environment.`);
  }
  return { servers, problems };
}

function readJson(file: string): { value?: unknown; error?: string } {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return {};
  }
  try {
    return { value: JSON.parse(text) };
  } catch (error) {
    return { error: `${file}: not valid JSON (${(error as Error).message}).` };
  }
}

/**
 * Every configured server: the user's from bruine.json, then the project's from `.mcp.json`.
 * When both name the same server the user's wins, so a repository can never redirect a server
 * the user set up. Ids are unique (a clash is reported and the later row skipped).
 */
export function readMcpServers(home: string, projectDir: string, env: NodeJS.ProcessEnv = process.env): McpReadResult {
  const problems: string[] = [];
  const userFile = configReadPath(home);
  const user = readJson(userFile);
  if (user.error !== undefined) problems.push(user.error);
  const userRows = parseMcpServers(isRecord(user.value) ? user.value.mcpServers : undefined, "user", path.basename(userFile), env);
  const projectFile = path.join(projectDir, PROJECT_MCP_FILE);
  const project = readJson(projectFile);
  if (project.error !== undefined) problems.push(project.error);
  const projectRows = parseMcpServers(isRecord(project.value) ? project.value.mcpServers : undefined, "project", PROJECT_MCP_FILE, env);
  problems.push(...userRows.problems, ...projectRows.problems);
  const servers: McpServer[] = [];
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const server of [...userRows.servers, ...projectRows.servers]) {
    if (names.has(server.name)) continue;
    if (ids.has(server.id)) {
      problems.push(`${server.name}: its tool namespace "${server.id}" is already taken by another server; rename one of them.`);
      continue;
    }
    names.add(server.name);
    ids.add(server.id);
    servers.push(server);
  }
  return { servers, problems };
}

/**
 * What a server runs or reaches, and what it may do without asking, as one hash: approving a
 * project server approves exactly this, and any change to its command, arguments, environment,
 * address, `alwaysAllow` or `readOnly` asks again. The last two matter as much as the command: a
 * repository that could widen them after the approval would run its tools unasked.
 */
export function fingerprint(server: McpServer): string {
  const may = { alwaysAllow: [...server.alwaysAllow].sort(), readOnly: server.readOnly };
  const what = server.transport === "stdio"
    ? { t: "stdio", command: server.command, args: server.args ?? [], env: server.env ?? {}, cwd: server.cwd ?? "", may }
    : { t: "http", url: server.url, headers: server.headers ?? {}, may };
  return createHash("sha256").update(JSON.stringify(what)).digest("hex").slice(0, 16);
}

/** One line that says what a server is, for a prompt or the /mcp list. Never prints env values or headers. */
export function describeServer(server: McpServer): string {
  const where = server.transport === "stdio" ? [server.command, ...(server.args ?? [])].join(" ") : server.url ?? "";
  const may = [
    ...(server.readOnly ? ["marked read-only: usable in Plan mode, never asks"] : []),
    ...(server.alwaysAllow.length > 0 ? [`runs without asking: ${server.alwaysAllow.join(", ")}`] : []),
  ];
  return may.length === 0 ? where : `${where} (${may.join("; ")})`;
}

/** The config dsh's MCP client takes for a server. */
export function toDshConfig(server: McpServer): Record<string, unknown> {
  const common = {
    serverName: server.id,
    // A server that cannot start must say so: the failure is shown in /mcp, never swallowed.
    failOnStartupError: true,
    ...(server.timeoutMs !== undefined ? { toolCallTimeoutMs: server.timeoutMs } : {}),
  };
  if (server.transport === "stdio") {
    return { ...common, transport: "stdio", command: server.command, args: server.args ?? [], env: server.env ?? {}, ...(server.cwd !== undefined ? { cwd: server.cwd } : {}) };
  }
  return { ...common, transport: "streamable-http", url: server.url, headers: server.headers ?? {} };
}

/** The public name prefix of a server's tools (dsh's `mcp__<serverName>__<tool>`). */
export const toolPrefix = (id: string): string => `mcp__${id}__`;
