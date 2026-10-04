import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { beforeAll, test } from "vitest";
import { build, Harness } from "./harness.js";
import { textScript, toolScript, type Script } from "./sse-server.js";

/**
 * The terminal of the presentation video, recorded from the real bruine: the real launcher in a
 * real PTY (104×26, 24-bit colour, the chat weather on), a little project, a scripted model.
 * Every cell of the screen (its character, colours, bold, italic, dim, inverse) is captured 45
 * times a second, with the moments that matter (a key, the reasoning, an approval, the tests),
 * into one JSON the video (promo/, on its own branch) draws cell by cell.
 *
 *   RECORD_VIDEO=1 RECORD_OUT=<file.json> pnpm vitest run test/e2e -t "record the video terminal"
 *
 * Off unless RECORD_VIDEO=1: it is a recording, not a check.
 */
const enabled = process.env.RECORD_VIDEO === "1";
beforeAll(enabled ? build : () => {}, 60_000);

const FPS = 45;
const COLS = Number(process.env.RECORD_COLS ?? 104);
const ROWS = 26;

const HTTP_TS = `export async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  return parse(res);
}

async function parse(res: Response): Promise<unknown> {
  if (!res.ok) throw new Error(\`\${res.status} \${res.statusText}\`);
  return res.json();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
`;
const OLD = "  const res = await fetch(url, init);\n  return parse(res);";
const NEW = [
  "  for (let attempt = 0; ; attempt += 1) {",
  "    const res = await fetch(url, init);",
  "    if (res.ok || attempt === 2) return parse(res);",
  "    await sleep(250 * 2 ** attempt);",
  "  }",
].join("\n");
const TEST_JS = `const lines = ["fetchJson", "  ✓ returns the body on 200", "  ✓ retries a 503 twice", "  ✓ gives up after three attempts", "", "48 passed (1.2s)"];
for (const line of lines) console.log(line);
`;

const usage = (outputTokens: number, inputTokens: number): Script["usage"] => ({ outputTokens, inputTokens, cachedTokens: inputTokens - 300 });
function thinkThen(thought: string, call: Script, delayMs = 55): Script {
  const words = thought.split(" ");
  return {
    ...call,
    usage: usage(40 + words.length * 2, 6100),
    chunks: [...words.map((w, i) => ({ delta: { reasoning_content: `${w}${i < words.length - 1 ? " " : ""}` }, delayMs })), ...call.chunks],
  };
}
function slowText(text: string, delayMs = 40): Script {
  return { usage: usage(text.split(" ").length * 2, 7400), chunks: text.split(" ").map((w, i, all) => ({ delta: { content: `${w}${i < all.length - 1 ? " " : ""}` }, delayMs })) };
}

/** The standard xterm 256-colour palette, for the cells that use one. */
function palette(index: number): string {
  const base = ["#000000", "#cd3131", "#0dbc79", "#e5e510", "#2472c8", "#bc3fbc", "#11a8cd", "#e5e5e5", "#666666", "#f14c4c", "#23d18b", "#f5f543", "#3b8eea", "#d670d6", "#29b8db", "#ffffff"];
  if (index < 16) return base[index]!;
  if (index < 232) {
    const i = index - 16;
    const v = (n: number): number => (n === 0 ? 0 : 55 + n * 40);
    return `#${[Math.floor(i / 36), Math.floor(i / 6) % 6, i % 6].map((n) => v(n).toString(16).padStart(2, "0")).join("")}`;
  }
  const g = (8 + (index - 232) * 10).toString(16).padStart(2, "0");
  return `#${g}${g}${g}`;
}

type Span = [col: number, text: string, fg: string | null, bg: string | null, flags: number];

test.skipIf(!enabled)("record the video terminal", async () => {
  const h = await Harness.start(
    [
      thinkThen("fetchJson gives up on the first 503. Read it, then wrap the call in a loop with a doubling wait, three attempts at most.", toolScript("read", { file_path: "src/http.ts" }, "call_read")),
      thinkThen("Keep the signature so no caller changes.", toolScript("edit", { file_path: "src/http.ts", old_string: OLD, new_string: NEW }, "call_edit")),
      { ...toolScript("bash", { command: "npm test", description: "Run the test suite" }, "call_test"), usage: usage(24, 6900) },
      slowText("fetchJson now retries twice more after a failure, 250 ms then 500 ms apart. The 48 tests pass."),
      slowText("Added a Retries section to the README: three attempts, 250 ms then 500 ms."),
    ],
    "ask",
    false,
    {
      displayName: "Qwen3 Coder",
      // 24-bit colour, and the chat weather and the turn's ring as a user sees them.
      env: { BRUINE_COLOR: "truecolor", COLORTERM: "truecolor", BRUINE_NO_RIPPLE: "0" },
      bruineJson: { effect: "auto", suggestions: false },
      projectPath: "code/api",
      files: {
        "package.json": JSON.stringify({ name: "api", private: true, scripts: { test: "node test.js" } }, null, 2),
        "test.js": TEST_JS,
        "README.md": "# api\n",
      },
    },
  );
  await mkdir(join(h.project, "src"), { recursive: true });
  await writeFile(join(h.project, "src", "http.ts"), HTTP_TS);

  const rowTable: string[] = [];
  const rowIndex = new Map<string, number>();
  const samples: Array<{ t: number; rows: number[] }> = [];
  const markers: Record<string, number> = {};
  const keys: Record<string, number[]> = { prompt: [], queued: [] };
  let t0 = 0;
  const now = (): number => (Date.now() - t0) / 1000;
  const mark = (name: string): void => {
    if (markers[name] === undefined) markers[name] = Number(now().toFixed(3));
  };

  const snapshot = (): string => {
    const buffer = h.term.buffer.active;
    const cell = buffer.getNullCell();
    const rows: number[] = [];
    const texts: string[] = [];
    for (let y = 0; y < ROWS; y += 1) {
      const line = buffer.getLine(buffer.viewportY + y);
      const spans: Span[] = [];
      let text = "";
      for (let x = 0; x < COLS; x += 1) {
        line?.getCell(x, cell);
        if (cell.getWidth() === 0) continue;
        const ch = cell.getChars() || " ";
        text += ch;
        const fg = cell.isFgRGB() ? `#${cell.getFgColor().toString(16).padStart(6, "0")}` : cell.isFgPalette() ? palette(cell.getFgColor()) : null;
        const bg = cell.isBgRGB() ? `#${cell.getBgColor().toString(16).padStart(6, "0")}` : cell.isBgPalette() ? palette(cell.getBgColor()) : null;
        const flags = (cell.isBold() ? 1 : 0) | (cell.isItalic() ? 2 : 0) | (cell.isDim() ? 4 : 0) | (cell.isInverse() ? 8 : 0) | (cell.isUnderline() ? 16 : 0);
        const last = spans.at(-1);
        if (last !== undefined && last[2] === fg && last[3] === bg && last[4] === flags && last[0] + [...last[1]].length === x && cell.getWidth() === 1) {
          last[1] += ch;
        } else {
          spans.push([x, ch, fg, bg, flags]);
        }
      }
      // Trailing blank cells with no background carry nothing.
      while (spans.length > 0) {
        const tail = spans.at(-1)!;
        if (tail[3] !== null || (tail[4] & 8) !== 0) break;
        const trimmed = tail[1].replace(/ +$/, "");
        if (trimmed === "") spans.pop();
        else {
          tail[1] = trimmed;
          break;
        }
      }
      const key = JSON.stringify(spans);
      let index = rowIndex.get(key);
      if (index === undefined) {
        index = rowTable.length;
        rowTable.push(key);
        rowIndex.set(key, index);
      }
      rows.push(index);
      texts.push(text);
    }
    samples.push({ t: now(), rows });
    return texts.join("\n");
  };

  // What is on screen, said once, the first time it is there.
  const watch = (screen: string): void => {
    if (/Thinking/.test(screen)) mark("thinking");
    if (/Thought for/.test(screen)) mark("thought");
    if (/✓ read/.test(screen)) mark("readDone");
    if (/✓ edit/.test(screen)) mark("editDone");
    if (/Allow once/.test(screen) && /Allow edit/.test(screen)) mark("approval1");
    if (/Allow once/.test(screen) && /Allow bash/.test(screen)) mark("approval2");
    if (/48 passed/.test(screen)) mark("testsDone");
    if (/✓ bash/.test(screen)) mark("bashDone");
    if (/fetchJson now retries/.test(screen)) mark("answer");
    if (/next\s+then document it/.test(screen)) mark("queued");
    if (/› then document it in the README/.test(screen)) mark("queueSent");
    if (/Retries section/.test(screen)) mark("queueAnswer");
  };

  // The harness opens at 100×30; the film is drawn from 104×26, so the app lays itself out there.
  h.resize(COLS, ROWS);
  await h.waitFor("Qwen3", 30_000);
  // The weather keeps the screen moving even at rest: wait for the header, not for stillness.
  await delay(1500);
  t0 = Date.now();
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      await h.flush();
      watch(snapshot());
      await delay(1000 / FPS / 2);
    }
  })();
  const typeSlowly = async (text: string, into: number[]): Promise<void> => {
    for (const ch of text) {
      h.type(ch);
      into.push(Number(now().toFixed(3)));
      await delay(28 + Math.round(Math.random() * 22));
    }
  };
  try {
    await delay(500);
    mark("typeStart");
    await typeSlowly("Add a retry with backoff to fetchJson, then run the tests", keys.prompt!);
    await delay(250);
    h.press("enter");
    mark("submit");
    await h.waitFor("Thinking", 15_000);
    await delay(700);
    mark("queueTypeStart");
    await typeSlowly("then document it in the README", keys.queued!);
    await delay(200);
    h.press("enter");
    mark("queueSubmit");
    await h.until(() => markers.approval1 !== undefined, 30_000, "first approval");
    await delay(1100);
    // The approval's own letters: y allows this edit, a remembers this one command.
    h.type("y");
    mark("approve1");
    await h.until(() => markers.approval2 !== undefined, 30_000, "second approval");
    await delay(1300);
    h.type("a");
    mark("approve2");
    await h.until(() => markers.queueAnswer !== undefined, 30_000, "the queued answer");
    await delay(1600);
    mark("end");
  } finally {
    sampling = false;
    await sampler;
    await h.close();
  }

  // One frame every 1/45 s: the last sample at or before it.
  const frames: number[][] = [];
  let at = 0;
  for (let i = 0; i / FPS <= markers.end!; i += 1) {
    while (at + 1 < samples.length && samples[at + 1]!.t <= i / FPS) at += 1;
    frames.push(samples[at]!.rows);
  }
  const out = process.env.RECORD_OUT ?? join(h.project, "..", "terminal.json");
  await writeFile(
    out,
    JSON.stringify({ cols: COLS, rows: ROWS, fps: FPS, rowTable: rowTable.map((r) => JSON.parse(r)), frames, markers, keys }),
  );
  console.log(`recorded ${String(frames.length)} frames, ${String(rowTable.length)} distinct rows, ${JSON.stringify(markers)} -> ${out}`);
}, 180_000);
