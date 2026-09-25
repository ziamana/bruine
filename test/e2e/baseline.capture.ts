import { expect, test } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { build, Harness } from "./harness.js";
import { textScript, toolScript } from "./sse-server.js";
import { setTimeout as delay } from "node:timers/promises";

test("T23 before: capture screens and prove key routing before label changes", async () => {
  build();
  const h = await Harness.start([
    { chunks: [
      { delta: { reasoning_content: "First complete sentence. " }, delayMs: 100 },
      { delta: { reasoning_content: "The next sentence is unfinished" }, delayMs: 300 },
      { delta: { content: "BASELINE_DONE" }, delayMs: 1400 },
    ] },
    toolScript("read", { file_path: "note.txt" }), textScript("READ_DONE"),
    toolScript("write", { file_path: "plan-denied.txt", content: "MUST_NOT_EXIST" }), textScript("PLAN_PROBE_DONE"),
    toolScript("write", { file_path: "full-allowed.txt", content: "FULL_MODE_WORKS" }), textScript("FULL_PROBE_DONE"),
  ]);
  try {
    await h.waitFor("e2e-model", 30000);
    await h.waitStable(200, 2000);
    await h.dump("t23-before-footer-ask");
    await h.prompt("Think through this");
    await h.waitFor("The next sentence");
    await h.dump("t23-before-reasoning-running");
    await h.waitFor("BASELINE_DONE");
    await h.dump("t23-before-reasoning-done");
    await h.prompt("Read note.txt");
    await h.waitFor("● read");
    await h.dump("t23-before-tool-running");
    await h.waitFor("READ_DONE");
    await h.dump("t23-before-tool-done");
    h.press("tab");
    await delay(250);
    await h.dump("t23-before-footer-plan");
    // Baseline tool previews overflow at 100 columns; preserve that failure log,
    // then use 160 columns to isolate the key-routing behavior.
    h.resize(160, 30);
    await h.prompt("Write plan-denied.txt");
    await h.waitFor("PLAN_PROBE_DONE");
    const denied = h.server.mainRequests()[4]!.body.messages.filter(m => m.role === "tool").at(-1);
    expect(JSON.stringify(denied)).toContain("Plan mode is on");
    expect(existsSync(join(h.project, "plan-denied.txt"))).toBe(false);
    await h.dump("t23-before-plan-denies-write");
    console.info("BEFORE KEY ROUTING: Tab reached modes; Plan denied a real write; no file created.");
    h.press("tab");
    h.press("shiftTab");
    await delay(250);
    await h.dump("t23-before-footer-auto");
    h.press("shiftTab");
    await h.waitFor("Switch to FULL ACCESS?");
    h.press("down");
    await delay(50);
    h.press("enter");
    await delay(250);
    await h.dump("t23-before-footer-full");
    await h.prompt("Write full-allowed.txt");
    await h.waitFor("FULL_PROBE_DONE");
    expect(existsSync(join(h.project, "full-allowed.txt"))).toBe(true);
    console.info("BEFORE KEY ROUTING: Tab returned to Build; Shift+Tab reached Full; real write succeeded without approval.");
  } finally { await h.close(); }
}, 60000);
