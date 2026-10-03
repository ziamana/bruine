import { describe, expect, test } from "vitest";
import {
  makeSearchProvider,
  readSearchConfig,
  type FetchLike,
} from "../src/plugins/web-search.js";

const jsonFetch = (payload: unknown, capture?: (url: string, init: any) => void): FetchLike =>
  async (url, init) => {
    capture?.(url, init);
    return { ok: true, status: 200, json: async () => payload };
  };

describe("readSearchConfig", () => {
  test("no bruine.json → none", () => {
    const cfg = readSearchConfig({ DSH_HOME: "/h" }, () => "", () => false);
    expect(cfg).toEqual({ provider: "none" });
  });

  test("parses the search section", () => {
    const raw = JSON.stringify({ mode: "simple", search: { provider: "searxng", url: "http://x:8888" } });
    const cfg = readSearchConfig({ DSH_HOME: "/h" }, () => raw, () => true);
    expect(cfg).toEqual({ provider: "searxng", url: "http://x:8888" });
  });

  test("corrupt file → none, never throws", () => {
    const cfg = readSearchConfig({ DSH_HOME: "/h" }, () => "{oops", () => true);
    expect(cfg).toEqual({ provider: "none" });
  });
});

describe("makeSearchProvider", () => {
  test("none: available false, informative empty result", async () => {
    const p = makeSearchProvider({ provider: "none" }, {}, async () => {
      throw new Error("must not fetch");
    });
    expect(p.available()).toBe(false);
    const r = await p.search({ query: "x" });
    expect(r.sources).toEqual([]);
    expect(r.content).toContain("not configured");
  });

  test("searxng: maps results and clips to maxResults", async () => {
    let url = "";
    const fetchImpl = jsonFetch(
      {
        results: [
          { url: "u1", title: "t1", content: "c1" },
          { url: "u2", title: "t2", content: "c2" },
          { url: "u3", title: "t3", content: "c3" },
        ],
      },
      (u) => {
        url = u;
      },
    );
    const p = makeSearchProvider({ provider: "searxng", url: "http://h:8888/" }, {}, fetchImpl);
    expect(p.available()).toBe(true);
    const r = await p.search({ query: "rust tokio", maxResults: 2 });
    expect(url).toBe("http://h:8888/search?q=rust%20tokio&format=json");
    expect(r.sources).toEqual([
      { url: "u1", title: "t1", snippet: "c1" },
      { url: "u2", title: "t2", snippet: "c2" },
    ]);
    expect(r.truncated).toBe(true);
  });

  test("brave: sends the subscription header and maps web.results", async () => {
    let captured: { url: string; init: any } | undefined;
    const fetchImpl = jsonFetch(
      { web: { results: [{ url: "b1", title: "T", description: "d" }] } },
      (u, init) => {
        captured = { url: u, init };
      },
    );
    const p = makeSearchProvider(
      { provider: "brave", apiKeyEnv: "BRAVE_API_KEY" },
      { BRAVE_API_KEY: "k-1" },
      fetchImpl,
    );
    expect(p.available()).toBe(true);
    const r = await p.search({ query: "q" });
    expect(captured!.url).toContain("api.search.brave.com/res/v1/web/search?q=q");
    expect(captured!.init.headers["X-Subscription-Token"]).toBe("k-1");
    expect(r.sources).toEqual([{ url: "b1", title: "T", snippet: "d" }]);
  });

  test("brave without key → not available", () => {
    const p = makeSearchProvider({ provider: "brave", apiKeyEnv: "BRAVE_API_KEY" }, {}, async () => {
      throw new Error("no");
    });
    expect(p.available()).toBe(false);
  });

  test("tavily: POSTs api_key and maps results", async () => {
    let captured: any;
    const fetchImpl = jsonFetch(
      { results: [{ url: "tv", title: "TV", content: "cc" }] },
      (_u, init) => {
        captured = init;
      },
    );
    const p = makeSearchProvider(
      { provider: "tavily", apiKeyEnv: "TAVILY_API_KEY" },
      { TAVILY_API_KEY: "t-9" },
      fetchImpl,
    );
    const r = await p.search({ query: "x", maxResults: 3 });
    expect(captured.method).toBe("POST");
    expect(JSON.parse(captured.body)).toEqual({ api_key: "t-9", query: "x", max_results: 3 });
    expect(r.sources).toEqual([{ url: "tv", title: "TV", snippet: "cc" }]);
  });
});
