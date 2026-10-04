import { beforeAll, expect, test } from "vitest";
import { build, Harness } from "./harness.js";
import { textScript, toolScript } from "./sse-server.js";

beforeAll(build, 60_000);

/**
 * A real MCP server over stdio, written without the SDK so the test owns every byte: it
 * answers initialize, lists one tool, and echoes its argument back when called.
 */
const SERVER = String.raw`
const rl = require("node:readline").createInterface({ input: process.stdin });
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === undefined) return;
  if (msg.method === "initialize") {
    send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "e2e-echo", version: "1.0.0" } } });
  } else if (msg.method === "tools/list") {
    send({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "echo", description: "Echo a text back", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }] } });
  } else if (msg.method === "tools/call") {
    send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "MCP_ECHO:" + msg.params.arguments.text }] } });
  } else {
    send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "no such method" } });
  }
});
`;

test("mcp: a configured server's tool reaches the model, asks first, and its answer comes back", async () => {
  const h = await Harness.start(
    [toolScript("mcp__echo__echo", { text: "rain" }), textScript("MCP_DONE")],
    "ask",
    false,
    {
      files: { "echo-server.cjs": SERVER },
      bruineJson: { mcpServers: { echo: { command: process.execPath, args: ["echo-server.cjs"] } } },
    },
  );
  try {
    await h.waitFor("e2e-model", 30_000);
    await h.waitStable(150, 2000);
    await h.prompt("Echo rain through MCP");
    // The gate asks before an MCP tool runs, like any other action.
    await h.waitFor("Allow once");
    h.press("enter");
    await h.waitFor("MCP_DONE");
    const [first, second] = h.server.mainRequests();
    const names = (first!.body.tools ?? []).map((t: any) => t?.function?.name ?? t?.name);
    expect(names).toContain("mcp__echo__echo");
    const toolResult = second!.body.messages.find((m) => m.role === "tool");
    expect(JSON.stringify(toolResult)).toContain("MCP_ECHO:rain");
    // The tools are the same on every request of the session (the prompt cache survives).
    expect(JSON.stringify(second!.body.tools)).toBe(JSON.stringify(first!.body.tools));
  } catch (error) {
    console.error(`SCENARIO FAILED: mcp\n${h.screen().join("\n")}`);
    throw error;
  } finally {
    await h.close();
  }
});
