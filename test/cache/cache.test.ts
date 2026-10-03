import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ensureProfile } from "../../src/profile.js";
import { resolveDshEntry } from "../../src/launch.js";
import { localServerSettings, renderSettingsYaml } from "../../src/setup/simple.js";
import {
  checkCacheInvariants,
  isMainSessionRequest,
  startFakeModelServer,
  type FakeModelServer,
  type OpenAiRequestLike,
  type ScriptedResponse,
} from "./fake-server.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let fake: FakeModelServer;
let home: string;
let project: string;
let childExited = false;
let childError = "";

async function waitFor(
  cond: () => boolean,
  ms: number,
  label: string,
  diagnostics?: () => string,
): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) {
      throw new Error(`timeout waiting for ${label}${diagnostics ? ` — ${diagnostics()}` : ""}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

const scripts: ScriptedResponse[] = [
  // Turn 1 (Build): read-only exploration answer.
  { text: "Explored the project." },
  // Turn 2 (Plan mode ON): answering without mutating; the write refusal and
  // the plan announcement must arrive as APPENDED messages, never as a
  // changed system prompt or tools array.
  { text: "Plan: I will add note.md once you switch to Build." },
  // Turn 3 (Build again, after on-disk skill + AGENTS.md changes).
  { text: "Added note.md." },
  // The compaction request is a main-session request too (it carries the same
  // system prompt and tools); its answer is the summary.
  { text: "Summary: explored the project, planned, then added note.md." },
  // After compaction: a tool round trip, to prove the new context is append-only too.
  { toolCalls: [{ id: "call_read_1", name: "read", args: JSON.stringify({ file_path: "a.ts" }) }] },
  { text: "a.ts exports a." },
];

beforeAll(async () => {
  fake = await startFakeModelServer(scripts);
  home = await mkdtemp(join(tmpdir(), "kumo-cache-home-"));
  project = await mkdtemp(join(tmpdir(), "kumo-cache-proj-"));
  await writeFile(join(project, "a.ts"), "export const a = 1;\n");
  await writeFile(join(project, "AGENTS.md"), "# AGENTS\nBe kind.\n");

  // Pre-bake a kumo home pointing at the fake server, permission full (the
  // scenario has no interactive approvals), search none.
  const settings = localServerSettings(
    { baseUrl: `http://127.0.0.1:${String(fake.port)}/v1`, models: ["cache-test-model"] },
    "cache-test-model",
  );
  await writeFile(join(home, "settings.yaml"), renderSettingsYaml(settings));
  await writeFile(join(home, ".env"), "KUMO_LOCAL_API_KEY=local\n");
  await writeFile(
    join(home, "kumo.json"),
    JSON.stringify({ mode: "simple", search: { provider: "none" }, permissionMode: "full" }, null, 2),
  );
  const { dir } = await ensureProfile(home);
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    DSH_HOME: home,
    DSH_TELEMETRY_DISABLED: "1",
  };
  const entry = resolveDshEntry();
  expect(entry).toBeDefined();
  const add = spawnSync(
    process.execPath,
    [entry as string, "plugin", "--profile", "kumo", "add", repoRoot],
    { stdio: ["ignore", "pipe", "pipe"], env, cwd: repoRoot },
  );
  expect(add.status, String(add.stderr)).toBe(0);
  expect(dir).toBeTruthy();
}, 240_000);

afterAll(async () => {
  await fake?.close();
});

describe("Cache Hunter (T17)", () => {
  test(
    "system + tools byte-identical across mode flips, skills, AGENTS.md; history append-only",
    async () => {
      const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        KUMO_HOME: home,
        DSH_TELEMETRY_DISABLED: "1",
        // T30: the launch update check must never touch the network here.
        KUMO_NO_UPDATE_CHECK: "1",
      };
      const child = spawn(process.execPath, [join(repoRoot, "dist", "bin.js")], {
        cwd: project,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      child.stdout!.on("data", (d) => {
        childError += String(d);
      });
      child.stderr!.on("data", (d) => {
        childError += String(d);
      });
      child.on("close", (code) => {
        childExited = true;
        if (code !== 0) childError += `\nkumo exited ${String(code)}`;
      });

      const mainRequests = (): OpenAiRequestLike[] =>
        fake.requests
          .map((r) => r.body as OpenAiRequestLike)
          .filter((b) => Array.isArray(b?.messages) && isMainSessionRequest(b));

      child.stdin!.write("explore the project\n");
      await waitFor(
        () => mainRequests().length >= 1,
        120_000,
        "first turn",
        () => `kumo exited: ${String(childExited)}; stderr: ${childError.slice(-900).replace(/[\x1b\r\n]+/g, "|")}; recorded: ${String(fake.requests.length)} (mains ${String(mainRequests().length)}); sample: ${JSON.stringify(fake.requests.slice(0, 2).map((r) => { const b = r.body as OpenAiRequestLike; return { roles: (b.messages ?? []).map((m) => `${m.role}:${typeof m.content}`).join(","), top: Object.keys(b).join(","), system: typeof (b as any).system === "string" ? (b as any).system.slice(0, 40) : (b as any).system }; })).slice(0, 3)}`,
      );

      // Plan ON (no LLM request — slash command + appended announcement).
      child.stdin!.write("/plan\n");
      child.stdin!.write("add a note file please\n");
      await waitFor(() => mainRequests().length >= 2, 120_000, "plan turn");

      // On-disk knowledge changes BETWEEN turns: cache rules say these must be
      // appended as messages, never folded into system or tools.
      await mkdir(join(project, ".agents", "skills"), { recursive: true });
      await writeFile(
        join(project, ".agents", "skills", "notes.md"),
        "# notes\nWrite notes concisely.\n",
      );
      await writeFile(join(project, "AGENTS.md"), "# AGENTS\nBe kind.\nAlso use short names.\n");
      await new Promise<void>((r) => setTimeout(r, 400));

      // Plan OFF → Build.
      child.stdin!.write("/plan\n");
      child.stdin!.write("now write the note\n");
      await waitFor(() => mainRequests().length >= 3, 120_000, "build turn");
      // The last answer is a text-only stream; let the turn settle before
      // quitting, otherwise /exit lands mid-turn and is ignored by design.
      await new Promise((r) => setTimeout(r, 3000));

      // Compaction, the step that costs the most when it gets the cache wrong: the
      // request must be the conversation so far plus one appended instruction.
      child.stdin!.write("/compact\n");
      await waitFor(() => mainRequests().length >= 4, 60_000, "compaction request");
      await new Promise((r) => setTimeout(r, 2500));
      // Then a turn with a tool call in the new, compacted context.
      child.stdin!.write("read a.ts please\n");
      await waitFor(() => mainRequests().length >= 6, 60_000, "tool round trip after compaction");
      await new Promise((r) => setTimeout(r, 2500));
      child.stdin!.write("/exit\n");
      await waitFor(() => childExited, 20_000, "kumo exit");
      if (!childExited) {
        child.stdin!.write("/exit\n");
        await waitFor(() => childExited, 60_000, "kumo exit (second /exit)");
      }

      const mains = mainRequests();
      expect(mains.length, `main-session requests; stderr: ${childError}`).toBeGreaterThanOrEqual(3);

      const names = (mains[0]!.tools as Array<{ function?: { name?: string }; name?: string }> | undefined ?? [])
        .map((tool) => tool.function?.name ?? tool.name);
      const kept = ["read", "write", "edit", "glob", "grep", "read_image", "web_fetch", "web_search", "ask_user_question", "todo_write", "subagent", "skill", "job_list", "job_output", "job_kill"];
      // dsh registers a shell tool only where a POSIX shell is on PATH: a
      // Windows runner has no bash, so it cannot be in the catalog there.
      if (process.platform !== "win32") kept.push("bash");
      const missing = kept.filter((tool) => !names.includes(tool));
      expect(missing, `lean catalog is missing: ${missing.join(", ")}`).toEqual([]);
      for (const dropped of ["workflow", "ralph", "create_goal", "get_goal", "update_goal", "list_agents", "send_message", "interrupt_agent", "subagent_fork", "present", "str_replace_editor", "exit_plan_mode"]) {
        expect(names, `lean catalog contains ${dropped}`).not.toContain(dropped);
      }

      // The three turns of the original protocol: plan on, plan off, skill and AGENTS.md changed.
      const failures = checkCacheInvariants(mains.slice(0, 3));
      expect(failures, failures.join("\n")).toEqual([]);

      // Compaction: same system prompt, same tools, the whole earlier history as its
      // prefix, and nothing new but the instruction at the end.
      expect(mains.length, "compaction and the tool round trip reached the server").toBeGreaterThanOrEqual(6);
      const body = (m: OpenAiRequestLike) => (m.messages ?? []).filter((x) => x.role !== "system" && x.role !== "developer");
      const sysOf = (m: OpenAiRequestLike) => JSON.stringify((m.messages ?? []).find((x) => x.role === "system" || x.role === "developer"));
      const before = mains[2]!;
      const compaction = mains[3]!;
      expect(sysOf(compaction), "compaction keeps the system prompt").toBe(sysOf(before));
      expect(JSON.stringify(compaction.tools ?? null), "compaction keeps the tools").toBe(JSON.stringify(before.tools ?? null));
      const earlier = body(before);
      const asked = body(compaction);
      expect(asked.length, "compaction only appends").toBeGreaterThan(earlier.length);
      earlier.forEach((message, i) => expect(JSON.stringify(asked[i]), `compaction message ${String(i)} is untouched`).toBe(JSON.stringify(message)));
      expect(JSON.stringify(asked.slice(earlier.length)), "what was appended is the compaction instruction").toMatch(/compaction/i);

      // After it: the context is new and short, but the prefix that is cached is the same,
      // and the tool round trip inside it is append-only again.
      const afterCompaction = mains[4]!;
      expect(sysOf(afterCompaction), "the system prompt survives compaction").toBe(sysOf(before));
      expect(JSON.stringify(afterCompaction.tools ?? null), "the tools survive compaction").toBe(JSON.stringify(before.tools ?? null));
      expect(body(afterCompaction).length, "the compacted context is shorter than what it replaced").toBeLessThan(asked.length);
      const roundTrip = checkCacheInvariants(mains.slice(4, 6));
      expect(roundTrip, roundTrip.join("\n")).toEqual([]);

      // The plan-mode announcements traveled as APPENDED messages — prove they
      // are present in the third request's history, and the system prompt of
      // that request still has no plan text.
      const third = JSON.stringify(mains[2]);
      expect(third).toContain("Plan mode is on");
      const sys3 = (mains[2]!.messages.find((m) => m.role === "system" || m.role === "developer")?.content ?? "") as string;
      expect(sys3).not.toContain("Plan mode is on");
      expect(sys3).toContain("You are kumo");
    },
    300_000,
  );
});
