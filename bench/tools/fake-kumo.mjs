/**
 * T36 — a fake kumo for the runner's unit tests: same argv and environment as
 * the real launcher, but it "solves" the task the way the test asks it to and
 * writes the session log dsh would have written, so the runner's copy,
 * metrics, verdict and resume paths are all exercised without a model server.
 *
 * Env:
 *   FAKE_KUMO_SOLVE       file to create in cwd (usually the check's sentinel)
 *   FAKE_KUMO_CONTENT     text to write into FAKE_KUMO_SOLVE
 *   FAKE_KUMO_APPEND      file to append a line to instead of writing
 *   FAKE_KUMO_APPEND_LINE the line to append
 *   FAKE_KUMO_EXIT        exit code (default 0)
 *   FAKE_KUMO_HANG        "1": never exit (the wall-clock limit must kill it)
 *   FAKE_KUMO_TOKENS      output tokens to report (default 1234)
 *   FAKE_KUMO_TOOLS       tool calls to report (default 3)
 *   FAKE_KUMO_ERROR       "1": end the turn with an error
 *   FAKE_KUMO_NO_LOG      "1": write no session log at all
 *   FAKE_KUMO_LOG_FORMAT  "zstd": compress the log like dsh does by default
 */
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as zlib from "node:zlib";

const env = process.env;
const home = env["DSH_HOME"] ?? env["KUMO_HOME"] ?? "";
const prompt = process.argv[2] ?? "";

if (env["FAKE_KUMO_SOLVE"]) {
  await writeFile(env["FAKE_KUMO_SOLVE"], env["FAKE_KUMO_CONTENT"] ?? "solved\n", "utf8");
}
if (env["FAKE_KUMO_APPEND"]) {
  await appendFile(env["FAKE_KUMO_APPEND"], `${env["FAKE_KUMO_APPEND_LINE"] ?? "appended\n"}\n`, "utf8");
}

if (env["FAKE_KUMO_NO_LOG"] !== "1" && home !== "") {
  const tokens = Number(env["FAKE_KUMO_TOKENS"] ?? "1234");
  const tools = Number(env["FAKE_KUMO_TOOLS"] ?? "3");
  const dir = join(home, "sessions", "--bench-project--", "session-bench");
  await mkdir(dir, { recursive: true });
  const rows = [
    { type: "turn/start", seq: 0, time: 1, data: {} },
    ...Array.from({ length: tools }, (_, i) => ({
      type: "tool/call",
      seq: i + 1,
      time: i + 2,
      data: { callId: `call-${String(i)}`, name: "read", arguments: "{}" },
    })),
    {
      type: "assistant/message",
      seq: tools + 1,
      time: tools + 2,
      data: { usage: { inputTokens: 4242, outputTokens: tokens }, message: { content: [] } },
    },
    {
      type: "turn/end",
      seq: tools + 2,
      time: tools + 3,
      data: {
        reason:
          env["FAKE_KUMO_ERROR"] === "1"
            ? { kind: "error", error: { code: "fake_error", message: "fake kumo was told to fail" } }
            : { kind: "completed" },
      },
    },
  ];
  const text = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
  if (env["FAKE_KUMO_LOG_FORMAT"] === "zstd") {
    if (typeof zlib.zstdCompressSync !== "function") {
      process.stderr.write("fake kumo: this Node cannot write a zstd log\n");
      process.exit(70);
    }
    await writeFile(join(dir, "v3.jsonl.zstd"), zlib.zstdCompressSync(Buffer.from(text, "utf8")));
  } else {
    await writeFile(join(dir, "v3.jsonl"), text, "utf8");
  }
}

process.stdout.write(`fake kumo: saw a ${String(prompt.length)}-char prompt\n`);

if (env["FAKE_KUMO_HANG"] === "1") {
  setInterval(() => {}, 1 << 30);
} else {
  process.exit(Number(env["FAKE_KUMO_EXIT"] ?? "0"));
}
