import { existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { beforeAll, expect, test } from "vitest";
import stringWidth from "string-width";
import { build, Harness } from "./harness.js";
import { textScript, toolScript, type Script } from "./sse-server.js";

beforeAll(build, 60_000);

const reasoning = (): Script => ({ chunks: [
  ...Array.from({ length: 40 }, (_, i) => ({ delta: { reasoning_content: `${i === 20 ? "x".repeat(300) : `Line ${i} 🙂 漢字`}${i % 2 ? "\n" : "\n\n"}` }, delayMs: 100 })),
  { delta: { content: "REASONING_DONE" }, delayMs: 150 },
] });

async function scenario(name: string, scripts: Script[], run: (h: Harness) => Promise<void>) {
  let h: Harness | undefined;
  try {
    h = await Harness.start(scripts);
    await h.waitFor("e2e-model", 30_000);
    await h.waitStable(150, 2000);
    await run(h);
    expect(h.server.errors).toEqual([]);
  } catch (error) {
    if (h) {
      await h.dump(`${name}-failure`);
      console.error(`SCENARIO FAILED: ${name}\n${h.screen().join("\n")}`);
    }
    throw error;
  } finally {
    await h?.close();
  }
}

// Sequential + bail=1: preserve the first bug and stop, as T22 requires.
test("reasoning: only one visible thought line throughout 40 mixed lines", async () => {
  await scenario("reasoning", [reasoning()], async (h) => {
    await h.prompt("Think through the problem");
    await h.waitFor("💭");
    let snapshots = 0;
    const deadline = Date.now() + 10_000;
    while (!h.screen().join("\n").includes("REASONING_DONE")) {
      await h.flush();
      const lines = h.screen().filter((line) => line.includes("💭"));
      if (lines.length > 1) await h.dump("reasoning");
      expect(lines.length, h.screen().join("\n")).toBeLessThanOrEqual(1);
      expect(Date.now()).toBeLessThan(deadline);
      snapshots++;
      await delay(50);
    }
    await h.dump("reasoning");
    expect(snapshots).toBeGreaterThan(20);
    expect(h.screen().join("\n")).toContain("thought for");
  });
});

test("escape: abort stream within one second and accept another turn", async () => {
  const slow: Script = { chunks: Array.from({ length: 200 }, (_, i) => ({ delta: { content: `word${i} ` }, delayMs: 100 })) };
  await scenario("escape", [slow, textScript("SECOND_TURN_WORKS")], async (h) => {
    await h.prompt("Start a long answer");
    await h.until(() => h.server.mainRequests().length === 1);
    await delay(1000);
    const start = Date.now();
    h.press("escape");
    await h.until(() => h.server.mainRequests()[0]!.disconnected, 1000, "server disconnect");
    await h.waitStable(200, Math.max(1, 1000 - (Date.now() - start)));
    await h.dump("escape");
    // Continue watching beyond the first quiet window to catch resumed output.
    const stopped = h.screen();
    await delay(300);
    await h.flush();
    expect(h.screen()).toEqual(stopped);
    await h.prompt("Try another turn");
    await h.waitFor("SECOND_TURN_WORKS");
    await h.dump("escape-second-turn");
  });
});

test("tool call: read note.txt and send the real tool result back", async () => {
  await scenario("tool-call", [toolScript("read", { file_path: "note.txt" }), textScript("READ_FINISHED")], async (h) => {
    await h.prompt("Read note.txt");
    await h.waitFor("● read");
    await h.dump("tool-call-streaming");
    await h.waitFor("✓ read");
    await h.waitFor("READ_FINISHED");
    await h.dump("tool-call");
    const requests = h.server.mainRequests();
    expect(requests).toHaveLength(2);
    const result = requests[1]!.body.messages.find((m) => m.role === "tool" && m.tool_call_id === "call_e2e_1");
    expect(JSON.stringify(result?.content)).toContain("E2E_READ_SENTINEL");
  });
});

test("modes: Tab Plan/Build, Shift+Tab Ask/Auto/confirmed red Full access", async () => {
  await scenario("modes", [], async (h) => {
    await h.waitFor("Ask");
    h.press("tab");
    await h.waitFor("Plan");
    await h.dump("modes-plan");
    h.press("tab");
    await h.waitFor("Build");
    h.press("shiftTab");
    await h.waitFor("Auto");
    h.press("shiftTab");
    await h.waitFor("Switch to FULL ACCESS?");
    await h.dump("modes-confirmation");
    h.press("down");
    h.press("enter");
    await h.until(() => !h.screen().join("\n").includes("Switch to FULL ACCESS?") && h.screen().join("\n").includes("FULL ACCESS"));
    await h.dump("modes");
    const row = h.screen().findIndex((line) => line.includes("FULL ACCESS"));
    const column = h.screen()[row]!.indexOf("FULL ACCESS");
    const cell = h.term.buffer.active.getLine(h.term.buffer.active.viewportY + row)!.getCell(column)!;
    expect(cell.isFgPalette()).toBeTruthy();
    expect(cell.getFgColor()).toBe(1);
  });
});

test("keys: ctrl+c clears input and ctrl+d exits successfully", async () => {
  await scenario("keys", [], async (h) => {
    h.type("PROMPT_TO_CLEAR");
    await h.waitFor("PROMPT_TO_CLEAR");
    h.press("ctrlC");
    await h.until(() => !h.screen().join("\n").includes("PROMPT_TO_CLEAR"), 1000, "cleared editor");
    await h.dump("keys");
    expect(h.server.mainRequests()).toHaveLength(0);
    const start = Date.now();
    h.press("ctrlD");
    await h.until(() => h.exit !== undefined, 4900, "clean exit");
    expect(h.exit?.exitCode).toBe(0);
    expect(Date.now() - start).toBeLessThan(5000);
  });
});

test("resize: 60×20 during reasoning preserves one thought line", async () => {
  await scenario("resize", [reasoning()], async (h) => {
    await h.prompt("Think while the terminal resizes");
    await h.waitFor("💭");
    h.resize(60, 20);
    const deadline = Date.now() + 10_000;
    while (!h.screen().join("\n").includes("REASONING_DONE")) {
      await h.flush();
      const lines = h.screen();
      expect(lines).toHaveLength(20);
      expect(lines.filter((line) => line.includes("💭")).length, lines.join("\n")).toBeLessThanOrEqual(1);
      expect(lines.every((line) => stringWidth(line) <= 60), lines.join("\n")).toBe(true);
      expect(Date.now()).toBeLessThan(deadline);
      await delay(50);
    }
    await h.dump("resize");
    expect(h.screen().join("\n")).toContain("thought for");
  });
});

test("approval: Down Down Enter rejects write without creating the file", async () => {
  await scenario("approval", [toolScript("write", { file_path: "rejected.txt", content: "MUST_NOT_EXIST" }), textScript("WRITE_REJECTED")], async (h) => {
    await h.prompt("Write rejected.txt");
    await h.waitFor("Allow once");
    await h.waitFor("Always");
    await h.waitFor("Reject");
    await h.dump("approval-select");
    h.press("down");
    await delay(50);
    h.press("down");
    h.press("enter");
    await h.waitFor("WRITE_REJECTED");
    await h.dump("approval");
    expect(existsSync(join(h.project, "rejected.txt"))).toBe(false);
    expect(h.server.mainRequests()[1]!.body.messages.some((m) => m.role === "tool")).toBe(true);
  });
});
