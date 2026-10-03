import { describeServer, PROJECT_MCP_FILE, type McpServer } from "./config.js";
import { readMcpState, setEnabled, writeMcpState } from "./state.js";
import type { McpServerStatus } from "../plugins/mcp.js";

const NEXT_SESSION = "It applies to the next session: the tools stay the same during a session, so the prompt cache survives.";

function stateLabel(s: McpServerStatus): string {
  switch (s.state) {
    case "connected":
      return `connected, ${String(s.tools.length)} tool${s.tools.length === 1 ? "" : "s"}`;
    case "failed":
      return `failed: ${s.error ?? "unknown error"}`;
    case "starting":
      return "still starting (it took longer than the session would wait)";
    case "disabled":
      return "off";
    case "unapproved":
      return "not approved for this project";
  }
}

/** The `/mcp` list: every server, where it comes from, what it runs, and its state. */
export function formatMcpList(statuses: McpServerStatus[], problems: readonly string[]): string {
  if (statuses.length === 0 && problems.length === 0) {
    return [
      "No MCP servers configured.",
      `Add them under "mcpServers" in bruine.json (/config opens it), or in ${PROJECT_MCP_FILE} at the project root,`,
      'in the Claude Code format: { "mcpServers": { "name": { "command": "npx", "args": ["-y", "some-server"] } } }.',
    ].join("\n");
  }
  const width = Math.max(4, ...statuses.map((s) => s.server.name.length));
  const lines = ["MCP servers:"];
  for (const s of statuses) {
    lines.push(`  ${s.server.name.padEnd(width)}  ${s.server.source.padEnd(7)}  ${stateLabel(s)}`);
    lines.push(`  ${" ".repeat(width)}  ${" ".repeat(7)}  ${describeServer(s.server)}`);
  }
  if (problems.length > 0) lines.push("", "Not loaded:", ...problems.map((p) => `  ${p}`));
  lines.push("", "/mcp <name> shows a server's tools; /mcp enable|disable <name> turns one on or off for the next session.");
  return lines.join("\n");
}

/** One server in detail: its tools and how the gate treats them. */
export function formatMcpServer(s: McpServerStatus): string {
  const lines = [`${s.server.name} (${s.server.source}): ${stateLabel(s)}`, `  ${describeServer(s.server)}`];
  if (s.server.readOnly) lines.push("  read-only: its tools run without asking, also in Plan mode.");
  else if (s.server.alwaysAllow.length > 0) lines.push(`  runs without asking: ${s.server.alwaysAllow.join(", ")}`);
  else lines.push("  every tool asks first (Ask mode), or is judged (Auto mode); Plan mode refuses them.");
  if (s.tools.length > 0) lines.push("  tools:", ...s.tools.map((t) => `    ${t}`));
  return lines.join("\n");
}

/**
 * Run `/mcp [name | enable <name> | disable <name>]` and return what to print. Enabling a project
 * server approves it as it is configured now.
 */
export function runMcpCommand(
  line: string,
  statuses: McpServerStatus[],
  problems: readonly string[],
  io: { home: string; projectDir: string },
): string {
  const [, verb, ...rest] = line.trim().split(/\s+/);
  if (verb === undefined || verb === "") return formatMcpList(statuses, problems);
  const find = (name: string): McpServerStatus | undefined => statuses.find((s) => s.server.name === name);
  if (verb === "enable" || verb === "disable") {
    const name = rest.join(" ");
    const status = find(name);
    if (status === undefined) return `No MCP server named "${name}". /mcp lists them.`;
    const state = readMcpState(io.home);
    setEnabled(state, io.projectDir, status.server as McpServer, verb === "enable");
    writeMcpState(io.home, state);
    const done = verb === "enable" ? (status.server.source === "project" ? "approved and on" : "on") : "off";
    return `${name} is ${done}. ${NEXT_SESSION}`;
  }
  const status = find([verb, ...rest].join(" "));
  if (status === undefined) return `No MCP server named "${[verb, ...rest].join(" ")}". /mcp lists them.`;
  return formatMcpServer(status);
}
