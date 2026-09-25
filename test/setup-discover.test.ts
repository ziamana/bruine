import { createServer, type Server } from "node:http";
import { afterAll, describe, expect, test } from "vitest";
import {
  assertScannableHosts,
  hostsOf24,
  isPrivateIPv4,
  isTailscaleIPv4,
  normalizeModelIds,
  normalizeModelInfos,
  probeServer,
  scanLocalhosts,
  scanNetwork,
  tailscalePeerIPs,
} from "../src/setup/discover.js";

function serve(handler: (url: string) => [number, unknown] | undefined): Promise<Server> {
  const server = createServer((req, res) => {
    const hit = handler(req.url ?? "");
    if (hit === undefined) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(hit[0], { "content-type": "application/json" });
    res.end(JSON.stringify(hit[1]));
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

const portOf = (s: Server): number => (s.address() as { port: number }).port;

const servers: Server[] = [];
afterAll(async () => {
  for (const s of servers) await new Promise<void>((r) => s.close(() => r()));
});

describe("scanLocalhosts", () => {
  test("finds three servers on random localhost ports, with their models", async () => {
    const a = await serve((url) =>
      url === "/v1/models"
        ? [200, { data: [{ id: "alpha" }, { id: "beta" }] }]
        : undefined,
    );
    const b = await serve((url) =>
      url === "/v1/models" ? [200, { data: [{ id: "solo" }] }] : undefined,
    );
    const c = await serve((url) =>
      url === "/v1/models" ? [200, { models: [{ model: "llama-style" }] }] : undefined,
    );
    servers.push(a, b, c);
    const found = await scanLocalhosts({ ports: [portOf(a), portOf(b), portOf(c)] });
    expect(found).toHaveLength(3);
    const all = found.flatMap((d) => d.models).sort();
    expect(all).toEqual(["alpha", "beta", "llama-style", "solo"]);
  });

  test("context window comes from meta.n_ctx, never from n_ctx_train", async () => {
    const s = await serve((url) =>
      url === "/v1/models"
        ? [200, { data: [{ id: "ornith", meta: { n_ctx: 100096, n_ctx_train: 262144 } }] }]
        : undefined,
    );
    servers.push(s);
    const found = await scanLocalhosts({ ports: [portOf(s)] });
    expect(found[0]?.modelInfos).toEqual([{ id: "ornith", contextWindow: 100096 }]);
  });

  test("falls back to /props default_generation_settings.n_ctx", async () => {
    const s = await serve((url) => {
      if (url === "/v1/models") return [200, { data: [{ id: "plain" }] }];
      if (url === "/props") return [200, { default_generation_settings: { n_ctx: 8192 } }];
      return undefined;
    });
    servers.push(s);
    const found = await scanLocalhosts({ ports: [portOf(s)] });
    expect(found[0]?.modelInfos[0]).toEqual({ id: "plain", contextWindow: 8192 });
  });

  test("no context from anywhere → undefined (the wizard will ask)", async () => {
    const s = await serve((url) => (url === "/v1/models" ? [200, { data: [{ id: "x" }] }] : undefined));
    servers.push(s);
    const found = await scanLocalhosts({ ports: [portOf(s)] });
    expect(found[0]?.modelInfos[0].contextWindow).toBeUndefined();
  });
});

describe("public-range guard (T21.1)", () => {
  test("a public /24 is rejected BEFORE any request is made", async () => {
    let requests = 0;
    const fetchImpl = (async () => {
      requests += 1;
      throw new Error("unreachable");
    }) as never;
    await expect(scanNetwork(["8.8.8.0/24"], { fetchImpl, ports: [8080] })).rejects.toThrow(
      /non-private/,
    );
    expect(requests).toBe(0);
  });

  test("isPrivateIPv4 boundaries", () => {
    for (const ip of ["10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.64", "127.0.0.1"]) {
      expect(isPrivateIPv4(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "172.15.9.9", "172.32.0.1", "192.169.0.1", "1.2.3.4", "nope"]) {
      expect(isPrivateIPv4(ip), ip).toBe(false);
    }
  });

  test("assertScannableHosts allows tailscale CGNAT hosts but never their sweeps", () => {
    expect(isTailscaleIPv4("100.64.1.2")).toBe(true);
    expect(isTailscaleIPv4("100.127.9.9")).toBe(true);
    expect(isTailscaleIPv4("100.128.0.1")).toBe(false);
    assertScannableHosts(["192.168.1.64", "100.64.1.2", "127.0.0.1"]);
    expect(() => assertScannableHosts(["10.0.0.1", "8.8.4.4"])).toThrow(/8\.8\.4\.4/);
    expect(hostsOf24("10.1.2.0/24")).toHaveLength(254);
  });

  test("private /24 is accepted (no server listening → empty result)", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as never;
    const hits = await scanNetwork(["172.16.5.0/24"], { fetchImpl, ports: [8080], timeoutMs: 50 });
    expect(hits).toEqual([]);
  });
});

describe("tailscalePeerIPs", () => {
  test("only 100.64/10 self+peer IPs, public peers dropped", () => {
    const json = JSON.stringify({
      Self: { IPv4: "100.64.0.9" },
      Peer: {
        a: { IP: "100.100.5.5" },
        b: { IP: "8.8.8.8" },
        c: {},
      },
    });
    expect(tailscalePeerIPs(() => ({ status: 0, stdout: json, stderr: "" }) as never)).toEqual([
      "100.64.0.9",
      "100.100.5.5",
    ]);
    expect(tailscalePeerIPs(() => ({ status: 1, stdout: "", stderr: "not running" }) as never)).toEqual([]);
    expect(
      tailscalePeerIPs(() => {
        throw new Error("enoent");
      }) as never,
    ).toEqual([]);
  });
});

describe("probeServer model shapes", () => {
  test("openai + llama shapes both yield ids", async () => {
    expect(normalizeModelIds({ data: [{ id: "a" }, { id: "b" }] })).toEqual(["a", "b"]);
    expect(normalizeModelInfos({ models: [{ model: "m", n_ctx: 4096 }] })).toEqual([
      { id: "m", contextWindow: 4096 },
    ]);
    expect(normalizeModelIds({})).toEqual([]);
  });

  test("non-ok response → undefined", async () => {
    const fetchImpl = (async () => ({ ok: false, status: 500, json: async () => ({}) })) as never;
    expect(await probeServer("h", 1, { fetchImpl })).toBeUndefined();
  });
});
