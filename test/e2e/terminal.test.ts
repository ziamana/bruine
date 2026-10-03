import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
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
// The status bar is three rows: the place and the mode badges, the readings and
// the route, and the throughput when it fitted. Tests read the row they mean.
type BarRow = "place" | "turn" | "speed";
const barText = (h: Harness, which: BarRow): string => {
  const { place, turn, speed } = h.statusBarRows();
  return h.screen()[which === "place" ? place : which === "turn" ? turn : speed] ?? "";
};
const turnRow = (h: Harness) => barText(h, "turn").trimStart();
const placeRow = (h: Harness) => barText(h, "place").trimStart();
/** The mode badges, at the other end of the place row, spacing normalized. */
const badges = (h: Harness) => placeRow(h).trim().split(/\s+/).slice(1).join(" ");
/** The effort slot: the last cell of the route, after the dot (`-` in ASCII). */
const effortOf = (h: Harness) => turnRow(h).trim().match(/[•-] ?(\S+)$/)?.[1] ?? "";

/**
 * A reading of the turn row, in either of the two spellings it is written in:
 * named (`cached 34k`, `hit 98.9%`, `ctx 9.2% of 100k`) when the row has room
 * for the words, and in letters (`R34k`, `CH98.9%`, `9.2%/100k`) when it does
 * not. Only the spelling is accepted in both: the number each reading carries is
 * still pinned, so a bar that invented or dropped a fact still fails here.
 */
const reading = (turnText: string, named: string, letters: string, value: string): void => {
  const shape = turnText.includes(named) ? named : letters;
  expect(turnText, `no ${named} reading in ${JSON.stringify(turnText)}`).toContain(`${shape}${value}`);
};

function expectContextMarking(turnText: string): void {
  // The bar reads `ctx 9.2% of 100k`, or `9.2%/100k` when the row is too narrow
  // for the words: the share of the window spent, and the window itself. The
  // share is the honest part — a session that has spent nothing says `0%` rather
  // than claiming a window it has not filled.
  const mark = /([\d.]+)%(?: of |\/)([\d.]+)([kKmM]?)/.exec(turnText);
  expect(mark, `no context reading in ${JSON.stringify(turnText)}`).not.toBeNull();
  const window = Number(mark![2]) * (mark![3] === "M" ? 1e6 : mark![3] === "k" ? 1e3 : 1);
  expect(window).toBeGreaterThan(0);
  if (Number(mark![1]) === 0) expect(mark![0]).toMatch(/^0%/);
  // And it is a share of the window, not a number of tokens in a bar of blocks.
  expect(Number(mark![1])).toBeLessThan(100);
}
/**
 * The cell a label is painted in, in the row given: the mode badge and the effort
 * slot can say the same word (`auto` on a route that declares no levels), and
 * only one of them is the badge.
 */
const barCell = (h: Harness, which: BarRow, label: string) => {
  const { place, turn, speed } = h.statusBarRows();
  const row = which === "place" ? place : which === "turn" ? turn : speed;
  expect(row, `no ${which} row on screen`).toBeGreaterThanOrEqual(0);
  const col = h.screen()[row]!.indexOf(label);
  expect(col, `no ${JSON.stringify(label)} in ${JSON.stringify(barText(h, which))}`).toBeGreaterThanOrEqual(0);
  return h.term.buffer.active.getLine(h.term.buffer.active.viewportY + row)!.getCell(col)!;
};
/**
 * Palette roles as a cell reports them. `getFgColor()` answers an index in the
 * 256-colour palette, so the SGR the basic depth emits has to be translated:
 * `muted` is SGR 90 (bright black) and lands on 8, `sky` is SGR 36 and lands
 * on 6. Written out here because that translation is the easy mistake.
 */
const CELL = { muted: 8, sky: 6, lavender: 5, rose: 1 };
const runningThought = (line: string) => /^\s*[·✢✺✶✻✽] Thinking/.test(line);

test("headless -p writes only the answer and exits; json has a completed result", async () => {
  const h = await Harness.start([
    textScript("HEADLESS_TEXT_OK"), textScript("HEADLESS_JSON_OK"),
    toolScript("read", { file_path: "note.txt" }), textScript("HEADLESS_STREAM_OK"),
    toolScript("bash", { command: "touch denied.txt" }), textScript("HEADLESS_DENIED_OK"),
    textScript("HEADLESS_STDIN_OK"),
  ]);
  try {
    await h.waitFor("e2e-model");
    h.child.kill();
    await h.until(() => h.exit !== undefined);
    const invoke = (args: string[], input?: string) => new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const env = { ...process.env, KUMO_HOME: h.home, DSH_HOME: h.home, KUMO_LOCAL_API_KEY: "e2e", KUMO_NO_UPDATE_CHECK: "1", DSH_TELEMETRY_DISABLED: "1" };
      const child = spawn(process.execPath, [join(process.cwd(), "dist", "bin.js"), ...args], {
        cwd: h.project, env, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      });
      if (input !== undefined) child.stdin!.end(input);
      let stdout = "";
      let stderr = "";
      child.stdout!.on("data", (chunk) => { stdout += String(chunk); });
      child.stderr!.on("data", (chunk) => { stderr += String(chunk); });
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, stdout, stderr }));
    });
    const plain = await invoke(["-p", "Say yes"]);
    expect(plain).toMatchObject({ code: 0, stdout: "HEADLESS_TEXT_OK" });
    const json = await invoke(["-p", "Say yes again", "--output-format", "json"]);
    expect(json.code, json.stderr).toBe(0);
    expect(JSON.parse(json.stdout)).toMatchObject({ ok: true, text: "HEADLESS_JSON_OK", reason: "completed", tools: [] });
    const stream = await invoke(["-p", "Read the note", "--output-format", "stream-json"]);
    expect(stream.code, stream.stderr).toBe(0);
    const events = stream.stdout.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events).toContainEqual(expect.objectContaining({ type: "tool", name: "read" }));
    expect(events.at(-1)).toMatchObject({ ok: true, text: "HEADLESS_STREAM_OK", reason: "completed" });
    const denied = await invoke(["-p", "Try an edit", "--output-format", "json"]);
    expect(denied.code, denied.stderr).toBe(0);
    expect(JSON.parse(denied.stdout)).toMatchObject({ ok: true, tools: [{ name: "bash", decision: "deny" }] });
    expect(existsSync(join(h.project, "denied.txt"))).toBe(false);
    const stdin = await invoke(["-p", "-"], "Read this task from stdin");
    expect(stdin).toMatchObject({ code: 0, stdout: "HEADLESS_STDIN_OK" });
    expect(h.server.errors).toEqual([]);
  } finally {
    await h.close();
  }
});

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
    // The tool card's rail now includes its top padding row.
    expect(h.screen()[header - 1]).toMatch(/^  ▍\s*$/);
    expect(h.screen()[header + 1]).toContain("⎿");
    expect(h.screen().find(line => line.includes("READ_FINISHED"))).toMatch(/^  READ_FINISHED/);
    const prompt = h.screen().findIndex(line => line.includes("› Read note.txt"));
    // The prompt is a block of the turn now, so it carries the rail like the tool
    // card does — and the blank row after it does too.
    expect(h.screen()[prompt]).toMatch(/^\s*▍ › /);
    expect(h.screen()[prompt + 1]).toMatch(/^\s*(▍)?\s*$/);
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

it("Ask badge: always on screen, in the muted role (T23)", async () => {
  await scenario("ask-label", [], async (h) => {
    expect(badges(h)).toBe("ask");
    // T23 said `ask` is always dim. The palette replaced the raw SGR with the
    // `muted` role, which on a 16-colour terminal is bright black — the same
    // quiet reading, reached through the swatch instead of the attribute. What
    // T23 actually protects is that the mode is on screen and reads as inactive.
    expect(barCell(h, "place", "ask").getFgColor()).toBe(CELL.muted);
    expect(barCell(h, "place", "ask").isBold()).toBeFalsy();
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
    await h.until(() => badges(h) === "ask plan", 2000, "Plan label");
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
    await h.until(() => badges(h) === "ask", 2000, "Build");
    await h.waitFor("Build mode: kumo can change files again.");
    expect(chatModeLines()).toEqual([]);
    await h.prompt("/auto");
    await h.until(() => badges(h) === "auto", 2000, "Auto");
    await h.waitFor("Auto: kumo decides, risky actions still ask.");
    expect(chatModeLines()).toEqual([]);
    // `auto` is the `sky` role now, not the raw yellow of T23: what has to survive
    // is that it is a different colour from the `ask` badge it replaced.
    expect(barCell(h, "place", "auto").getFgColor()).toBe(CELL.sky);
    expect(barCell(h, "place", "auto").getFgColor()).not.toBe(CELL.muted);
    await h.dump("t23-after-footer-auto");
    await h.prompt("Write auto.txt");
    await h.waitFor("AUTO_DONE");
    expect(readFileSync(join(h.project, "auto.txt"), "utf8")).toBe("AUTO_WORKS");
    await h.prompt("/permissions");
    await h.waitFor("Ask: confirm every command");
    // The bar comes back on the frame after the panel, as everywhere else here.
    await h.until(() => badges(h) === "auto", 2000, "Auto label under the panel");
    h.press("escape");
    await delay(200);
    await h.prompt("/full");
    await h.waitFor("Enable full access?");
    await h.waitFor("Cancel");
    await h.waitFor("Enable");
    await h.waitStable(300, 2000);
    expect(badges(h)).toBe("auto"); // Still Auto until confirmed.
    await h.dump("t23-after-full-confirmation");
    h.press("down"); await delay(50); h.press("enter");
    await h.until(() => badges(h) === "FULL ACCESS", 2000, "Full access");
    await h.waitFor("Full access: kumo never asks.");
    expect(chatModeLines()).toEqual([]);
    // Full access is still the one badge that has to be noticed (T23): bold rose.
    expect(barCell(h, "place", "FULL ACCESS").getFgColor()).toBe(CELL.rose);
    expect(barCell(h, "place", "FULL ACCESS").isBold()).toBeTruthy();
    await h.dump("t23-after-footer-full");
    await h.prompt("Write full.txt");
    await h.waitFor("FULL_DONE");
    expect(readFileSync(join(h.project, "full.txt"), "utf8")).toBe("FULL_WORKS");
    await h.prompt("/ask");
    await h.until(() => badges(h) === "ask", 2000, "Ask again");
    await h.dump("t23-after-full-allows-write");
  });
});

test("working: delayed first chunk shows the model wait within 200ms (T24.3, T27b.5)", async () => {
  await scenario("working", [{ chunks: [{ delta: { content: "WORKING_DONE" }, delayMs: 3000 }] }], async (h) => {
    h.type("Start delayed work");
    await h.waitFor("Start delayed work");
    const start = Date.now();
    h.press("enter");
    await h.until(() => h.screen().join("\n").includes("Waiting for model"), 2000, "model wait visible");
    expect(Date.now() - start).toBeLessThan(1500);
    // Real llama.cpp: headers and the role chunk arrive at once, then seconds of silent
    // prefill. The wait must STAY on screen during that silence, not just flash.
    await delay(1200);
    await h.flush();
    expect(h.screen().join("\n")).toContain("Waiting for model");
    await h.waitFor("WORKING_DONE");
    await h.dump("working");
  });
});

test("startup: header host and window known before first answer, pretty name (T27b.3+4)", async () => {
  await scenario("startup", [], async (h) => {
    const head = h.screen().join("\n");
    expect(head).not.toContain("Starting session");
    expect(head).toContain("127.0.0.1");
    expect(head).toContain("e2e-model Pretty");
    // The turn row reads `ctx 0% of 100k`: the share of the window spent, and
    // the window.
    // The `?` this line used to forbid is gone by construction — a reading with an
    // unknown window is not one the bar can print.
    expect(turnRow(h)).not.toContain("?");
    expectContextMarking(turnRow(h));
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
    // The turn row carries the cache hit and the context share, longest reading
    // first: `hit 98.9%` and `ctx 9.2% of 100k`, or the same two in letters.
    expect(turnRow(h)).toMatch(/(?:CH|hit )9[0-9]\.\d%/);
    expect(turnRow(h)).toMatch(/(?:ctx )?9\.\d%(?: of 100k|\/100k)/);
    expectContextMarking(turnRow(h));
  });
});

test("the row reads what the request really cost: ↑ ↓ cache hit (D3)", async () => {
  await scenario("barreadings", [
    {
      chunks: [
        { delta: { content: "READINGS_DONE" }, delayMs: 60 },
      ],
      // The server reports the whole prompt (35.5k) and how much of it came from
      // the cache (34k); pi-ai hands the app the two halves separately, so the row's
      // ↑ is the 1.5k that was really prefilled and R the 34k the cache served.
      usage: { inputTokens: 35_500, outputTokens: 750, cachedTokens: 34_000 },
    },
  ], async (h) => {
    await h.prompt("What did that cost?");
    await h.waitFor("READINGS_DONE");
    await h.waitStable(400, 2000);
    // The readings the row exists for, in the order they are read: the prompt
    // written, the answer read back, what the cache served, the hit rate.
    expect(turnRow(h)).toMatch(/↑1\.5k ↓750/);
    reading(turnRow(h), "cached ", "R", "34k");
    expect(turnRow(h)).toMatch(/(?:CH|hit )9[0-9]\.\d%/);
    // And the share of the window, which is the sum of the three plus the window.
    expectContextMarking(turnRow(h));
    // A session in a temp directory is not a repository: no branch, and no noise
    // where one would be (the harness never writes a `.git`).
    expect(placeRow(h)).not.toContain("\u2387");
    // The place row still says where the tools run, and what they may do.
    expect(placeRow(h)).toContain("kumo-e2e-project-");
    expect(badges(h)).toBe("ask");
  });
});

test("the arrows count the session, not the request that came last (D3)", async () => {
  await scenario("barsession", [
    {
      chunks: [{ delta: { content: "FIRST_DONE" }, delayMs: 60 }],
      usage: { inputTokens: 35_500, outputTokens: 750, cachedTokens: 34_000 },
    },
    {
      chunks: [{ delta: { content: "SECOND_DONE" }, delayMs: 60 }],
      usage: { inputTokens: 3_500, outputTokens: 250, cachedTokens: 3_000 },
    },
  ], async (h) => {
    await h.prompt("What did that cost?");
    await h.waitFor("FIRST_DONE");
    await h.waitStable(400, 2000);
    expect(turnRow(h)).toMatch(/↑1\.5k ↓750/);
    reading(turnRow(h), "cached ", "R", "34k");
    await h.prompt("And this one?");
    await h.waitFor("SECOND_DONE");
    await h.waitStable(400, 2000);
    // The second turn adds to the reading instead of replacing it: 1.5k + 0.5k
    // written, 750 + 250 read back, 34k + 3k served from the cache — what this
    // conversation has spent since it started, the way pi's status line counts.
    expect(turnRow(h)).toMatch(/↑2k ↓1k/);
    reading(turnRow(h), "cached ", "R", "37k");
    await h.dump("barsession");
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

test("keys: ctrl+c clears typed text first, and quits only on an empty editor", async () => {
  await scenario("keys-ctrlc", [], async (h) => {
    h.type("DRAFT_TO_CLEAR");
    await h.waitFor("DRAFT_TO_CLEAR");
    h.press("ctrlC");
    await h.until(() => !h.screen().join("\n").includes("DRAFT_TO_CLEAR"), 1000, "cleared editor");
    // Clearing text is not leaving: kumo is still here after the first press.
    await delay(300);
    expect(h.exit).toBeUndefined();
    h.press("ctrlC");
    await h.until(() => h.exit !== undefined, 4900, "exit on the second press");
    expect(h.exit?.exitCode).toBe(0);
  });
});

test.skipIf(process.platform === "win32")("/config opens settings.yaml and kumo.json in the editor the user chose", async () => {
  await scenario("config-open", [], async (h) => {
    // The editor is a script that records what it was asked to open: kumo.json says which.
    const recorder = join(h.project, "fake-editor.sh");
    const record = join(h.project, "opened.txt");
    writeFileSync(recorder, `#!/bin/sh\nprintf '%s\\n' "$@" > '${record}'\n`);
    chmodSync(recorder, 0o755);
    const configPath = join(h.home, "kumo.json");
    writeFileSync(configPath, JSON.stringify({ ...JSON.parse(readFileSync(configPath, "utf8")), editor: recorder }));

    h.type("/config");
    h.press("enter");
    await h.waitFor("Opened settings.yaml and kumo.json in fake-editor.sh");
    await h.until(() => existsSync(record), 3000, "the editor ran");
    const opened = readFileSync(record, "utf8").trim().split("\n");
    expect(opened).toEqual([join(h.home, "settings.yaml"), join(h.home, "kumo.json")]);
    // The screen says what to do next, and kumo is still running.
    expect(h.screen().join("\n")).toContain("/reload");
    expect(h.exit).toBeUndefined();
  });
});

test.skipIf(process.platform === "win32")("/tasks lists a real background command and stops it", async () => {
  await scenario("tasks-bg", [
    toolScript("bash", { command: "sleep 120", description: "wait in the background", run_in_background: true }, "bg1"),
    textScript("BG_STARTED"),
  ], async (h) => {
    await h.prompt("Run it in the background");
    await h.waitFor("BG_STARTED");

    h.type("/tasks");
    h.press("enter");
    await h.waitFor("Background tasks (1 running)");
    const listed = h.screen().join("\n");
    expect(listed).toMatch(/bash-1 +running .*sleep 120/);
    expect(listed).toContain("/tasks kill <id> stops one.");

    h.type("/tasks kill bash-1");
    h.press("enter");
    await h.waitFor("Stopping bash-1.");

    // The job settles as killed, and the list says so rather than still running.
    let killed = false;
    for (let attempt = 0; attempt < 10 && !killed; attempt += 1) {
      await delay(600);
      h.type("/tasks");
      h.press("enter");
      await delay(400);
      killed = /bash-1 +killed/.test(h.screen().join("\n"));
    }
    expect(killed, h.screen().join("\n")).toBe(true);
    expect(h.screen().join("\n")).toContain("Background tasks (0 running)");
  }, false, "full");
}, 60_000);

/** A write call whose content arrives in `steps` fragments, `gapMs` apart, the way a model types a long file. */
function slowWrite(file: string, lines: number, steps: number, gapMs: number): Script {
  const content = Array.from({ length: lines }, (_, i) => `row ${String(i + 1)} of the file`).join("\n") + "\n";
  const json = JSON.stringify({ file_path: file, content });
  const size = Math.ceil(json.length / steps);
  return {
    finish: "tool_calls",
    finishDelayMs: 200,
    chunks: [
      { delta: { tool_calls: [{ index: 0, id: "w1", type: "function", function: { name: "write", arguments: "" } }] }, delayMs: 100 },
      ...Array.from({ length: steps }, (_, i) => ({
        delta: { tool_calls: [{ index: 0, function: { arguments: json.slice(i * size, (i + 1) * size) } }] },
        delayMs: gapMs,
      })),
    ],
  };
}

test("a file being written shows its first ten lines, then only a line count that climbs", async () => {
  await scenario("write-live", [slowWrite("big.txt", 150, 14, 250), textScript("WRITE_DONE")], async (h) => {
    h.type("Write the file");
    h.press("enter");
    await h.waitFor("   1 \u2502 row 1 of the file");
    const counts: number[] = [];
    let numberedEleven = false;
    const deadline = Date.now() + 8000;
    while (!h.screen().join("\n").includes("WRITE_DONE") && Date.now() < deadline) {
      const screen = h.screen().join("\n");
      const m = /\u2026 (\d+) lines \u00b7/.exec(screen);
      if (m) counts.push(Number(m[1]));
      if (/ 11 \u2502 row 11/.test(screen)) numberedEleven = true;
      await delay(60);
    }
    // The first ten lines were on screen, the eleventh was never printed as a line...
    expect(numberedEleven).toBe(false);
    // ...and a counter moved while the rest arrived: it was seen at several values, only going up.
    const distinct = [...new Set(counts)];
    expect(distinct.length).toBeGreaterThanOrEqual(3);
    expect([...distinct].sort((a, b) => a - b)).toEqual(distinct);
    expect(distinct.at(-1)!).toBeGreaterThan(distinct[0]! + 20);
    await h.waitFor("WRITE_DONE");
  }, false, "full");
}, 60_000);

test("lean catalog: a background sub-agent is a plain job the model can read, not a persistent child it cannot follow", async () => {
  await scenario("subagent-lean", [textScript("HI_SUB")], async (h) => {
    await h.prompt("hello");
    await h.waitFor("HI_SUB");
    const body = h.server.mainRequests()[0]!.body as unknown as { tools?: Array<{ function?: { name?: string; parameters?: { properties?: Record<string, unknown> } } }> };
    const text = JSON.stringify(body);
    // The persistent mode's guidance (poll nothing, wait for a notice) is not in the prompt:
    // the model was told to wait for a notice while holding no tool to follow the child.
    expect(text).not.toContain("Use subagent in the background by default");
    const names = (body.tools ?? []).map((t) => t.function?.name);
    expect(names).toContain("subagent");
    expect(names).toContain("job_output");
    expect(names).toContain("job_kill");
    // Persistent children are followed with these two, and the lean catalog does not mount them.
    expect(names).not.toContain("send_message");
    expect(names).not.toContain("list_agents");
    // Background stays available as an option on the call, as a job.
    const sub = (body.tools ?? []).find((t) => t.function?.name === "subagent");
    expect(Object.keys(sub?.function?.parameters?.properties ?? {})).toContain("run_in_background");
  });
});

test("/tasks with nothing running says so", async () => {
  await scenario("tasks-empty", [], async (h) => {
    h.type("/tasks");
    h.press("enter");
    await h.waitFor("No background tasks.");
  });
});

test("/config path lists the files without opening anything", async () => {
  await scenario("config-path", [], async (h) => {
    h.type("/config path");
    h.press("enter");
    await h.waitFor("Config files:");
    const screen = h.screen().join("\n");
    expect(screen).toContain("settings.yaml");
    expect(screen).toContain("kumo.json");
    expect(screen).not.toContain(".env");
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

// dsh registers a shell tool only where a POSIX shell is on PATH, so on
// Windows there is no command for the approval prompt to be about.
test.skipIf(process.platform === "win32")("approval: Auto runs bash ls without a select, while Ask still asks", async () => {
  await scenario("auto-bash-ls", [
    toolScript("bash", { command: "ls", description: "list project files" }, "auto_ls"), textScript("AUTO_LS_DONE"),
  ], async (h) => {
    await h.prompt("List the project files");
    await h.until(() => h.screen().join("\n").includes("AUTO_LS_DONE"), 6000, "Auto bash ls result");
    const screen = h.screen().join("\n");
    expect(screen).not.toContain("? Allow bash");
    const result = h.server.mainRequests()[1]?.body.messages.find((m) => m.role === "tool" && m.tool_call_id === "auto_ls");
    expect(JSON.stringify(result?.content)).toContain("note.txt");
  }, false, "auto");

  await scenario("ask-bash-ls", [
    toolScript("bash", { command: "ls", description: "list project files" }, "ask_ls"), textScript("ASK_LS_DONE"),
  ], async (h) => {
    await h.prompt("List the project files");
    await h.waitFor("? Allow bash: ls");
    expect(h.screen().join("\n")).toContain("Allow once");
    h.press("enter");
    await h.waitFor("ASK_LS_DONE");
  }, false, "ask");
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
      // The activity is the label in the prompt's top rule: `-- | Thinking 1s ---`.
      const spin = h.screen().map(line => /^\s*\+?-{2} (\S) Thinking/.exec(line)).find(Boolean);
      if (spin) frames.add(spin[1]!);
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

test("grouping: 4 grep collapse to +2 more, failed grep stays, ctrl+o expands (T27.2+3, T55 P1a)", async () => {
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
    expect(collapsed).toContain("+2 more");
    expect(collapsed).toContain("✗ grep");
    expect(collapsed).toContain("▍");
    expect(collapsed).toContain("cache 97%");
    expect(collapsed).toMatch(/✓ 5 tools/);
    expect(collapsed).toContain("tokens");
    await h.dump("t27-collapsed");
    h.press("ctrlO");
    await h.until(() => !h.screen().join("\n").includes("+2 more"), 2000, "expanded");
    const full = (() => {
      const buf = h.term.buffer.active;
      const out: string[] = [];
      for (let i = 0; i < buf.length; i++) out.push(buf.getLine(i)?.translateToString(true) ?? "");
      return out.join("\n");
    })();
    expect(full.match(/✓ grep/g)?.length).toBeGreaterThanOrEqual(4);
    await h.dump("t27-expanded");
    h.press("ctrlO");
    await h.waitFor("+2 more");
  });
});

test("PageUp reads the transcript and the composer stays on the last row", async () => {
  // The defect this is for: the composer sat at the end of a frame the terminal
  // scrolled, so reading the first turn of five put the input bar off the screen
  // and the only way back was to scroll to the bottom and find it. The frame is now
  // windowed by the app, so both are on screen at once.
  const words = ["ONE", "TWO", "THREE", "FOUR", "FIVE"];
  await scenario("scroll", words.map((w) => textScript(w)), async (h) => {
    for (const [i, word] of words.entries()) {
      await h.prompt(`turn ${String(i)}`);
      await h.waitFor(word);
    }
    await h.waitStable(400, 2000);
    const live = h.screen();
    // Long enough that the terminal has to scroll: the situation that used to cost
    // the user their composer.
    expect(live.join("\n")).not.toContain("ONE");
    // The band is the bottom three rows, and it is the same band after the scroll.
    const liveBand = live.slice(-3);
    expect(liveBand.join("\n")).toContain("e2e-model");
    await h.dump("scroll-live");

    h.press("pageUp");
    await h.waitFor("Jump to latest message");
    const up = h.screen();
    // The first turn is readable again, and the composer stayed exactly where it was.
    expect(up.join("\n")).toContain("ONE");
    expect(up.slice(-3)).toEqual(liveBand);
    expect(turnRow(h)).toContain("e2e-model");
    await h.dump("scroll-back");

    h.press("pageDown");
    await h.until(() => !h.screen().join("\n").includes("Jump to latest message"), 2000, "live edge");
    expect(h.screen().slice(-3)).toEqual(liveBand);
  });
});

test("the pill is the way back: End and a click on it both return to the bottom (D5)", async () => {
  const words = ["ALPHA", "BRAVO", "CHARLIE", "DELTA", "ECHO"];
  await scenario("jumppill", words.map((w) => textScript(w)), async (h) => {
    for (const [i, word] of words.entries()) {
      await h.prompt(`turn ${String(i)}`);
      await h.waitFor(word);
    }
    await h.waitStable(300, 2000);
    const atRest = h.screen().join("\n");
    expect(atRest).not.toContain("Jump to latest");

    h.press("pageUp");
    await h.waitFor("Jump to latest message");
    const held = h.screen();
    // One row, the name of the key that goes back, and the band untouched below it.
    expect(held.filter((line) => line.includes("Jump to latest"))).toHaveLength(1);
    expect(held.find((line) => line.includes("Jump to latest"))).toMatch(/↓ Jump to latest message · End/);
    expect(held.slice(-3).join("\n")).toContain("e2e-model");
    await h.dump("jump-held");

    // End: the live edge, and the pill gone with it.
    h.press("end");
    await h.until(() => !h.screen().join("\n").includes("Jump to latest message"), 2000, "End returns");
    expect(h.screen().slice(-3).join("\n")).toContain("e2e-model");

    // The mouse: a press on the pill's own columns is a click on the pill. SGR
    // mouse reports are 1-based, so the row and the column are read off the screen
    // and moved one cell right and down before they are sent.
    h.press("pageUp");
    await h.waitFor("Jump to latest message");
    const rows = h.screen();
    const row = rows.findIndex((line) => line.includes("Jump to latest"));
    const col = rows[row]!.indexOf("↓") + 3;
    expect(row).toBeGreaterThanOrEqual(0);
    expect(col).toBeGreaterThan(0);
    h.type(`\x1b[<0;${col + 1};${row + 1}M`);
    h.type(`\x1b[<0;${col + 1};${row + 1}m`);
    await h.until(() => !h.screen().join("\n").includes("Jump to latest message"), 3000, "the click returns");
    // A click is not a drag: nothing was selected, so nothing was copied over it.
    expect(h.screen().join("\n")).not.toContain("Copied");
    expect(h.screen().slice(-3).join("\n")).toContain("e2e-model");
    await h.dump("jump-clicked");
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
    await h.waitFor("enter select");
    // The call is in the chat while the form is up: the question and its options
    // are drawn, and it says it is waiting.
    // The call may be revealed at reading speed: wait for its end rather than sampling it.
    await h.waitFor("3 option(s): SQLite, Redis, Other");
    await h.waitFor("Waiting for user input");
    expect(h.screen().join("\n")).toContain("ask_user");
    h.press("down");
    await delay(100);
    h.press("enter");
    await h.waitFor("Q_DONE");
    const toolMsg = h.server.mainRequests()[1]!.body.messages.find((m) => m.role === "tool");
    expect(JSON.stringify(toolMsg)).toContain("Redis");
    // And it settles into the record of what was asked and chosen.
    const settled = h.screen().join("\n");
    expect(settled).toContain("✓ Redis");
    expect(settled).toContain("Q: Which database should I use?");
    expect(settled).toMatch(/○ SQLite/);
    expect(settled).toMatch(/● Redis - Faster/);
  });
});

test("questions: multi-select Space Space Enter (T28A)", async () => {
  await scenario("q-multi", [
    askTool([{ id: "m", question: "Pick two?", multi_select: true, options: [{ label: "A" }, { label: "B" }] }]),
    textScript("Q_DONE"),
  ], async (h) => {
    await h.prompt("Pick");
    await h.waitFor("enter select");
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
    await h.waitFor("enter select");
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
    await h.waitFor("enter select");
    h.press("escape");
    await h.waitFor("Q_DONE");
    const toolMsg = h.server.mainRequests()[1]!.body.messages.find((m) => m.role === "tool");
    expect(JSON.stringify(toolMsg)).toContain("skipped");
  });
});

test("questions: a held Escape is one Escape, so it clears the filter and does not also skip", async () => {
  await scenario("q-esc-held", [
    askTool([{ id: "db", question: "Which?", options: [{ label: "SQLite" }, { label: "Redis" }] }]),
    textScript("Q_DONE"),
  ], async (h) => {
    await h.prompt("Pick");
    await h.waitFor("enter select");
    h.type("Red");
    await h.waitFor("Filter: Red");
    // What holding the key sends: the press, the keyboard's repeat delay, then a stream
    // of repeats a few dozen milliseconds apart. The first clears the filter; a second
    // Escape would skip the whole question, and none of the repeats may be one.
    h.type("\x1b");
    await delay(600);
    for (let i = 0; i < 14; i += 1) {
      h.type("\x1b");
      await delay(35);
    }
    await delay(500);
    const held = h.screen().join("\n");
    expect(held).toContain("enter select");
    expect(held).not.toContain("Filter: Red");
    expect(held).not.toContain("Q_DONE");
    // Let go, wait, and one deliberate Escape does skip it.
    await delay(1700);
    h.type("\x1b");
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
    expect(badges(h)).not.toContain("plan");
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
    // A fresh conversation has spent nothing, and the bar says so: `ctx 0% of 100k`,
    // checked for shape because the share depends on the session.
    await h.waitStable(300, 2000);
    expectContextMarking(turnRow(h));
  });
});

test("/resume restores a saved project's context after /new", async () => {
  await scenario("slash-resume", [textScript("FIRST_DONE"), textScript("RESUMED_DONE")], async (h) => {
    await h.prompt("First hello");
    await h.waitFor("FIRST_DONE");
    await h.prompt("/new");
    await h.waitFor("New conversation.");
    await h.prompt("/resume");
    await h.waitFor("Resume a conversation");
    h.press("enter");
    await h.waitFor("Resumed:");
    expect(h.screen().join("\n")).toContain("First hello");
    await h.prompt("Followup question");
    await h.waitFor("RESUMED_DONE");
    expect(JSON.stringify(h.server.mainRequests()[1]?.body.messages)).toContain("First hello");
  });
});

test("/verify reports missing project checks without a model request", async () => {
  await scenario("slash-verify", [], async (h) => {
    await h.prompt("/verify");
    await h.waitFor("No standard checks found");
    expect(h.server.mainRequests()).toHaveLength(0);
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
    await h.until(() => effortOf(h) === "medium", 15_000, "effort medium");
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
    // The bar comes back on the frame after the turn, as everywhere else here.
    await h.until(() => effortOf(h) === "high", 2000, "effort high label");

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

// The judge is only consulted for a command, and dsh registers no shell tool
// on Windows: there is nothing to ask it about.
test.skipIf(process.platform === "win32")("judge + ghost suggestion send enable_thinking false on a binary template (T28b)", async () => {
  await templateScenario("effort-side-requests", [
    toolScript("bash", { command: "touch t34_probe.txt", description: "create the probe file" }), textScript("TOOLED"),
  ], "auto", BINARY_TEMPLATE, async (h) => {
    // binary template → the default is "on"; footer tells the truth.
    await h.until(() => effortOf(h) === "on", 15_000, "effort on");
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
      // T55: the error line is printed without waiting for the model list, and
      // the list fills the hint in once the server answers, so the screen is
      // waited on for the finished hint rather than for the message alone.
      await h.waitFor("Available: e2e-model. Change it: kumo setup", 30_000);
      const s2 = h.screen().join("\n");
      expect(s2).toContain("Available: e2e-model. Change it: kumo setup");
      // Each turn's receipt belongs under its own error, not above it. Turn 1
      // failed too (401), so it is turn 2's receipt that closes the 404.
      const err2 = s2.indexOf('Model "e2e-model" not found on');
      expect(s2.indexOf("turn 2 ·")).toBeGreaterThan(err2);
      expect(s2.indexOf("turn 1 ·")).toBeLessThan(err2);
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

test("/model switches the wire model and keeps the prompt prefix byte-identical (T37)", async () => {
  await serverScenario(
    "model-switch",
    [textScript("TURN_ONE"), textScript("TURN_TWO"), textScript("TURN_THREE")],
    async (h) => {
      await h.prompt("one");
      await h.waitFor("TURN_ONE");
      const b1 = h.server.mainRequests()[0]!.body;
      expect(b1.model).toBe("e2e-model");

      // The picker: one provider, then the models this route declares.
      await h.prompt("/model");
      await h.waitFor("Model · provider");
      await h.waitFor("Local Server [local] (current route)");
      h.press("enter");
      await h.waitFor("Model · Local Server");
      await h.waitFor("e2e-model Pretty");
      await h.waitFor("e2e-model-2");
      await h.dump("t37-model-picker");
      h.press("down"); await delay(50); h.press("enter");
      await h.waitFor("Model: e2e-model-2 (local) · next message");
      await h.until(() => /e2e-model-2/.test(turnRow(h)), 3000, "the bar follows the route");

      await h.prompt("two");
      await h.waitFor("TURN_TWO");
      const mains = h.server.mainRequests();
      const b2 = mains[mains.length - 1]!.body;
      expect(b2.model).toBe("e2e-model-2");
      // dsh's own durable notice, appended at the end: the cache-safe mechanism.
      expect(JSON.stringify(b2.messages)).toContain("model changed");

      // Cache rule: kumo rewrote NOTHING. The persona is composed at boot (T36),
      // so it still names the first model — a route switch does not touch the
      // prompt, and dsh appends its own notice at the end of the history.
      const sysText = (b: typeof b1): string =>
        JSON.stringify(
          b.messages.filter((m) => ["system", "developer"].includes(m.role)).map((m) => m.content),
        );
      const tools = (b: typeof b1): string => JSON.stringify(b.tools ?? null);
      expect(sysText(b2)).toBe(sysText(b1));
      expect(tools(b2)).toBe(tools(b1));
      expect(sysText(b1)).toContain("powered by e2e-model Pretty");
      // What DOES change is the wire role label: pi-ai sends `developer` for one
      // model and `system` for another. That is the provider's per-model
      // convention, not kumo editing the prompt — and it is why a route switch
      // costs one cache rebuild, exactly like /new would.
      const role = (b: typeof b1): string | undefined =>
        b.messages.find((m) => ["system", "developer"].includes(m.role))?.role;
      expect(role(b1)).toBe("developer");
      expect(role(b2)).toBe("system");

      // f2 walks back to the route remembered before the switch.
      h.press("f2");
      await h.waitFor("Model: e2e-model Pretty (local) · next message");
      await h.prompt("three");
      await h.waitFor("TURN_THREE");
      expect(h.server.mainRequests().at(-1)!.body.model).toBe("e2e-model");
    },
    { server: { models: ["e2e-model", "e2e-model-2"] }, extraModel: "e2e-model-2" },
  );
}, 120_000);

test("/model <route> sets directly and /provider lists them all (T37, T39)", async () => {
  await serverScenario(
    "model-direct",
    [textScript("TURN_DONE")],
    async (h) => {
      // The 100-column terminal wraps a long provider line, so the assertions
      // use fragments that cannot straddle a wrap.
      await h.prompt("/provider");
      await h.waitFor("Providers (2):");
      await h.waitFor("Local Server [local] (current route)");
      await h.waitFor("KUMO_LOCAL_API_KEY");
      await h.waitFor("+ 39 more kumo can add");
      await h.waitFor("In use: local/e2e-model");
      await h.dump("t37-provider-list");

      await h.prompt("/model local/e2e-model-2");
      await h.waitFor("Model: e2e-model-2 (local) · next message");
      await h.prompt("hi");
      await h.waitFor("TURN_DONE");
      expect(h.server.mainRequests().at(-1)!.body.model).toBe("e2e-model-2");
      // The route changed, so the bar reprints the window of the model now in use
      // (50k here, not the 100k of the first route); the reading is checked for
      // shape, and the route cell is what names the model.
      await h.waitStable(300, 2000);
      expectContextMarking(turnRow(h));

      // An unknown provider is refused, naming what is configured.
      await h.prompt("/model grok/x");
      await h.waitFor('Unknown provider "grok"');
      // A model this route never declared is refused too, HERE and not on the
      // next turn: dsh-llm-pi-ai throws UNKNOWN_MODEL for an unconfigured pair.
      await h.prompt("/model local/never-loaded");
      await h.waitFor('is not configured on local');
      expect(h.server.mainRequests().at(-1)!.body.model).toBe("e2e-model-2");
    },
    { server: { models: ["e2e-model", "e2e-model-2"] }, extraModel: "e2e-model-2" },
  );
}, 120_000);
