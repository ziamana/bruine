/**
 * T33b — the error mapping table (ticket §2) and the kumo.log sink.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { appendErrorLog, describeLlmError, fetchAvailableModels, formatK } from "../src/ui/errors.js";

const route = {
  provider: "Ornith 1.5 9B (home server)",
  model: "ornith.gguf",
  baseUrl: "http://192.168.1.64:8081/v1",
  contextWindow: 131072,
};

describe("describeLlmError (T33b table)", () => {
  test("connection refused → reach line + llama.cpp hint", () => {
    const r = describeLlmError({ code: "TRANSPORT", message: "fetch failed ECONNREFUSED" }, route);
    expect(r.message).toBe("Can't reach your model server at http://192.168.1.64:8081/v1");
    expect(r.hint).toBe("Is llama.cpp / Ollama / LM Studio running?  Change it: kumo setup");
  });

  test("timeout → seconds when known", () => {
    const r = describeLlmError({ code: "TIMEOUT", message: "request timed out after 30s" }, route);
    expect(r.message).toBe("The model server did not answer in time (30s)");
    expect(r.hint).toBe("It may still be loading the model. Try again, or check the server logs");
  });

  test("401 / 403 → key refused by the provider", () => {
    for (const f of [{ code: "AUTH", message: "401 unauthorized" }, { message: "x", status: 403 }]) {
      const r = describeLlmError(f, route);
      expect(r.message).toBe("The API key was refused by Ornith 1.5 9B (home server)");
      expect(r.hint).toBe("Set a new key: kumo setup");
    }
  });

  test("404 → model not found, caller asked to list models", () => {
    const r = describeLlmError({ code: "PI_AI_ERROR", message: "404 no deployment found", status: 404 }, route);
    expect(r.message).toBe('Model "ornith.gguf" not found on http://192.168.1.64:8081/v1');
    expect(r.wantAvailableModels).toBe(true);
    expect(r.hint).toContain("Change it: kumo setup");
  });

  test("context overflow → compact/new", () => {
    const r = describeLlmError({ code: "CONTEXT_WINDOW_EXCEEDED", message: "too many tokens" }, route);
    expect(r.message).toBe("The conversation is larger than the model's context (131k)");
    expect(r.hint).toBe("Use /compact or /new");
  });

  test("429 → rate limited", () => {
    const r = describeLlmError({ code: "RATE_LIMIT", message: "429 Too Many Requests" }, route);
    expect(r.message).toBe("Rate limited by Ornith 1.5 9B (home server)");
    expect(r.hint).toBe("Wait a moment and try again");
  });

  test("5xx → status + first line of the server message", () => {
    const r = describeLlmError({ code: "SERVER", status: 502, message: "Bad Gateway\nstack noise" }, route);
    expect(r.message).toBe("The model server returned an error (502)");
    expect(r.hint).toBe("Bad Gateway");
  });

  test("unknown code → first line only, point at the log (never a stack)", () => {
    const r = describeLlmError({ code: "WEIRD", message: "first line\nsecond line\nat Object.<anonymous>" }, route);
    expect(r.message).toBe("first line");
    expect(r.hint).toContain("logs/kumo.log");
  });

  test("formatK matches the ticket spelling", () => {
    expect(formatK(81000)).toBe("81k");
    expect(formatK(14000)).toBe("14k");
  });
});

describe("kumo.log + /v1/models list (T33b)", () => {
  const prev = process.env.DSH_HOME;
  afterEach(() => {
    if (prev === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prev;
    vi.unstubAllGlobals();
  });

  test("appendErrorLog writes code + status + message to $DSH_HOME/logs/kumo.log", async () => {
    const home = mkdtempSync(join(tmpdir(), "kumo-t33b-log-"));
    process.env.DSH_HOME = home;
    await appendErrorLog({ code: "TRANSPORT", status: undefined, message: "fetch failed" });
    const log = readFileSync(join(home, "logs", "kumo.log"), "utf8");
    expect(log).toContain("[llm-error] code=TRANSPORT fetch failed");
  });

  test("fetchAvailableModels returns the first 3 ids, [] on failure", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ data: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }] }),
    }));
    expect(await fetchAvailableModels("http://h:1/v1")).toEqual(["a", "b", "c"]);
    vi.stubGlobal("fetch", async () => {
      throw new Error("down");
    });
    expect(await fetchAvailableModels("http://h:1/v1")).toEqual([]);
  });
});
