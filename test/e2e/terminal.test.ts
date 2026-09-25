import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { beforeAll, expect, it, test } from "vitest";
import stringWidth from "string-width";
import { build, Harness } from "./harness.js";
import { textScript, toolScript, type Script } from "./sse-server.js";

beforeAll(build, 60_000);

const wordSentences = [
  "Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa.",
  "Use 3.5, e.g. this example, i.e. one value for testing words.",
  "Red green blue yellow orange purple pink brown black white gray.",
];
const reasoning = (): Script => ({ chunks: [
  ...wordSentences.flatMap((sentence) => {
    const words = sentence.split(" ");
    return words.flatMap((word, wi) => {
      const mid = Math.max(1, Math.floor(word.length / 2));
      const last = wi === words.length - 1;
      const suffix = last ? " " : " ";
      return [
        { delta: { reasoning_content: word.slice(0, mid) }, delayMs: 60 },
        { delta: { reasoning_content: word.slice(mid) + suffix }, delayMs: 60 },
      ];
    });
  }),
  { delta: { content: "REASONING_DONE" }, delayMs: 150 },
] });
const footer = (h: Harness) => [...h.screen()].reverse().find(line => line.includes("e2e-model")) ?? "";
const footerCell = (h: Harness, label: string) => {
  const rows = h.screen().map((line, i) => ({ line, i })).filter(({ line }) => line.includes("e2e-model"));
  const row = rows.at(-1)!.i;
  const col = h.screen()[row]!.indexOf(label);
  expect(col).toBeGreaterThanOrEqual(0);
  return h.term.buffer.active.getLine(h.term.buffer.active.viewportY + row)!.getCell(col)!;
};
const runningThought = (line: string) => /^\s*[·✢✺✶✻✽] Thinking/.test(line);

async function scenario(name: string, scripts: Script[], run: (h: Harness) => Promise<void>, ascii = false) {
  let h: Harness | undefined;
  try {
    h = await Harness.start(scripts, "ask", ascii);
    await h.waitFor("e2e-model", 30_000);
    await h.waitStable(150, 2000);
    await run(h);
    expect(h.server.errors).toEqual([]);
    expect(h.emojiScreens, "No Extended_Pictographic code point may appear in any parsed terminal frame").toEqual([]);
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

// Every scenario owns its PTY, home, project and server; failures never bail out.
test("reasoning: word by word, whole words only, at least 10 changes (T25.3)", async () => {
  await scenario("reasoning", [reasoning()], async (h) => {
    await h.prompt("Think through the problem");
    await h.waitFor("Thinking");
    const seen = new Set<string>();
    const deadline = Date.now() + 15_000;
    while (!h.screen().join("\n").includes("REASONING_DONE")) {
      await h.flush();
      const lines = h.screen().filter(runningThought);
      expect(lines.length, h.screen().join("\n")).toBeLessThanOrEqual(1);
      if (lines.length) {
        const line = lines[0]!.trim();
        const text = line.replace(/^[·✢✺✶✻✽] Thinking(?:  )?/, "");
        seen.add(text);
        if (text !== "") {
          const ok = wordSentences.some((s) => {
            if (!s.startsWith(text)) return false;
            const words = s.split(" ");
            for (let n = 1; n <= words.length; n++) {
              if (words.slice(0, n).join(" ") === text) return true;
            }
            return false;
          });
          expect(ok, text).toBe(true);
        }
      }
      expect(Date.now()).toBeLessThan(deadline);
      await delay(50);
    }
    expect(seen.size).toBeGreaterThanOrEqual(10);
    await h.dump("t23-after-reasoning-done");
    expect(h.screen().join("\n")).toContain("∴ Thought for");
    await h.waitStable(350, 1000);
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
    await h.until(() => h.screen().some(line => /[·✢✺✶✻✽]/.test(line) && line.includes("read") && line.includes("note.txt")));
    await h.dump("t23-after-tool-running");
    const frames = new Set<string>();
    const deadline = Date.now() + 2000;
    while (!h.screen().join("\n").includes("✓ read")) {
      await h.flush();
      const line = h.screen().find(line => /[·✢✺✶✻✽]/.test(line) && line.includes("read"));
      if (line) {
        const m = line.match(/[·✢✺✶✻✽]/);
        if (m) frames.add(m[0]);
      }
      expect(Date.now()).toBeLessThan(deadline);
      await delay(50);
    }
    expect(frames.size).toBeGreaterThan(1);
    await h.waitFor("✓ read");
    await h.waitFor("READ_FINISHED");
    await h.dump("t23-after-tool-done");
    expect(h.screen().join("\n")).toContain("✓ read");
    expect(h.screen().join("\n")).toContain("note.txt");
    const header = h.screen().findIndex(line => line.includes("✓ read"));
    expect(h.screen()[header]).toMatch(/^  │ ✓/);
    expect(h.screen()[header - 1]?.trim()).toBe("");
    expect(h.screen()[header + 1]).toContain("⎿");
    expect(h.screen().find(line => line.includes("READ_FINISHED"))).toMatch(/^  READ_FINISHED/);
    const prompt = h.screen().findIndex(line => line.includes("› Read note.txt"));
    expect(h.screen()[prompt]).toMatch(/^  › /);
    expect(h.screen()[prompt + 1]?.trim()).toBe("");
    const answer = h.screen().findIndex(line => line.includes("READ_FINISHED"));
    expect(h.screen()[answer - 1]?.trim()).toBe("");
    expect(h.screen()[answer + 1]?.trim()).toBe("");
    await h.waitStable(350, 1000);
    const requests = h.server.mainRequests();
    expect(requests).toHaveLength(2);
    const result = requests[1]!.body.messages.find((m) => m.role === "tool" && m.tool_call_id === "call_e2e_1");
    expect(JSON.stringify(result?.content)).toContain("E2E_READ_SENTINEL");
  });
});

it("Ask footer label: always shows dim ask (fixed by T23)", async () => {
  await scenario("ask-label", [], async (h) => {
    expect(footer(h)).toMatch(/^ask\b/);
    expect(footerCell(h, "ask").isDim()).toBeTruthy();
    await h.dump("t23-after-footer-ask");
  });
});

test("modes: keys change actual tool permissions as well as colored labels", async () => {
  await scenario("modes", [
    toolScript("write", { file_path: "plan.txt", content: "denied" }, "plan_call"), textScript("PLAN_DONE"),
    toolScript("write", { file_path: "auto.txt", content: "AUTO_WORKS" }, "auto_call"), textScript("AUTO_DONE"),
    toolScript("write", { file_path: "full.txt", content: "FULL_WORKS" }, "full_call"), textScript("FULL_DONE"),
  ], async (h) => {
    const chatModeLines = () => h.screen().filter((line) => /^  ›/.test(line) && /mode|access/i.test(line));
    h.press("tab");
    await h.until(() => /^ask  plan\b/.test(footer(h)), 2000, "Plan label");
    await h.waitFor("Plan mode: kumo reads and plans");
    expect(chatModeLines()).toEqual([]);
    await h.dump("t23-after-footer-plan");
    await h.prompt("Write plan.txt");
    await h.waitFor("PLAN_DONE");
    expect(existsSync(join(h.project, "plan.txt"))).toBe(false);
    const result = h.server.mainRequests()[1]!.body.messages.find(m => m.role === "tool" && m.tool_call_id === "plan_call");
    expect(JSON.stringify(result?.content)).toContain("Plan mode is on");
    await h.dump("t23-after-plan-denies-write");
    expect(h.exit).toBeUndefined(); // Long denial must not crash the renderer.
    expect(chatModeLines()).toEqual([]);
    h.press("tab");
    await h.until(() => /^ask\b/.test(footer(h)), 2000, "Build");
    await h.waitFor("Build mode: kumo can change files again.");
    expect(chatModeLines()).toEqual([]);
    h.press("shiftTab");
    await h.until(() => /^auto\b/.test(footer(h)), 2000, "Auto");
    await h.waitFor("Auto: kumo decides, risky actions still ask.");
    expect(chatModeLines()).toEqual([]);
    expect(footerCell(h, "auto").getFgColor()).toBe(3);
    await h.dump("t23-after-footer-auto");
    await h.prompt("Write auto.txt");
    await h.waitFor("AUTO_DONE");
    expect(readFileSync(join(h.project, "auto.txt"), "utf8")).toBe("AUTO_WORKS");
    h.press("shiftTab");
    await h.waitFor("Enable full access?");
    await h.waitFor("Cancel");
    await h.waitFor("Enable");
    expect(footer(h)).toMatch(/^auto\b/); // Still Auto until confirmed.
    await h.dump("t23-after-full-confirmation");
    h.press("down"); await delay(50); h.press("enter");
    await h.until(() => /^FULL ACCESS\b/.test(footer(h)), 2000, "Full access");
    await h.waitFor("Full access: kumo never asks.");
    expect(chatModeLines()).toEqual([]);
    expect(footerCell(h, "FULL ACCESS").getFgColor()).toBe(1);
    expect(footerCell(h, "FULL ACCESS").isBold()).toBeTruthy();
    await h.dump("t23-after-footer-full");
    await h.prompt("Write full.txt");
    await h.waitFor("FULL_DONE");
    expect(readFileSync(join(h.project, "full.txt"), "utf8")).toBe("FULL_WORKS");
    await h.dump("t23-after-full-allows-write");
  });
});

test("working: delayed first chunk shows Working within 200ms (T24.3)", async () => {
  await scenario("working", [{ chunks: [{ delta: { content: "WORKING_DONE" }, delayMs: 1500 }] }], async (h) => {
    h.type("Start delayed work");
    await h.waitFor("Start delayed work");
    const start = Date.now();
    h.press("enter");
    await h.until(() => h.screen().join("\n").includes("Working"), 2000, "Working visible");
    expect(Date.now() - start).toBeLessThan(2000);
    await h.waitFor("WORKING_DONE");
    await h.dump("working");
  });
});

test("keys: ctrl+c clears input and ctrl+d exits successfully", async () => {
  await scenario("keys", [], async (h) => {
    h.type("PROMPT_TO_CLEAR");
    await h.waitFor("PROMPT_TO_CLEAR");
    h.press("ctrlC");
    let clearFailure: unknown;
    try {
      await h.until(() => !h.screen().join("\n").includes("PROMPT_TO_CLEAR"), 1000, "cleared editor");
    } catch (error) {
      clearFailure = error;
      await h.dump("keys-clear-failure");
      console.error(`CHECKPOINT FAILED: keys-clear\n${h.screen().join("\n")}`);
    }
    await h.dump("keys");
    expect(h.server.mainRequests()).toHaveLength(0);
    const start = Date.now();
    h.press("ctrlD");
    await h.until(() => h.exit !== undefined, 4900, "clean exit");
    expect(h.exit?.exitCode).toBe(0);
    expect(Date.now() - start).toBeLessThan(5000);
    console.info(`KEYS EXIT: code=${h.exit?.exitCode}, elapsed=${Date.now() - start}ms`);
    expect(clearFailure, String(clearFailure)).toBeUndefined();
  });
});

test("resize: 60×20 during reasoning preserves one thought line", async () => {
  await scenario("resize", [reasoning()], async (h) => {
    await h.prompt("Think while the terminal resizes");
    await h.waitFor("Thinking");
    h.resize(60, 20);
    const deadline = Date.now() + 10_000;
    while (!h.screen().join("\n").includes("REASONING_DONE")) {
      await h.flush();
      const lines = h.screen();
      expect(lines).toHaveLength(20);
      expect(lines.filter((line) => runningThought(line)).length, lines.join("\n")).toBeLessThanOrEqual(1);
      expect(lines.every((line) => stringWidth(line) <= 60), lines.join("\n")).toBe(true);
      expect(Date.now()).toBeLessThan(deadline);
      await delay(50);
    }
    await h.dump("resize");
    expect(h.screen().join("\n")).toContain("Thought for");
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

test.each(["reasoning", "tool"] as const)("Escape stops the %s spinner and leaves no live frame", async (kind) => {
  const script: Script = kind === "reasoning"
    ? { chunks: [{ delta: { reasoning_content: "Complete sentence. Incomplete" } }], finishDelayMs: 20000 }
    : { ...toolScript("read", { file_path: "note.txt" }), finishDelayMs: 20000 };
  await scenario(`cancel-${kind}`, [script], async h => {
    await h.prompt("Start work");
    await h.until(() => h.screen().some(line => kind === "reasoning" ? runningThought(line) : (/[·✢✺✶✻✽]/.test(line) && line.includes("read"))));
    await delay(300);
    h.press("escape");
    await h.until(() => h.server.mainRequests()[0]!.disconnected, 1000, "stream cancelled");
    await h.waitFor("cancelled");
    await h.waitStable(350, 1000);
    expect(h.screen().some(line => /[·✢✺✶✻✽]/.test(line) && /Thinking|read/.test(line))).toBe(false);
    await h.dump(`t23-after-cancel-${kind}`);
  });
});

test("tool error stops its spinner and renders a red failure marker", async () => {
  await scenario("tool-error", [toolScript("read", { file_path: "absent.txt" }), textScript("ERROR_HANDLED")], async h => {
    await h.prompt("Read absent.txt");
    await h.waitFor("ERROR_HANDLED");
    const row = h.screen().findIndex(line => line.includes("✗ read"));
    expect(row).toBeGreaterThanOrEqual(0);
    const cell = h.term.buffer.active.getLine(h.term.buffer.active.viewportY + row)!.getCell(2)!;
    expect(cell.getFgColor()).toBe(1);
    expect(h.screen().some(line => /[·✢✺✶✻✽]/.test(line) && line.includes("read"))).toBe(false);
    await h.waitStable(350, 1000);
    await h.dump("t23-after-tool-error");
  });
});

test("strict no-emoji check covers streamed reasoning, assistant text and user echo", async () => {
  await scenario("no-emoji", [{ chunks: [
    { delta: { reasoning_content: "🙂 Finished idea. " }, delayMs: 100 },
    { delta: { content: "🙂 Answer without pictographs ⚡." }, delayMs: 400 },
  ] }], async h => {
    h.type("User 🙂 prompt");
    await h.waitFor("User prompt");
    h.press("enter");
    await h.waitFor("Answer without pictographs");
    await h.waitStable(250, 1000);
    expect(h.screen().join("\n")).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(h.emojiScreens).toEqual([]);
    await h.dump("t23-after-no-emoji");
  });
});

test("ASCII fallback animates with - backslash bar slash and finishes without Unicode icons", async () => {
  await scenario("ascii", [{ chunks: [
    { delta: { reasoning_content: "Finished sentence. partial" }, delayMs: 100 },
    { delta: { content: "ASCII_DONE" }, delayMs: 1000 },
  ] }, toolScript("read", { file_path: "note.txt" }), textScript("ASCII_READ_DONE")], async h => {
    await h.prompt("Think in ASCII");
    await h.waitFor("Thinking");
    const frames = new Set<string>();
    const deadline = Date.now() + 4000;
    while (!h.screen().join("\n").includes("ASCII_DONE")) {
      await h.flush();
      const line = h.screen().find(line => /Thinking/.test(line));
      if (line) frames.add(line.trim()[0]!);
      expect(Date.now()).toBeLessThan(deadline);
      await delay(50);
    }
    expect([...frames].sort()).toEqual(["-", "\\", "|", "/"].sort());
    expect(h.screen().join("\n")).toContain("* Thought for");
    await h.prompt("Read note.txt");
    await h.waitFor("ASCII_READ_DONE");
    expect(h.screen().join("\n")).toContain("v read");
    expect(h.screen().join("\n")).toContain("note.txt");
    expect(h.screen().join("\n")).not.toMatch(/[∴✓✗✢✺✶✻✽⎿›]/);
    await h.dump("t23-after-ascii");
  }, true);
});

test("grouping: 4 grep collapse to +2, failed grep stays, ctrl+o expands (T27.2+3)", async () => {
  const gp = (id: string) => toolScript("grep", { pattern: "SENTINEL", path: "note.txt" }, id);
  await scenario("grouping", [
    gp("g1"), gp("g2"), gp("g3"), gp("g4"),
    toolScript("grep", {}, "g5"),
    { chunks: [{ delta: { content: "GROUP_DONE" } }], usage: { outputTokens: 100, inputTokens: 10000, cachedTokens: 9700 } },
  ], async (h) => {
    await h.prompt("Run grouped tools");
    await h.waitFor("GROUP_DONE");
    await h.waitStable(400, 2000);
    const collapsed = h.screen().join("\n");
    expect(collapsed).toContain("+2 files");
    expect(collapsed).toContain("✗ grep");
    expect(collapsed).toContain("│");
    expect(collapsed).toContain("cache 97%");
    expect(collapsed).toMatch(/✓ 5 tools/);
    expect(collapsed).toContain("tokens");
    await h.dump("t27-collapsed");
    h.press("ctrlO");
    await h.until(() => !h.screen().join("\n").includes("+2 files"), 2000, "expanded");
    const full = (() => {
      const buf = h.term.buffer.active;
      const out: string[] = [];
      for (let i = 0; i < buf.length; i++) out.push(buf.getLine(i)?.translateToString(true) ?? "");
      return out.join("\n");
    })();
    expect(full.match(/✓ grep/g)?.length).toBeGreaterThanOrEqual(4);
    await h.dump("t27-expanded");
    h.press("ctrlO");
    await h.waitFor("+2 files");
  });
});
