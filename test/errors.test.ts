/**
 * T33b — the error mapping table (ticket §2) and the bruine.log sink.
 * D7 — the error block the user actually reads: what happened, which model, what
 * to do, at 100, 60 and 30 columns and with no colour at all.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, test, vi } from "vitest";
import { appendErrorLog, describeLlmError, ErrorBlock, fetchAvailableModels, formatK } from "../src/ui/errors.js";
import { resetColorDepth } from "../src/ui/palette.js";
import { strip } from "./fakes.js";
import { ChatTranscript } from "../src/ui/chat-layout.js";
import { UNICODE_ICONS } from "../src/render/chars.js";

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
    expect(r.hint).toBe("Is llama.cpp / Ollama / LM Studio running?  Change it: bruine setup");
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
      expect(r.hint).toBe("Set a new key: bruine setup");
    }
  });

  test("404 → model not found, caller asked to list models", () => {
    const r = describeLlmError({ code: "PI_AI_ERROR", message: "404 no deployment found", status: 404 }, route);
    expect(r.message).toBe('Model "ornith.gguf" not found on http://192.168.1.64:8081/v1');
    expect(r.wantAvailableModels).toBe(true);
    expect(r.hint).toContain("Change it: bruine setup");
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
    expect(r.hint).toContain("logs/bruine.log");
  });

  test("formatK matches the ticket spelling", () => {
    expect(formatK(81000)).toBe("81k");
    expect(formatK(14000)).toBe("14k");
  });
});

describe("bruine.log + /v1/models list (T33b)", () => {
  const prev = process.env.DSH_HOME;
  afterEach(() => {
    if (prev === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prev;
    vi.unstubAllGlobals();
  });

  test("appendErrorLog writes code + status + message to $DSH_HOME/logs/bruine.log", async () => {
    const home = mkdtempSync(join(tmpdir(), "bruine-t33b-log-"));
    process.env.DSH_HOME = home;
    await appendErrorLog({ code: "TRANSPORT", status: undefined, message: "fetch failed" });
    const log = readFileSync(join(home, "logs", "bruine.log"), "utf8");
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

describe("ErrorBlock (D7: what happened, which model, what to do)", () => {
  afterEach(() => {
    process.env.BRUINE_COLOR = "basic";
    resetColorDepth();
  });
  const net = describeLlmError({ code: "TRANSPORT", message: "fetch failed ECONNREFUSED" }, route);
  const stopped = describeLlmError({ code: "PI_AI_ERROR", message: "Retry failed after 2 attempts: Retry cancelled" }, route);

  test("a network failure: the red line, the model as a name, and the way out", () => {
    const block = new ErrorBlock(net, { model: "/etc/ajean/models/Ornith-1.5-9B-Q4_K_M.gguf" });
    const lines = block.render(100).map(strip);
    expect(lines[0]).toBe("Error: Can't reach your model server at http://192.168.1.64:8081/v1");
    expect(lines[1]).toBe("Model: Ornith-1.5-9B-Q4_K_M");
    expect(lines[2]).toContain("bruine setup");
    // The rule the whole line exists for: never a path to the weights.
    expect(lines.join("\n")).not.toContain("/etc");
    expect(lines.join("\n")).not.toContain(".gguf");
  });

  test("a cancelled turn says so, and says who stopped it", () => {
    const lines = new ErrorBlock(stopped, { modelName: "Ornith 1.5 9B" }).render(100).map(strip);
    expect(lines[0]).toBe("Error: Retry failed after 2 attempts: Retry cancelled");
    expect(lines[1]).toBe("Model: Ornith 1.5 9B");
    // Not the generic "if it repeats: bruine setup": the user stopped it on purpose.
    expect(lines[2]).toContain("You stopped this turn");
    expect(lines[2]).not.toContain("logs/bruine.log");
  });

  test("an error with no route at all does not invent one", () => {
    const lines = new ErrorBlock(describeLlmError({ code: "RATE_LIMIT", message: "429 slow down" }, route)).render(100).map(strip);
    expect(lines[0]).toBe("Error: Rate limited by Ornith 1.5 9B (home server)");
    expect(lines.join("\n")).not.toContain("Model:");
    expect(lines[1]).toContain("Wait a moment");
  });

  test("it is painted like a failed tool call, and plain where there is no colour", () => {
    const block = new ErrorBlock(net, { model: "ornith.gguf" });
    // D1: the transcript tints it with toolErr and draws the rail from this flag.
    expect(block.rail).toBe("red");
    const painted = block.render(100)[0]!;
    expect(painted).toContain("\x1b[1m"); // the `Error:` label is bold
    expect(painted).toContain("\x1b[31m"); // rose, at 16 colors
    expect(block.render(100)[1]).toContain("\x1b[90m"); // the model row is muted
    process.env.BRUINE_COLOR = "none";
    resetColorDepth();
    expect(block.render(100).join("")).not.toMatch(/\x1b\[/);
  });

  test("the transcript tints it with D1's toolErr card, red rail and all", () => {
    // The claim is about the frame, not about the component: `rail: "red"` is what
    // makes ChatTranscript reach for the same surface a failed tool call uses.
    const transcript = new ChatTranscript(UNICODE_ICONS);
    transcript.addChild(new ErrorBlock(net, { model: "ornith.gguf" }));
    const frame = transcript.render(60);
    expect(frame.map(strip).join("\n")).toContain("Error: Can't reach");
    // 16 colors: no surface to tint, so the rail carries the state (D1's rule), and
    // it runs the full height of the card.
    expect(frame.filter((line) => /\x1b\[31m▍/.test(line))).toHaveLength(frame.length - 1);
    process.env.BRUINE_COLOR = "truecolor";
    resetColorDepth();
    expect(transcript.render(60).join("")).toContain("\x1b[48;2;58;24;32m"); // toolErr #3a1820
  });

  test("no row is ever wider than the terminal, at 100, 60 or 30", () => {
    const block = new ErrorBlock(net, { model: "Ornith-1.5-9B-Q4_K_M-instruct-uncensored-32b" });
    for (const width of [100, 60, 30]) {
      for (const line of block.render(width)) {
        expect(visibleWidth(line), `${width}: ${JSON.stringify(line)}`).toBeLessThanOrEqual(width);
      }
    }
  });

  test("a message too long for the row is wrapped, never cut", () => {
    const block = new ErrorBlock(
      describeLlmError({ code: "WEIRD", message: "the model server refused the request because the adapter is misconfigured" }, route),
      { model: "m" },
    );
    const narrow = block.render(30).map(strip);
    // The whole sentence is still there: a failure message cut at the width has
    // lost the part that says why.
    expect(narrow.join(" ").replace(/\s+/g, " ")).toContain("adapter is misconfigured");
    expect(narrow.filter((l) => l !== "").length).toBeGreaterThan(2);
    expect(narrow[0]).toMatch(/^Error: /);
  });

  test("the hint can be filled in place once the server answers (T55)", () => {
    const block = new ErrorBlock(describeLlmError({ code: "PI_AI_ERROR", status: 404, message: "404 not found" }, route), {
      model: "ornith.gguf",
    });
    expect(block.render(100).map(strip)[2]).toContain("Change it: bruine setup");
    block.setHint("Available: a.gguf, b.gguf. Change it: bruine setup");
    expect(block.render(100).map(strip)[2]).toBe("Available: a.gguf, b.gguf. Change it: bruine setup");
    expect(block.render(100).map(strip)[0]).toMatch(/^Error: Model "ornith.gguf" not found/);
  });

  test("a stack trace still never reaches the screen", () => {
    const block = new ErrorBlock(
      describeLlmError({ code: "WEIRD", message: "boom\n    at Object.<anonymous> (/app/dist/x.js:1:1)" }, route),
      { model: "m" },
    );
    const text = block.render(100).map(strip).join("\n");
    expect(text).toContain("boom");
    expect(text).not.toContain("at Object");
  });
});
