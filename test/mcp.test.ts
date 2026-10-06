import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { describeServer, expandEnv, fingerprint, parseMcpServers, readMcpServers, serverId, toDshConfig } from "../src/mcp/config.js";
import { approve, isApproved, planMcp, projectKey, readMcpState, setEnabled, writeMcpState } from "../src/mcp/state.js";
import { approveProjectServers } from "../src/mcp/approve.js";
import { formatMcpList, runMcpCommand } from "../src/mcp/command.js";
import { apply, BRUINE_MCP_SERVICE, type BruineMcpService } from "../src/plugins/mcp.js";
import { mcpPolicy } from "../src/plugins/modes.js";
import { decide } from "../src/gate/rules.js";

const dirs: string[] = [];
const tmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "bruine-mcp-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the Claude Code format", () => {
  test("a local server and an HTTP server, as Claude Code writes them", () => {
    const { servers, problems } = parseMcpServers(
      {
        github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_TOKEN: "${GH}" } },
        docs: { type: "http", url: "https://example.com/mcp", headers: { Authorization: "Bearer ${TOKEN:-none}" } },
      },
      "user",
      "bruine.json",
      { GH: "ghp_x" },
    );
    expect(problems).toEqual([]);
    expect(servers[0]).toMatchObject({ name: "github", id: "github", transport: "stdio", command: "npx", env: { GITHUB_TOKEN: "ghp_x" } });
    expect(servers[1]).toMatchObject({ name: "docs", transport: "streamable-http", url: "https://example.com/mcp", headers: { Authorization: "Bearer none" } });
  });

  test("a bad row is reported by name and the others still load", () => {
    const { servers, problems } = parseMcpServers(
      { ok: { command: "x" }, nocmd: { args: [] }, old: { type: "sse", url: "http://h/sse" }, nourl: { type: "http" } },
      "project",
      ".mcp.json",
      {},
    );
    expect(servers.map((s) => s.name)).toEqual(["ok"]);
    expect(problems.join("\n")).toMatch(/nocmd.*command/);
    expect(problems.join("\n")).toMatch(/old.*SSE/);
    expect(problems.join("\n")).toMatch(/nourl.*url/);
  });

  test("an unset variable is reported, never silently sent", () => {
    const missing = new Set<string>();
    expect(expandEnv("a ${NOPE} b ${HAS} ${D:-dflt}", { HAS: "1" }, missing)).toBe("a  b 1 dflt");
    expect([...missing]).toEqual(["NOPE"]);
    const { problems } = parseMcpServers({ s: { command: "x", env: { K: "${NOPE}" } } }, "user", "bruine.json", {});
    expect(problems[0]).toMatch(/NOPE is not set/);
  });

  test("a name dsh would refuse gets a safe, stable namespace", () => {
    expect(serverId("github")).toBe("github");
    expect(serverId("my.server")).toMatch(/^my_server_[0-9a-f]{6}$/);
    expect(serverId("my.server")).toBe(serverId("my.server"));
    expect(serverId("my.server")).not.toBe(serverId("my server"));
    expect(serverId("x".repeat(60))).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
  });

  test("dsh gets its own config shape, failures loud", () => {
    const [server] = parseMcpServers({ s: { command: "node", args: ["s.js"], timeout: 5000 } }, "user", "f", {}).servers;
    expect(toDshConfig(server!)).toEqual({ serverName: "s", failOnStartupError: true, toolCallTimeoutMs: 5000, transport: "stdio", command: "node", args: ["s.js"], env: {} });
  });
});

describe("user and project servers", () => {
  test("the user's server wins over a project server of the same name", () => {
    const home = tmp();
    const project = tmp();
    writeFileSync(join(home, "bruine.json"), JSON.stringify({ mcpServers: { github: { command: "mine" } } }));
    writeFileSync(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { github: { command: "theirs" }, db: { command: "db" } } }));
    const { servers } = readMcpServers(home, project, {});
    expect(servers.map((s) => [s.name, s.source, s.command])).toEqual([
      ["github", "user", "mine"],
      ["db", "project", "db"],
    ]);
  });

  test("a project server runs only once approved, and asks again when its command changes", () => {
    const home = tmp();
    const project = tmp();
    writeFileSync(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { db: { command: "db", args: ["--ro"] } } }));
    expect(planMcp(home, project, {}).plan[0]!.state).toBe("unapproved");
    const state = readMcpState(home);
    approve(state, project, planMcp(home, project, {}).plan.map((p) => p.server));
    writeMcpState(home, state);
    expect(planMcp(home, project, {}).plan[0]!.state).toBe("ready");
    writeFileSync(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { db: { command: "db", args: ["--rw"] } } }));
    expect(planMcp(home, project, {}).plan[0]!.state).toBe("unapproved");
  });

  test("the approval is per project", () => {
    const home = tmp();
    const a = tmp();
    const b = tmp();
    const [server] = parseMcpServers({ db: { command: "db" } }, "project", ".mcp.json", {}).servers;
    const state = readMcpState(home);
    approve(state, a, [server!]);
    expect(isApproved(state, a, server!)).toBe(true);
    expect(isApproved(state, b, server!)).toBe(false);
    expect(projectKey("C:\\Repo", "win32")).toBe(projectKey("c:\\repo", "win32"));
  });

  test("disable and enable, for the next session", () => {
    const home = tmp();
    const project = tmp();
    writeFileSync(join(home, "bruine.json"), JSON.stringify({ mcpServers: { a: { command: "a" }, b: { command: "b", disabled: true } } }));
    const [a] = planMcp(home, project, {}).plan.map((p) => p.server);
    const state = readMcpState(home);
    setEnabled(state, project, a!, false);
    writeMcpState(home, state);
    expect(planMcp(home, project, {}).plan.map((p) => p.state)).toEqual(["disabled", "disabled"]);
    setEnabled(state, project, a!, true);
    writeMcpState(home, state);
    expect(planMcp(home, project, {}).plan.map((p) => p.state)).toEqual(["ready", "disabled"]);
  });
});

describe("approving a project's servers before the session", () => {
  const setup = (): { home: string; project: string } => {
    const home = tmp();
    const project = tmp();
    writeFileSync(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { db: { command: "db-server", args: ["--port", "1"], env: { SECRET: "s3cr3t" } } } }));
    return { home, project };
  };

  test("the user sees exactly what will run (never the secrets), and yes approves", async () => {
    const { home, project } = setup();
    const out: string[] = [];
    expect(await approveProjectServers(home, project, { write: (l) => out.push(l), ask: async () => "y" }, {})).toBe("approved");
    expect(out.join("\n")).toContain("db: db-server --port 1");
    expect(out.join("\n")).not.toContain("s3cr3t");
    expect(planMcp(home, project, {}).plan[0]!.state).toBe("ready");
    expect(await approveProjectServers(home, project, { write: (l) => out.push(l), ask: async () => "y" }, {})).toBe("none");
  });

  test("anything but yes starts nothing", async () => {
    const { home, project } = setup();
    expect(await approveProjectServers(home, project, { write: () => {}, ask: async () => "" }, {})).toBe("declined");
    expect(planMcp(home, project, {}).plan[0]!.state).toBe("unapproved");
  });

  test("without a terminal nothing is approved, and the run says so", async () => {
    const { home, project } = setup();
    const out: string[] = [];
    expect(await approveProjectServers(home, project, { write: (l) => out.push(l) }, {})).toBe("skipped");
    expect(out[0]).toMatch(/not approved/);
  });
});

describe("the gate", () => {
  const base = { mode: "ask" as const, plan: false, sessionAllowed: new Set<string>(), projectDir: "/p" };
  const policy = (readOnly: boolean, allowed: boolean) => () => ({ readOnly, allowed });

  test("an MCP tool asks in Ask mode, is judged in Auto, runs in Full", () => {
    expect(decide("mcp__gh__create_issue", {}, { ...base, mcp: policy(false, false) })).toBe("ask");
    expect(decide("mcp__gh__create_issue", {}, { ...base, mode: "auto", mcp: policy(false, false) })).toBe("judge");
    expect(decide("mcp__gh__create_issue", {}, { ...base, mode: "full", mcp: policy(false, false) })).toBe("allow");
  });

  test("Plan mode refuses an MCP tool unless its server is read-only", () => {
    expect(decide("mcp__gh__create_issue", {}, { ...base, plan: true, mcp: policy(false, true) })).toBe("deny");
    expect(decide("mcp__docs__search", {}, { ...base, plan: true, mcp: policy(true, false) })).toBe("allow");
    // A tool the gate knows nothing about is never treated as read-only.
    expect(decide("mcp__x__y", {}, { ...base, plan: true })).toBe("deny");
  });

  test("alwaysAllow and Always for this session let a tool run without asking", () => {
    expect(decide("mcp__gh__list_issues", {}, { ...base, mcp: policy(false, true) })).toBe("allow");
    expect(decide("mcp__gh__x", {}, { ...base, sessionAllowed: new Set(["mcp__gh__x"]), mcp: policy(false, false) })).toBe("allow");
  });

  test("the policy reads alwaysAllow by the server's raw tool names", () => {
    const [server] = parseMcpServers({ gh: { command: "x", alwaysAllow: ["list_issues"] } }, "user", "f", {}).servers;
    const service = { serverOf: (t: string) => (t.startsWith("mcp__gh__") ? server : undefined) } as unknown as BruineMcpService;
    expect(mcpPolicy(service, "mcp__gh__list_issues")).toEqual({ readOnly: false, allowed: true });
    expect(mcpPolicy(service, "mcp__gh__delete_repo")).toEqual({ readOnly: false, allowed: false });
    expect(mcpPolicy(service, "read")).toBeUndefined();
  });
});

describe("the plugin", () => {
  const fakeCtx = (tools: string[], plugin: (mod: unknown, config: any) => unknown) => {
    const services = new Map<string, unknown>([["tools", { schemas: () => tools.map((name) => ({ name })) }]]);
    return {
      services,
      ctx: {
        get: (n: string) => services.get(n),
        provide: (n: string, v: unknown) => services.set(n, v),
        inject: () => {},
        on: () => () => {},
        plugin,
      },
    };
  };
  const plan = (rows: Record<string, unknown>, state: "ready" | "disabled" | "unapproved" = "ready") =>
    parseMcpServers(rows, "user", "f", {}).servers.map((server) => ({ server, state }));

  test("each ready server is loaded through dsh's client and its tools are listed", async () => {
    const loaded: any[] = [];
    const { ctx, services } = fakeCtx(["mcp__a__one", "mcp__a__two", "read"], (_mod, config) => {
      loaded.push(config);
      return Promise.resolve();
    });
    await apply(ctx, { plan: plan({ a: { command: "a" } }), load: async () => ({ apply: () => {} }) });
    expect(loaded).toEqual([expect.objectContaining({ serverName: "a", transport: "stdio", command: "a" })]);
    const status = (services.get(BRUINE_MCP_SERVICE) as BruineMcpService).status();
    expect(status[0]).toMatchObject({ state: "connected", tools: ["mcp__a__one", "mcp__a__two"] });
  });

  test("a server that fails says why, and the session still starts", async () => {
    const { ctx, services } = fakeCtx([], () => Promise.reject(new Error("spawn db ENOENT\nstack")));
    await apply(ctx, { plan: plan({ db: { command: "db" } }), load: async () => ({ apply: () => {} }) });
    const [status] = (services.get(BRUINE_MCP_SERVICE) as BruineMcpService).status();
    expect(status).toMatchObject({ state: "failed", error: "spawn db ENOENT" });
  });

  test("a hung server is not waited on past the budget", async () => {
    const { ctx, services } = fakeCtx([], () => new Promise(() => {}));
    const started = Date.now();
    await apply(ctx, { plan: plan({ slow: { command: "s" } }), load: async () => ({ apply: () => {} }), budgetMs: 50 });
    expect(Date.now() - started).toBeLessThan(2000);
    expect((services.get(BRUINE_MCP_SERVICE) as BruineMcpService).status()[0]!.state).toBe("starting");
  });

  test("disabled and unapproved servers are never started", async () => {
    let calls = 0;
    const { ctx } = fakeCtx([], () => { calls += 1; return Promise.resolve(); });
    await apply(ctx, { plan: [...plan({ off: { command: "x" } }, "disabled"), ...plan({ new: { command: "y" } }, "unapproved")], load: async () => ({ apply: () => {} }) });
    expect(calls).toBe(0);
  });
});

describe("/mcp", () => {
  test("no server: how to add one", () => {
    expect(formatMcpList([], [])).toMatch(/mcpServers/);
  });

  test("the list names the source, the state and what runs; enable and disable write the state", () => {
    const home = tmp();
    const project = tmp();
    const [gh] = parseMcpServers({ gh: { command: "npx", args: ["gh-server"] } }, "user", "f", {}).servers;
    const statuses = [{ server: gh!, state: "connected" as const, tools: ["mcp__gh__a"] }];
    const list = runMcpCommand("/mcp", statuses, [], { home, projectDir: project });
    expect(list).toMatch(/gh\s+user\s+connected, 1 tool/);
    expect(list).toContain("npx gh-server");
    expect(runMcpCommand("/mcp gh", statuses, [], { home, projectDir: project })).toContain("mcp__gh__a");
    expect(runMcpCommand("/mcp disable gh", statuses, [], { home, projectDir: project })).toMatch(/off.*next session/);
    expect(JSON.parse(readFileSync(join(home, "mcp-state.json"), "utf8")).user.disabled).toEqual(["gh"]);
    expect(runMcpCommand("/mcp enable nope", statuses, [], { home, projectDir: project })).toMatch(/No MCP server/);
  });
});

test("a project server's fingerprint covers what it may do unasked, not what is only a setting", () => {
  const server = (row: Record<string, unknown>) => parseMcpServers({ s: { command: "x", ...row } }, "project", "f", {}).servers[0]!;
  const plain = fingerprint(server({}));
  // A repository must not be able to widen a server after the user approved it.
  expect(fingerprint(server({ alwaysAllow: ["t"] }))).not.toBe(plain);
  expect(fingerprint(server({ readOnly: true }))).not.toBe(plain);
  // The order of the list and a timeout change nothing about what runs or what is allowed.
  expect(fingerprint(server({ alwaysAllow: ["a", "b"] }))).toBe(fingerprint(server({ alwaysAllow: ["b", "a"] })));
  expect(fingerprint(server({ timeout: 5000 }))).toBe(plain);
});

test("the approval prompt says what a server would run without asking", () => {
  const server = parseMcpServers({ s: { command: "npx", args: ["-y", "x"], readOnly: true, alwaysAllow: ["write_row"] } }, "project", "f", {}).servers[0]!;
  expect(describeServer(server)).toBe("npx -y x (marked read-only: usable in Plan mode, never asks; runs without asking: write_row)");
  expect(describeServer(parseMcpServers({ s: { command: "npx" } }, "project", "f", {}).servers[0]!)).toBe("npx");
});
