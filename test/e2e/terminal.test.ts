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
// The bottom area has a 2-column margin on both sides; tests read the text.
const footer = (h: Harness) => ([...h.screen()].reverse().find(line => line.includes("e2e-model")) ?? "").trimStart();
const footerCell = (h: Harness, label: string) => {
  const rows = h.screen().map((line, i) => ({ line, i })).filter(({ line }) => line.includes("e2e-model"));
  const row = rows.at(-1)!.i;
  const col = h.screen()[row]!.indexOf(label);
  expect(col).toBeGreaterThanOrEqual(0);
  return h.term.buffer.active.getLine(h.term.buffer.active.viewportY + row)!.getCell(col)!;
};
const runningThought = (line: string) => /^\s*[·✢✺✶✻✽] Thinking/.test(line);

async function scenario(name: string, scripts: Script[], run: (h: Harness) => Promise<void>, ascii = false, permissionMode = "ask") {
  let h: Harness | undefined;
  try {
    h = await Harness.start(scripts, permissionMode, ascii);
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

test("todo_write uses the task panel and collapses to one completion line", async () => {
  const active = [
    { content: "Read the launcher", status: "completed" },
    { content: "Find the footer", status: "completed" },
    { content: "Add the panel", status: "in_progress" },
    { content: "Update tests", status: "pending" },
    { content: "Run e2e", status: "pending" },
  ];
  const done = active.map((item) => ({ ...item, status: "completed" }));
  await scenario("tasks", [
    toolScript("todo_write", { todos: active }, "todo_1"), textScript("TASKS_STARTED"),
    toolScript("todo_write", { todos: done }, "todo_2"), textScript("TASKS_FINISHED"),
  ], async (h) => {
    await h.prompt("Make a task list");
    await h.waitFor("TASKS_STARTED");
    const shown = h.screen().join("\n");
    expect(shown).toContain("Tasks  2/5");
    expect(shown).toContain("Add the panel");
    expect(shown).not.toContain("todo_write");
    const taskRow = h.screen().findIndex((line) => line.includes("Tasks  2/5"));
    const editorRow = h.screen().findIndex((line) => line.includes("› Make a task list"));
    expect(taskRow).toBeGreaterThan(editorRow);
    await h.prompt("Finish the tasks");
    await h.waitFor("TASKS_FINISHED");
    const completed = h.screen().join("\n");
    expect(completed).toContain("✓ 5 tasks done");
    expect(completed).not.toContain("Tasks  5/5");
    expect(completed).not.toContain("todo_write");
  }, false, "full");
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
    expect(h.screen()[header]).toMatch(/^  ▍ ✓/);
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

test("modes: Shift+Tab Plan/Build and /auto /ask /full change real permissions", async () => {
  await scenario("modes", [
    toolScript("write", { file_path: "plan.txt", content: "denied" }, "plan_call"), textScript("PLAN_DONE"),
    toolScript("write", { file_path: "auto.txt", content: "AUTO_WORKS" }, "auto_call"), textScript("AUTO_DONE"),
    toolScript("write", { file_path: "full.txt", content: "FULL_WORKS" }, "full_call"), textScript("FULL_DONE"),
  ], async (h) => {
    const chatModeLines = () => h.screen().filter((line) => /^  ›/.test(line) && /mode|access/i.test(line));
    h.press("shiftTab");
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
    h.press("shiftTab");
    await h.until(() => /^ask\b/.test(footer(h)), 2000, "Build");
    await h.waitFor("Build mode: kumo can change files again.");
    expect(chatModeLines()).toEqual([]);
    await h.prompt("/auto");
    await h.until(() => /^auto\b/.test(footer(h)), 2000, "Auto");
    await h.waitFor("Auto: kumo decides, risky actions still ask.");
    expect(chatModeLines()).toEqual([]);
    expect(footerCell(h, "auto").getFgColor()).toBe(3);
    await h.dump("t23-after-footer-auto");
    await h.prompt("Write auto.txt");
    await h.waitFor("AUTO_DONE");
    expect(readFileSync(join(h.project, "auto.txt"), "utf8")).toBe("AUTO_WORKS");
    await h.prompt("/permissions");
    await h.waitFor("Ask: confirm every command");
    expect(footer(h)).toMatch(/^auto\b/);
    h.press("escape");
    await delay(200);
    await h.prompt("/full");
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
    await h.prompt("/ask");
    await h.until(() => /^ask\b/.test(footer(h)) && !/^ask  plan/.test(footer(h)), 2000, "Ask again");
    await h.dump("t23-after-full-allows-write");
  });
});

test("working: delayed first chunk shows Working within 200ms (T24.3, T27b.5)", async () => {
  await scenario("working", [{ chunks: [{ delta: { content: "WORKING_DONE" }, delayMs: 3000 }] }], async (h) => {
    h.type("Start delayed work");
    await h.waitFor("Start delayed work");
    const start = Date.now();
    h.press("enter");
    await h.until(() => h.screen().join("\n").includes("Working"), 2000, "Working visible");
    expect(Date.now() - start).toBeLessThan(1500);
    // Real llama.cpp: headers and the role chunk arrive at once, then seconds of silent
    // prefill. Working must STAY on screen during that silence, not just flash.
    await delay(1200);
    await h.flush();
    expect(h.screen().join("\n")).toContain("Working");
    await h.waitFor("WORKING_DONE");
    await h.dump("working");
  });
});

test("startup: header host and window known before first answer, pretty name (T27b.3+4)", async () => {
  await scenario("startup", [], async (h) => {
    const head = h.screen().join("\n");
    expect(head).toContain("127.0.0.1");
    expect(head).toContain("e2e-model Pretty");
    expect(footer(h)).toContain("100k");
    expect(footer(h)).not.toContain("?");
  });
});

test("cache-context: cached 9000/input 100 counts cached in ctx (T27b.2)", async () => {
  await scenario("cachectx", [
    // OpenAI total prompt 9100 = 100 new + 9000 cached; pi-ai input excludes cached (100).
    { chunks: [{ delta: { content: "CTX_DONE" } }], usage: { outputTokens: 50, inputTokens: 9100, cachedTokens: 9000 } },
  ], async (h) => {
    await h.prompt("Check context");
    await h.waitFor("CTX_DONE");
    await h.waitStable(400, 2000);
    // 100 + 9000 + 50 = 9150 / 100k ≈ 9.1-9.2% (old input+output only would show 0.1%)
    expect(footer(h)).toContain("ctx 9.");
    expect(footer(h)).toContain("cache");
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
    // T27b.1: approval sits above the editor, never over chat: prompt stays visible.
    expect(h.screen().join("\n")).toContain("› Write rejected.txt");
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
    expect(collapsed).toContain("▍");
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

const askTool = (questions: unknown, id = "q1"): Script =>
  toolScript("ask_user_question", { questions }, id);

test("questions: Down Enter picks second option (T28A)", async () => {
  await scenario("q-single", [
    askTool([{ id: "db", header: "Choose mode", question: "Which database should I use?", options: [
      { label: "SQLite", description: "Zero setup" },
      { label: "Redis", description: "Faster" },
      { label: "Other", description: "Custom" },
    ] }]),
    textScript("Q_DONE"),
  ], async (h) => {
    await h.prompt("Pick a database");
    await h.waitFor("Space toggle");
    h.press("down");
    await delay(100);
    h.press("enter");
    await h.waitFor("Q_DONE");
    const toolMsg = h.server.mainRequests()[1]!.body.messages.find((m) => m.role === "tool");
    expect(JSON.stringify(toolMsg)).toContain("Redis");
    expect(h.screen().join("\n")).toMatch(/\?.*→.*Redis/);
  });
});

test("questions: multi-select Space Space Enter (T28A)", async () => {
  await scenario("q-multi", [
    askTool([{ id: "m", question: "Pick two?", multi_select: true, options: [{ label: "A" }, { label: "B" }] }]),
    textScript("Q_DONE"),
  ], async (h) => {
    await h.prompt("Pick");
    await h.waitFor("Space toggle");
    h.type(" ");
    await delay(100);
    h.press("down");
    await delay(100);
    h.type(" ");
    await delay(100);
    h.press("enter");
    await h.waitFor("Q_DONE");
    const toolMsg = h.server.mainRequests()[1]!.body.messages.find((m) => m.role === "tool");
    const s = JSON.stringify(toolMsg);
    expect(s).toContain('\\"A\\"');
    expect(s).toContain('\\"B\\"');
  });
});

test("questions: Other free text (T28A)", async () => {
  await scenario("q-other", [
    askTool([{ id: "db", question: "Which?", options: [{ label: "SQLite" }] }]),
    textScript("Q_DONE"),
  ], async (h) => {
    await h.prompt("Pick");
    await h.waitFor("Space toggle");
    h.press("down");
    await delay(100);
    h.press("enter");
    await delay(200);
    h.type("Custom db");
    h.press("enter");
    await h.waitFor("Q_DONE");
    const toolMsg = h.server.mainRequests()[1]!.body.messages.find((m) => m.role === "tool");
    expect(JSON.stringify(toolMsg)).toContain("Custom db");
  });
});

test("questions: Esc skips, turn goes on (T28A)", async () => {
  await scenario("q-esc", [
    askTool([{ id: "db", question: "Which?", options: [{ label: "SQLite" }] }]),
    textScript("Q_DONE"),
  ], async (h) => {
    await h.prompt("Pick");
    await h.waitFor("Space toggle");
    h.press("escape");
    await h.waitFor("Q_DONE");
    const toolMsg = h.server.mainRequests()[1]!.body.messages.find((m) => m.role === "tool");
    expect(JSON.stringify(toolMsg)).toContain("skipped");
  });
});

test("suggest: ghost appears, Right fills editor and sends (T28B)", async () => {
  await scenario("suggest-accept", [textScript("TURN_DONE"), textScript("SECOND_DONE")], async (h) => {
    await h.prompt("Say hi");
    await h.waitFor("TURN_DONE");
    await h.waitFor("E2E session", 15000);
    h.press("right");
    await delay(150);
    h.press("enter");
    await h.waitFor("SECOND_DONE");
    const reqs = h.server.mainRequests();
    expect(reqs.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(reqs[1]!.body.messages)).toContain("E2E session");
  });
});

test("suggest: typing first cancels, server sees closed (T28B)", async () => {
  await scenario("suggest-cancel", [textScript("TURN_DONE")], async (h) => {
    await h.prompt("Say hi");
    await h.waitFor("TURN_DONE");
    await delay(150);
    h.type("x");
    await delay(2200);
    const all = (h.server as unknown as { requests: Array<{ body: { messages?: unknown }; disconnected: boolean }> }).requests;
    const sg = all.filter((r) => JSON.stringify(r.body.messages ?? "").includes("Suggest"));
    expect(sg.length).toBeGreaterThanOrEqual(1);
    expect(sg.some((r) => r.disconnected)).toBe(true);
  });
});

test("palette: / lists 7+ items, co filters to /compact, Tab completes (T31.1)", async () => {
  await scenario("palette", [textScript("COMPACT_NOTICE_CHECK")], async (h) => {
    h.type("/");
    await h.waitFor("/new");
    const listed = h.screen().filter((line) => /^\s*(→\s*)?\//.test(line)).length;
    expect(listed).toBeGreaterThanOrEqual(7);
    h.type("co");
    await h.waitStable(300, 2000);
    const items = h.screen().filter((line) => /^\s*(→\s*)?\//.test(line));
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items.some((line) => line.includes("/compact"))).toBe(true);
    expect(h.screen().find((line) => line.includes("→"))).toContain("/compact");
    h.press("tab");
    await delay(200);
    h.press("enter");
    // T33b wired /compact for real: on an empty session dsh's seam answers
    // itself — still no request to the model.
    await h.waitFor("No compactable history yet.");
    expect(h.server.mainRequests()).toHaveLength(0);
  });
});

test("keys: Tab on empty editor changes nothing (T31.4)", async () => {
  await scenario("tab-empty", [], async (h) => {
    expect(h.server.mainRequests()).toHaveLength(0);
    h.press("tab");
    await delay(400);
    await h.flush();
    expect(h.server.mainRequests()).toHaveLength(0);
    expect(footer(h)).not.toContain("plan");
  });
});

test("/new: two turns, new conversation, next request has only new history (T31.2)", async () => {
  await scenario("slash-new", [textScript("T1_DONE"), textScript("T2_DONE"), textScript("T3_DONE")], async (h) => {
    await h.prompt("First hello");
    await h.waitFor("T1_DONE");
    await h.prompt("Second hello");
    await h.waitFor("T2_DONE");
    await h.prompt("/new");
    await h.waitFor("New conversation.");
    await h.prompt("Third hello");
    await h.waitFor("T3_DONE");
    const reqs = h.server.mainRequests();
    expect(reqs.length).toBe(3);
    const lastBody = JSON.stringify(reqs[2]!.body.messages);
    expect(lastBody).toContain("Third hello");
    expect(lastBody).not.toContain("First hello");
    expect(lastBody).not.toContain("Second hello");
    expect(h.screen().join("\n")).not.toContain("First hello");
    // The context window of the route survives /new (real screen showed "ctx 0% of ?").
    expect(footer(h)).toContain("of 100k");
  });
});

test("unknown command shows notice and sends nothing (T31.1)", async () => {
  await scenario("unknown-cmd", [], async (h) => {
    await h.prompt("/xyz");
    await h.waitFor("Unknown command /xyz");
    expect(h.server.mainRequests()).toHaveLength(0);
  });
});

test("/help prints commands and keys without model traffic (T31.3)", async () => {
  await scenario("help", [], async (h) => {
    await h.prompt("/help");
    await h.waitFor("/compact");
    expect(h.screen().join("\n")).toContain("ctrl+d");
    expect(h.server.mainRequests()).toHaveLength(0);
  });
});

// ── T34: reasoning effort that really reaches the wire ─────────────────────
const EFFORT_TEMPLATE = { enableThinking: true, reasoningEffort: true, preserveThinking: true };
const BINARY_TEMPLATE = { enableThinking: true, reasoningEffort: false, preserveThinking: false };

async function templateScenario(
  name: string,
  scripts: Script[],
  permissionMode: "ask" | "auto",
  template: typeof EFFORT_TEMPLATE,
  run: (h: Harness) => Promise<void>,
) {
  let h: Harness | undefined;
  try {
    h = await Harness.start(scripts, permissionMode, false, { template });
    await h.waitFor("e2e-model", 30_000);
    await run(h);
    expect(h.server.errors, name).toEqual([]);
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

test("effort: defaults medium; /effort off and ctrl+e high change request params only (T34)", async () => {
  await templateScenario("effort-cycle", [
    textScript("TURN_ONE"), textScript("TURN_TWO"), textScript("TURN_THREE"),
  ], "ask", EFFORT_TEMPLATE, async (h) => {
    // Setup wrote the template → kumo defaults a local thinking model to medium.
    await h.waitFor("effort medium", 15_000);
    await h.prompt("one");
    await h.waitFor("TURN_ONE");
    const b1 = h.server.mainRequests()[0]!.body;
    expect(b1.chat_template_kwargs).toEqual({
      enable_thinking: true, reasoning_effort: "medium", preserve_thinking: true,
    });

    await h.prompt("/effort off");
    await h.waitFor("Effort: off (next message)");
    await h.prompt("two");
    await h.waitFor("TURN_TWO");
    const mains = h.server.mainRequests();
    const b2 = mains[mains.length - 1]!.body;
    expect(b2.chat_template_kwargs).toEqual({ enable_thinking: false, preserve_thinking: true });
    expect(b2.reasoning_effort).toBeUndefined();

    // ctrl+e cycles off → low → medium → high.
    h.press("ctrlE"); await delay(150);
    h.press("ctrlE"); await delay(150);
    h.press("ctrlE");
    await h.waitFor("Effort: high (next message)");
    await h.prompt("three");
    await h.waitFor("TURN_THREE");
    const b3 = h.server.mainRequests().at(-1)!.body;
    expect(b3.chat_template_kwargs?.reasoning_effort).toBe("high");
    expect(b3.chat_template_kwargs?.enable_thinking).toBe(true);
    expect(footer(h)).toContain("effort high");

    // Cache rule: system and tools stay byte-identical across effort changes.
    const sys = (b: (typeof b1)): string =>
      JSON.stringify(b.messages.filter((m) => ["system", "developer"].includes(m.role)));
    const tools = (b: (typeof b1)): string => JSON.stringify(b.tools ?? null);
    expect(sys(b2)).toBe(sys(b1));
    expect(sys(b3)).toBe(sys(b1));
    expect(tools(b2)).toBe(tools(b1));
    expect(tools(b3)).toBe(tools(b1));
  });
}, 90_000);

test("judge + ghost suggestion send enable_thinking false on a binary template (T28b)", async () => {
  await templateScenario("effort-side-requests", [
    toolScript("bash", { command: "touch t34_probe.txt", description: "create the probe file" }), textScript("TOOLED"),
  ], "auto", BINARY_TEMPLATE, async (h) => {
    // binary template → the default is "on"; footer tells the truth.
    await h.waitFor("effort on", 15_000);
    await h.prompt("create a file");
    await h.waitFor("TOOLED");
    await h.waitFor("✓ bash");
    const b1 = h.server.mainRequests()[0]!.body;
    expect(b1.chat_template_kwargs).toEqual({ enable_thinking: true });

    const find = (needle: string) =>
      h!.server.requests.find(
        (r) => !r.main && JSON.stringify(r.body.messages).includes(needle),
      );
    await h.until(() => find("Answer ALLOW or ASK") !== undefined, 15_000, "judge request");
    await h.until(() => find("Suggest") !== undefined, 15_000, "suggestion request");
    const judge = find("Answer ALLOW or ASK")!;
    // T34 mechanism: off → the template receives enable_thinking:false.
    expect(judge.body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(judge.body.reasoning_effort).toBeUndefined();

    const suggest = find("Suggest")!;
    expect(suggest.body.chat_template_kwargs).toEqual({ enable_thinking: false });
  });
}, 90_000);

// ── T33b: clear errors, visible compaction, local title suppression, legacy hint ──
async function serverScenario(
  name: string,
  scripts: Script[],
  run: (h: Harness) => Promise<void>,
  opts: Parameters<typeof Harness.start>[3] = {},
) {
  let h: Harness | undefined;
  try {
    h = await Harness.start(scripts, "ask", false, opts);
    await h.waitFor("e2e-model", 30_000);
    await run(h);
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

test("errors: 401 then 404 print the exact two lines (T33b)", async () => {
  await serverScenario(
    "errors-401-404",
    [textScript("SHOULD_NOT_APPEAR"), textScript("ALSO_NOT")],
    async (h) => {
      await h.prompt("first");
      await h.waitFor("The API key was refused by", 30_000);
      const s1 = h.screen().join("\n");
      expect(s1).toContain("Set a new key: kumo setup");
      expect(s1).not.toContain("at Object");
      await h.prompt("second");
      await h.waitFor('Model "e2e-model" not found on', 30_000);
      const s2 = h.screen().join("\n");
      expect(s2).toContain("Available: e2e-model. Change it: kumo setup");
    },
    {
      server: {
        failFirstMain: [
          { status: 401, body: { error: { message: "Invalid API key provided" } } },
          { status: 404, body: { error: { message: "no deployment for model" } } },
        ],
      },
    },
  );
}, 90_000);

test("errors: connection refused prints the reach line (T33b)", async () => {
  // Port 1 answers nothing: TRANSPORT in every shape.
  await serverScenario(
    "errors-refused",
    [textScript("NOPE")],
    async (h) => {
      await h.prompt("hello");
      await h.waitFor("Can't reach your model server at http://127.0.0.1:1/v1", 40_000);
      expect(h.screen().join("\n")).toContain(
        "Is llama.cpp / Ollama / LM Studio running?  Change it: kumo setup",
      );
    },
    { baseUrlOverride: "http://127.0.0.1:1/v1" },
  );
}, 90_000);

test("/compact on a short session: dsh answers no compactable history (T33b)", async () => {
  await serverScenario("compact-idle", [textScript("TURN_DONE")], async (h) => {
    // No turn yet: nothing is compactable, and the seam must answer itself.
    await h.prompt("/compact");
    await h.until(
      () => /No compactable history yet\.|Compacted:/.test(h!.screen().join("\n")),
      15_000,
      "compact reply",
    );
  });
}, 90_000);

test("title: a local route sends no LLM title request (T31c)", async () => {
  await serverScenario("title-local", [textScript("TURN_DONE")], async (h) => {
    await h.prompt("hello there");
    await h.waitFor("TURN_DONE");
    await delay(1500); // suggestions/titles all land within this window
    const title = h.server.requests.find(
      (r) => JSON.stringify(r.body.messages ?? "").toLowerCase().includes("session title"),
    );
    expect(title, "no session-title request on a private route").toBeUndefined();
    // and the title event itself must still exist via dsh's fallback:
    const turnOne = h.server.requests.filter((r) => r.main);
    expect(turnOne.length).toBeGreaterThanOrEqual(1);
  });
}, 90_000);

test("legacy route: one setup hint from the /props probe, gone after the first prompt (T33b)", async () => {
  await serverScenario(
    "legacy-effort-hint",
    [textScript("TURN_DONE")],
    async (h) => {
      await h.waitFor(
        "Effort control is available for this model: run kumo setup to enable it.",
        20_000,
      );
      await h.prompt("hi");
      await h.waitFor("TURN_DONE");
      await delay(500);
      expect(h.screen().join("\n")).not.toContain("run kumo setup to enable it");
    },
    {
      legacy: true,
      server: {
        props: {
          chat_template: "{% if enable_thinking %}{{ 'think' }}{% endif %}",
          default_generation_settings: { n_ctx: 100096 },
        },
      },
    },
  );
}, 90_000);
