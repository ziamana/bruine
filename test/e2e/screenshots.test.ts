import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { crc32, deflateSync } from "node:zlib";
import { beforeAll, test } from "vitest";
import { build, Harness } from "./harness.js";
import { toolScript, type Script } from "./sse-server.js";

/**
 * Stills of the real bruine, colours and all, at the moments worth showing: the first screen, the
 * reasoning, an approval, a model that went quiet and was retried, and the end of the turn. Each
 * is every cell of the screen, as the video recorder captures them; a renderer turns them into
 * pictures.
 *
 *   RECORD_SHOTS=1 RECORD_OUT=<file.json> pnpm vitest run test/e2e -t "record the screenshots"
 *
 * Off unless RECORD_SHOTS=1: it is a recording, not a check.
 */
const enabled = process.env.RECORD_SHOTS === "1";
beforeAll(enabled ? build : () => {}, 60_000);

const COLS = 104;
const ROWS = 30;

type Span = [col: number, text: string, fg: string | null, bg: string | null, flags: number];

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

/** A small PNG: night sky to lavender, with a drop falling into rings. */
function mockup(width = 192, height = 108): Buffer {
  const rows: number[] = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(0);
    for (let x = 0; x < width; x += 1) {
      const t = y / height;
      let [r, g, b] = [11 + 60 * t, 13 + 40 * t, 20 + 120 * t];
      const dx = (x - width / 2) / width;
      const dy = (y - height * 0.62) / height;
      const ring = Math.abs(Math.hypot(dx * 1.0, dy * 3.2) - 0.18);
      if (ring < 0.012) [r, g, b] = [180, 167, 255];
      if (Math.abs(x - width / 2) < 1.5 && y > height * 0.15 && y < height * 0.55) [r, g, b] = [125, 207, 255];
      rows.push(Math.round(r), Math.round(g), Math.round(b));
    }
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    data.copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from(rows))), chunk("IEND", Buffer.alloc(0))]);
}

const usage = (outputTokens: number, inputTokens: number): Script["usage"] => ({ outputTokens, inputTokens, cachedTokens: inputTokens - 300 });
function thinkThen(thought: string, call: Script): Script {
  const words = thought.split(" ");
  return { ...call, usage: usage(60, 6100), chunks: [...words.map((w, i) => ({ delta: { reasoning_content: `${w}${i < words.length - 1 ? " " : ""}` }, delayMs: 60 })), ...call.chunks] };
}

test.skipIf(!enabled)("record the screenshots", async () => {
  const PAGE = "export function render(rows: Row[]): string {\n  return rows.map(cell).join(\"\\n\");\n}\n";
  const h = await Harness.start(
    [
      thinkThen("Look at the mockup first.", toolScript("read_image", { file_path: "design/mockup.png" }, "call_image")),
      thinkThen("The report needs a summary row. Read the renderer first.", toolScript("read", { file_path: "src/report.ts" }, "call_read")),
      thinkThen("Add the summary row after the table, then write the new file.", toolScript("write", { file_path: "src/summary.ts", content: "export const summary = (rows: number[]) => rows.reduce((a, b) => a + b, 0);\n" }, "call_write")),
      // The model starts its answer, then goes quiet: the silence budget runs out and dsh retries.
      { chunks: [{ delta: { content: "Done: the" } }], finishDelayMs: 60_000 },
      { usage: usage(30, 7400), chunks: "Done: src/summary.ts adds the summary row, and the report renders it after the table.".split(" ").map((w, i, all) => ({ delta: { content: `${w}${i < all.length - 1 ? " " : ""}` }, delayMs: 30 })) },
    ],
    "ask",
    false,
    {
      displayName: "Qwen3 Coder",
      env: { BRUINE_COLOR: "truecolor", COLORTERM: "truecolor", BRUINE_SILENCE_SCALE: "0.02" },
      bruineJson: { effect: "auto", suggestions: false },
      projectPath: "code/report",
      imageInput: true,
      files: { "README.md": "# report\n" },
    },
  );
  await mkdir(join(h.project, "src"), { recursive: true });
  await writeFile(join(h.project, "src", "report.ts"), PAGE);
  await mkdir(join(h.project, "design"), { recursive: true });
  await writeFile(join(h.project, "design", "mockup.png"), mockup());
  h.resize(COLS, ROWS);
  const shots: Record<string, Span[][]> = {};
  const capture = (name: string): void => {
    const buffer = h.term.buffer.active;
    const cell = buffer.getNullCell();
    const rows: Span[][] = [];
    for (let y = 0; y < ROWS; y += 1) {
      const line = buffer.getLine(buffer.viewportY + y);
      const spans: Span[] = [];
      for (let x = 0; x < COLS; x += 1) {
        line?.getCell(x, cell);
        if (cell.getWidth() === 0) continue;
        const ch = cell.getChars() || " ";
        const fg = cell.isFgRGB() ? `#${cell.getFgColor().toString(16).padStart(6, "0")}` : cell.isFgPalette() ? palette(cell.getFgColor()) : null;
        const bg = cell.isBgRGB() ? `#${cell.getBgColor().toString(16).padStart(6, "0")}` : cell.isBgPalette() ? palette(cell.getBgColor()) : null;
        const flags = (cell.isBold() ? 1 : 0) | (cell.isItalic() ? 2 : 0) | (cell.isDim() ? 4 : 0) | (cell.isInverse() ? 8 : 0) | (cell.isUnderline() ? 16 : 0);
        const last = spans.at(-1);
        if (last !== undefined && last[2] === fg && last[3] === bg && last[4] === flags && last[0] + [...last[1]].length === x && cell.getWidth() === 1) last[1] += ch;
        else spans.push([x, ch, fg, bg, flags]);
      }
      rows.push(spans);
    }
    shots[name] = rows;
  };
  const screen = (): string => h.screen().join("\n");
  try {
    await h.waitFor("Qwen3", 30_000);
    await delay(1500);
    capture("1-start");
    await h.prompt("Add a summary row to the report");
    await h.until(() => /Thinking/.test(screen()), 15_000, "thinking");
    await delay(700);
    capture("2-thinking");
    await h.until(() => /PNG 192×108/.test(screen()), 30_000, "the image");
    await delay(400);
    capture("2b-image");
    await h.until(() => /Allow write/.test(screen()), 30_000, "the approval");
    await delay(600);
    capture("3-approval");
    h.type("y");
    await h.until(() => /Retry 1\/5/.test(screen()), 30_000, "the retry");
    await delay(150);
    capture("4-retry");
    await h.until(() => /renders it after the table/.test(screen()), 30_000, "the answer");
    await delay(1500);
    capture("5-done");
  } catch (error) {
    const buffer = h.term.buffer.active;
    const all = Array.from({ length: buffer.length }, (_, i) => buffer.getLine(i)?.translateToString(true) ?? "");
    console.error(`SCREEN AT FAILURE:\n${all.join("\n")}`);
    throw error;
  } finally {
    await h.close();
  }
  const out = process.env.RECORD_OUT ?? join(h.project, "..", "shots.json");
  await mkdir(join(out, ".."), { recursive: true });
  await writeFile(out, JSON.stringify({ cols: COLS, rows: ROWS, shots }));
}, 120_000);

/** The same bruine on a light terminal theme: every colour is fitted to the background it reports. */
test.skipIf(!enabled)("record the light screenshot", async () => {
  const h = await Harness.start(
    [toolScript("read", { file_path: "src/report.ts" }, "call_read"), { ...toolScript("edit", { file_path: "src/report.ts", old_string: "  return rows.map(cell).join(\"\\n\");", new_string: "  const body = rows.map(cell).join(\"\\n\");\n  return `${body}\\n${summary(rows)}`;" }, "call_edit"), usage: usage(40, 6100) }, { usage: usage(20, 6400), chunks: [{ delta: { content: "The report now ends with its summary row." } }] }],
    "auto",
    false,
    {
      displayName: "Qwen3 Coder",
      env: { BRUINE_COLOR: "truecolor", COLORTERM: "truecolor" },
      bruineJson: { effect: "off", suggestions: false },
      projectPath: "code/report",
      background: "#fafafa",
    },
  );
  await mkdir(join(h.project, "src"), { recursive: true });
  await writeFile(join(h.project, "src", "report.ts"), "export function render(rows: Row[]): string {\n  return rows.map(cell).join(\"\\n\");\n}\n");
  h.resize(COLS, 22);
  const out = process.env.RECORD_OUT ?? join(h.project, "..", "shots.json");
  try {
    await h.waitFor("Qwen3", 30_000);
    await delay(800);
    await h.prompt("End the report with its summary row");
    await h.until(() => /ends with its summary row/.test(h.screen().join("\n")), 30_000, "the answer");
    await delay(1200);
    const buffer = h.term.buffer.active;
    const cell = buffer.getNullCell();
    const rows: Span[][] = [];
    for (let y = 0; y < 22; y += 1) {
      const line = buffer.getLine(buffer.viewportY + y);
      const spans: Span[] = [];
      for (let x = 0; x < COLS; x += 1) {
        line?.getCell(x, cell);
        if (cell.getWidth() === 0) continue;
        const ch = cell.getChars() || " ";
        const fg = cell.isFgRGB() ? `#${cell.getFgColor().toString(16).padStart(6, "0")}` : cell.isFgPalette() ? palette(cell.getFgColor()) : null;
        const bg = cell.isBgRGB() ? `#${cell.getBgColor().toString(16).padStart(6, "0")}` : cell.isBgPalette() ? palette(cell.getBgColor()) : null;
        const flags = (cell.isBold() ? 1 : 0) | (cell.isItalic() ? 2 : 0) | (cell.isDim() ? 4 : 0) | (cell.isInverse() ? 8 : 0) | (cell.isUnderline() ? 16 : 0);
        spans.push([x, ch, fg, bg, flags]);
      }
      rows.push(spans);
    }
    await writeFile(out.replace(/\.json$/, "-light.json"), JSON.stringify({ cols: COLS, rows: 22, background: "#fafafa", shots: { "6-light": rows } }));
  } finally {
    await h.close();
  }
}, 120_000);
