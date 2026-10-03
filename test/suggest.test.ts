import { describe, expect, it } from "vitest";
import {
  MainRequestMemory,
  SUGGEST_INSTRUCTION,
  sameRoute,
  shouldSuggest,
  sharedPrefixRequest,
  standaloneRequest,
} from "../src/plugins/suggest.js";

const system = { role: "system", content: "You are Bruine." };
const user = { role: "user", content: "hello" };
const tools = [{ name: "bash" }, { name: "read" }];

function loopRequest(extra: Record<string, unknown> = {}) {
  return { provider: "p", model: "m", messages: [system, user], tools, sessionId: "s1", reasoningEffort: "high", ...extra };
}

describe("MainRequestMemory", () => {
  it("remembers the loop request of the live session", () => {
    const memory = new MainRequestMemory();
    memory.see(loopRequest(), "s1");
    expect(memory.last).toMatchObject({ provider: "p", model: "m", reasoningEffort: "high" });
    expect(memory.last?.messages).toEqual([system, user]);
    expect(memory.last?.tools).toEqual(tools);
  });

  it("ignores another session, an auxiliary purpose and a request without messages", () => {
    const memory = new MainRequestMemory();
    memory.see(loopRequest({ sessionId: "other" }), "s1");
    memory.see(loopRequest({ purpose: "compaction" }), "s1");
    memory.see(loopRequest({ purpose: "session-title" }), "s1");
    memory.see(loopRequest({ messages: [] }), "s1");
    memory.see(loopRequest(), undefined);
    expect(memory.last).toBeUndefined();
  });

  it("copies the lists, so a later append by the engine does not move what was seen", () => {
    const memory = new MainRequestMemory();
    const request = loopRequest();
    memory.see(request, "s1");
    request.messages.push({ role: "assistant", content: "later" });
    expect(memory.last?.messages).toHaveLength(2);
  });

  it("forgets on clear", () => {
    const memory = new MainRequestMemory();
    memory.see(loopRequest(), "s1");
    memory.clear();
    expect(memory.last).toBeUndefined();
  });
});

describe("sharedPrefixRequest", () => {
  it("keeps the whole main request as its start and only appends", () => {
    const memory = new MainRequestMemory();
    memory.see(loopRequest(), "s1");
    const request = sharedPrefixRequest(memory.last!, "Done, it compiles.");
    expect(request.messages.slice(0, 2)).toEqual([system, user]);
    expect(request.messages).toHaveLength(4);
    expect(request.tools).toEqual(tools);
    expect(request.provider).toBe("p");
    expect(request.model).toBe("m");
    expect(request.reasoningEffort).toBe("high");
    expect(JSON.stringify(request.messages[3])).toContain(SUGGEST_INSTRUCTION);
    expect(JSON.stringify(request.messages[2])).toContain("Done, it compiles.");
  });

  it("can ask for a lower effort without touching the prefix", () => {
    const memory = new MainRequestMemory();
    memory.see(loopRequest(), "s1");
    const request = sharedPrefixRequest(memory.last!, "ok", { effort: "off" });
    expect(request.reasoningEffort).toBe("off");
    expect(request.messages.slice(0, 2)).toEqual([system, user]);
  });

  it("sends no tool list when the main request had none", () => {
    const memory = new MainRequestMemory();
    memory.see(loopRequest({ tools: undefined }), "s1");
    expect("tools" in sharedPrefixRequest(memory.last!, "ok")).toBe(false);
  });
});

describe("standaloneRequest", () => {
  it("is one message that carries the context itself", () => {
    const request = standaloneRequest({ provider: "f", model: "fast" }, "fix the bug", "it is fixed");
    expect(request.messages).toHaveLength(1);
    expect(request.tools).toBeUndefined();
    const text = JSON.stringify(request.messages[0]);
    expect(text).toContain("fix the bug");
    expect(text).toContain("it is fixed");
    expect(request.model).toBe("fast");
  });
});

describe("shouldSuggest", () => {
  const ok = { enabled: true, plan: false, lastUser: "do it", answer: "done" };
  it("suggests after a normal turn", () => expect(shouldSuggest(ok)).toBe(true));
  it("not when disabled", () => expect(shouldSuggest({ ...ok, enabled: false })).toBe(false));
  it("not while planning", () => expect(shouldSuggest({ ...ok, plan: true })).toBe(false));
  it("not without a prompt or an answer", () => {
    expect(shouldSuggest({ ...ok, lastUser: "  " })).toBe(false);
    expect(shouldSuggest({ ...ok, answer: "" })).toBe(false);
  });
});

describe("sameRoute", () => {
  it("compares provider and model", () => {
    expect(sameRoute({ provider: "a", model: "b" }, { provider: "a", model: "b" })).toBe(true);
    expect(sameRoute({ provider: "a", model: "b" }, { provider: "a", model: "c" })).toBe(false);
    expect(sameRoute({ provider: "a", model: "b" }, { provider: "x", model: "b" })).toBe(false);
  });
});
