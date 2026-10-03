import { describeServer, PROJECT_MCP_FILE } from "./config.js";
import { approve, planMcp, readMcpState, writeMcpState } from "./state.js";

export interface ApproveIo {
  write(line: string): void;
  /** Ask a yes/no question; undefined when there is no terminal to ask on. */
  ask?: (question: string) => Promise<string>;
}

/**
 * Before the session starts: a project's `.mcp.json` can start programs on this machine, so its
 * servers run only once the user has seen exactly what they run and said yes. The answer is kept
 * per project and per server config; a changed command asks again. Without a terminal nothing
 * is approved, and the run says how to approve.
 */
export async function approveProjectServers(home: string, projectDir: string, io: ApproveIo, env: NodeJS.ProcessEnv = process.env): Promise<"none" | "approved" | "declined" | "skipped"> {
  const { plan } = planMcp(home, projectDir, env);
  const pending = plan.filter((p) => p.state === "unapproved").map((p) => p.server);
  if (pending.length === 0) return "none";
  const n = pending.length;
  if (io.ask === undefined) {
    io.write(`bruine: ${String(n)} MCP server${n === 1 ? "" : "s"} from ${PROJECT_MCP_FILE} ${n === 1 ? "is" : "are"} not approved for this project and will not start. Run bruine here in a terminal once to approve.`);
    return "skipped";
  }
  io.write(`This project's ${PROJECT_MCP_FILE} wants to start ${n === 1 ? "an MCP server" : `${String(n)} MCP servers`}:`);
  for (const server of pending) io.write(`  ${server.name}: ${describeServer(server)}`);
  io.write("They run with your permissions. Only approve what you trust.");
  const answer = (await io.ask(`Start ${n === 1 ? "it" : "them"} in this project? (y/N) `)).trim().toLowerCase();
  if (answer !== "y" && answer !== "yes") {
    io.write("Not started. /mcp enable <name> approves one later.");
    return "declined";
  }
  const state = readMcpState(home);
  approve(state, projectDir, pending);
  writeMcpState(home, state);
  return "approved";
}
