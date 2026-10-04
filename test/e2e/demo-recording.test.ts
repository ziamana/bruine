import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { beforeAll, test } from "vitest";
import { build, Harness, root } from "./harness.js";
import { textScript, toolScript, type Script } from "./sse-server.js";

/**
 * The README's demo: the real bruine, in a real terminal (node-pty, 100×30), on a real little
 * project, with a scripted model, recorded as an asciinema cast (docs/demo/bruine.cast).
 * docs/demo/README.md says how the cast becomes the animated SVG the README shows.
 *
 * Off unless RECORD_DEMO=1: it is a recording, not a check.
 */
const enabled = process.env.RECORD_DEMO === "1";
beforeAll(enabled ? build : () => {}, 60_000);

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

/** Words of reasoning, streamed a little at a time, then the call itself. */
/** What a real turn reports, so the receipts and the footer read like a session. */
const usage = (outputTokens: number, inputTokens: number): Script["usage"] => ({ outputTokens, inputTokens, cachedTokens: inputTokens - 300 });

function thinkThen(thought: string, call: Script): Script {
  const words = thought.split(" ");
  return {
    ...call,
    usage: usage(40 + words.length * 2, 6100),
    chunks: [...words.map((w, i) => ({ delta: { reasoning_content: `${w}${i < words.length - 1 ? " " : ""}` }, delayMs: 70 })), ...call.chunks],
  };
}

function slowText(text: string): Script {
  return { usage: usage(text.split(" ").length * 2, 7400), chunks: text.split(" ").map((w, i, all) => ({ delta: { content: `${w}${i < all.length - 1 ? " " : ""}` }, delayMs: 45 })) };
}

test.skipIf(!enabled)("record the README demo", async () => {
  const h = await Harness.start(
    [
      thinkThen("fetchJson gives up on the first 503. Read it first, then wrap the call in a loop with a doubling wait, three attempts at most.", toolScript("read", { file_path: "src/http.ts" }, "call_read")),
      thinkThen("Keep the signature so no caller changes.", toolScript("edit", { file_path: "src/http.ts", old_string: OLD, new_string: NEW }, "call_edit")),
      { ...toolScript("bash", { command: "npm test", description: "Run the test suite" }, "call_test"), usage: usage(24, 6900) },
      slowText("fetchJson now retries twice more after a failure, 250 ms then 500 ms apart. The 48 tests pass."),
      slowText("Added a Retries section to the README: three attempts, 250 ms then 500 ms."),
    ],
    "ask",
    false,
    {
      displayName: "Qwen3 Coder 30B",
      // 256 colours: what svg-term renders faithfully (it has no 24-bit colour).
      env: { BRUINE_COLOR: "256" },
      bruineJson: { effect: "off", suggestions: false },
      projectPath: "code/api",
      files: {
        "package.json": JSON.stringify({ name: "api", private: true, scripts: { test: "node test.js" } }, null, 2),
        "test.js": TEST_JS,
        "README.md": "# api\n",
      },
    },
  );
  const started = Date.now();
  const events: Array<[number, "o", string]> = [];
  h.child.onData((data) => events.push([(Date.now() - started) / 1000, "o", data]));
  await mkdir(join(h.project, "src"), { recursive: true });
  await writeFile(join(h.project, "src", "http.ts"), HTTP_TS);
  const typeSlowly = async (text: string): Promise<void> => {
    for (const ch of text) {
      h.type(ch);
      await delay(35 + Math.round(Math.random() * 30));
    }
  };
  try {
    await h.waitFor("Qwen3", 30_000);
    await delay(1200);
    await typeSlowly("Add a retry with backoff to fetchJson, then run the tests");
    await delay(400);
    h.press("enter");
    // While it works, the next task goes in the queue.
    await h.waitFor("Thinking", 15_000);
    await delay(900);
    await typeSlowly("then document it in the README");
    await delay(300);
    h.press("enter");
    await h.waitFor("Allow once", 30_000);
    await delay(1400);
    h.press("enter");
    await h.waitFor("Allow once", 30_000);
    await delay(1400);
    h.press("enter");
    await h.waitFor("48 tests pass", 30_000);
    await h.waitFor("Retries section", 30_000);
    await delay(2500);
  } finally {
    const header = { version: 2, width: 100, height: 30, timestamp: Math.floor(started / 1000), title: "bruine", env: { TERM: "xterm-256color", SHELL: "/bin/bash" } };
    const cast = [JSON.stringify(header), ...events.map((e) => JSON.stringify([Number(e[0].toFixed(3)), e[1], e[2]]))].join("\n") + "\n";
    await mkdir(join(root, "docs", "demo"), { recursive: true });
    await writeFile(join(root, "docs", "demo", "bruine.cast"), cast);
    await h.close();
  }
}, 180_000);
