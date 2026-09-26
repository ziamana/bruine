import { describe, expect, test } from "vitest";
import { apply, Modes, PLAN_OFF_TEXT, PLAN_ON_TEXT } from "../src/plugins/modes.js";
import { askJudge, judgePrompt } from "../src/gate/judge.js";
import { fakeCtx } from "./fakes.js";

function harness(services: Record<string, unknown> = {}, opts: { terminal?: boolean } = {}) {
  const fake = fakeCtx(services);
  const agent = { session: {}, inject: (m: unknown) => injected.push(m) };
  const injected: unknown[] = [];
  apply(fake.ctx as any);
  // T42: `ui` is what makes a terminal exist. With one, this is an interactive
  // session and `ask` stays `ask`. Without one it is a headless run: the gate is
  // reached through `modes.govern(agent)` and `ask` has no answerer.
  const terminal = opts.terminal !== false;
  const repl: Record<string, unknown> = terminal
    ? { agent, ui: { footer: { set: () => {} }, requestRender: () => {}, addChat: () => {} } }
    : { agent };
  fake.provided.set("kumoRepl", repl);
  for (const { services: deps, cb } of fake.injected) {
    if (deps.includes("kumoRepl")) cb({ kumoRepl: repl });
  }
  const modes: any = fake.provided.get("kumoModes");
  if (!terminal) modes.govern(agent);
  const preExecute = (name: string, args: unknown, callId = "c1", execAgent: unknown = agent) =>
    fake.emit(
      "tools/pre-execute",
      { name, arguments: JSON.stringify(args), agent: execAgent, callId },
      async () => ({ kind: "delegate" }),
    ) as Promise<any>;
  return { fake, modes, preExecute, injected, agent, otherAgent: { session: {} } };
}

const llmReturning = (text: string): any => ({
  stream: async function* () {
    yield { type: "text-delta", text };
  },
});

describe("kumo gate (T16.C)", () => {
  test("ask mode: bash asks, read-only allows", async () => {
    const { modes, preExecute } = harness();
    modes.permission = "ask";
    expect((await preExecute("bash", { command: "ls" })).kind).toBe("ask");
    expect((await preExecute("read", { path: "a" })).kind).toBe("allow");
    expect(modes.log.length).toBe(2);
  });

  test("records each gate decision by call ID for the approval handler", async () => {
    const { modes, preExecute } = harness();
    modes.permission = "auto";
    expect((await preExecute("bash", { command: "ls" }, "safe")).kind).toBe("allow");
    expect(modes.decisionFor("safe")).toBe("allow");
    modes.permission = "ask";
    expect((await preExecute("bash", { command: "ls" }, "needs-approval")).kind).toBe("ask");
    expect(modes.decisionFor("needs-approval")).toBe("ask");
    modes.permission = "full";
    expect((await preExecute("bash", { command: "ls" }, "full-access")).kind).toBe("allow");
    expect(modes.decisionFor("full-access")).toBe("allow");
    expect(modes.decisionFor("missing")).toBeUndefined();
  });

  test("delegates other agents' calls to next()", async () => {
    const { preExecute, otherAgent } = harness();
    const d = await preExecute("bash", { command: "ls" }, "c9", otherAgent);
    expect(d.kind).toBe("delegate");
  });

  test("governs subagents and their descendants, but not unrelated agents", async () => {
    const h = harness();
    const child = { session: { id: "child" } };
    const grandchild = { session: { id: "grandchild" } };
    h.fake.provided.set("agents", {
      list: () => [h.agent, child, grandchild, h.otherAgent],
      isOwnedBy: (id: string, owner: unknown) =>
        (id === "child" && owner === h.agent) || (id === "grandchild" && owner === child),
    });
    h.modes.plan = true;
    expect((await h.preExecute("write", { file_path: "a.txt" }, "child-write", child)).kind).toBe("deny");
    expect((await h.preExecute("bash", { command: "touch a.txt" }, "grandchild-bash", grandchild)).kind).toBe("deny");
    expect((await h.preExecute("write", { file_path: "a.txt" }, "other-write", h.otherAgent)).kind).toBe("delegate");
  });
});

describe("the gate without a terminal (T42)", () => {
  /** A REPL-less run: `govern()` names the agent, and there is no `ui`. */
  const headless = (services: Record<string, unknown> = {}) => harness(services, { terminal: false });

  test("ask with nobody to ask DENIES, and the reason names the way out", async () => {
    const h = headless();
    h.modes.permission = "ask";
    const d = await h.preExecute("bash", { command: "ls" });
    // Failing open would make the gate decorative with the sandbox open.
    expect(d.kind).toBe("deny");
    expect(d.reason).toContain("no terminal to ask on");
    expect(d.reason).toContain("--permission-mode full");
    expect(h.modes.log.at(-1)).toMatchObject({ tool: "bash", decision: "deny", via: "no-terminal" });
  });

  test("the governed headless agent is gated, not delegated", async () => {
    const h = headless();
    h.modes.permission = "full";
    // A bash outside the workspace is denied even with no terminal present.
    const d = await h.preExecute("bash", { command: "rm -rf /etc" });
    expect(d.kind).not.toBe("delegate");
  });

  test("read-only tools still run: no terminal does not mean no work", async () => {
    const h = headless();
    h.modes.permission = "ask";
    expect((await h.preExecute("read", { path: "a" })).kind).toBe("allow");
  });

  test("plan mode still denies, and the reason is the plan, not the terminal", async () => {
    const h = headless();
    h.modes.permission = "full";
    h.modes.plan = true;
    const d = await h.preExecute("write", { path: "a", content: "x" });
    expect(d.kind).toBe("deny");
    expect(d.reason).not.toContain("no terminal");
  });

  test("no judge call: a second model call in a headless run buys nothing", async () => {
    let asked = 0;
    const h = headless({
      llm: {
        stream: async function* () {
          asked += 1;
          yield { type: "text-delta", text: "ALLOW" };
        },
      },
    });
    h.modes.permission = "auto";
    await h.preExecute("bash", { command: "ls" });
    expect(asked).toBe(0);
  });

  test("an agent nobody governs is still delegated, never decided", async () => {
    const h = headless();
    h.modes.permission = "full";
    const d = await h.preExecute("bash", { command: "ls" }, "c9", { session: {} });
    expect(d.kind).toBe("delegate");
  });
});
  test("default permission is auto for fresh installs, existing ask is kept (T31.4)", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const prev = process.env.DSH_HOME;
    const fresh = await mkdtemp(join(tmpdir(), "kumo-fresh-"));
    process.env.DSH_HOME = fresh;
    try {
      const { Modes } = await import("../src/plugins/modes.js");
      const { apply } = await import("../src/plugins/modes.js");
      const { fakeCtx } = await import("./fakes.js");
      const mkModes = async (): Promise<string> => {
        const fake = fakeCtx();
        apply(fake.ctx as never);
        const modes = fake.provided.get("kumoModes") as { permission: string };
        return modes.permission;
      };
      expect(await mkModes()).toBe("auto");
      expect(Modes).toBeDefined();
      await writeFile(join(fresh, "kumo.json"), JSON.stringify({ access: "ask" }));
      expect(await mkModes()).toBe("ask");
    } finally {
      if (prev === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = prev;
    }
  });

  test("full access: nothing asks", async () => {
    const { modes, preExecute } = harness();
    modes.permission = "full";
    expect((await preExecute("bash", { command: "rm -rf x" })).kind).toBe("allow");
  });

  test("plan mode denies mutations and announces as appended messages", async () => {
    const { modes, preExecute, injected } = harness();
    modes.permission = "ask";
    modes.togglePlan();
    expect(injected.length).toBe(1);
    const msg: any = injected[0];
    expect(msg.content[0].text).toBe(PLAN_ON_TEXT);
    expect((await preExecute("write", { path: "a.ts" })).kind).toBe("deny");
    expect((await preExecute("write", { path: "a.ts" })).reason).toContain("Plan mode is on");
    expect((await preExecute("bash", { command: "ls" })).kind).toBe("allow");
    modes.togglePlan();
    expect((injected[1] as any).content[0].text).toBe(PLAN_OFF_TEXT);
    expect((await preExecute("write", { path: "a.ts" })).kind).toBe("ask"); // back to ask mode
  });

  test("auto mode consults the fast model for judge cases", async () => {
    const { modes, preExecute } = harness({ llm: llmReturning("ALLOW"), agentDefaultModel: { currentSelection: () => ({ provider: "p", model: "m" }) } });
    modes.permission = "auto";
    const d = await preExecute("bash", { command: "npm test" });
    expect(d.kind).toBe("allow");
    expect(modes.log[modes.log.length - 1]?.via).toBe("fast-model");
  });

  test("auto mode: fast model ASK → ask; no llm → ask", async () => {
    const a = harness({ llm: llmReturning("ASK") });
    a.modes.permission = "auto";
    expect((await a.preExecute("bash", { command: "make deploy" })).kind).toBe("ask");

    const b = harness();
    b.modes.permission = "auto";
    expect((await b.preExecute("bash", { command: "make deploy" })).kind).toBe("ask");
  });

  test("Always for this session bypasses later asks for the SAME full command", async () => {
    const { modes, preExecute } = harness();
    modes.permission = "ask";
    const first = await preExecute("bash", { command: "npm test" }, "call-7");
    expect(first.kind).toBe("ask");
    modes.rememberFor("call-7");
    expect((await preExecute("bash", { command: "npm test" }, "call-8")).kind).toBe("allow");
    // T18.6: a different full command is a different rule…
    expect((await preExecute("bash", { command: "npm test --watch" }, "call-9")).kind).toBe("ask");
    // …and dangerous commands are never covered by "Always" at all (T18.5).
    modes.sessionAllowed.add("bash:git push");
    expect((await preExecute("bash", { command: "git push" }, "call-10")).kind).toBe("ask");
  });

  test("slash commands /plan and /permissions", () => {
    const { modes } = harness();
    expect(modes.runCommand("/plan")).toBe("Plan mode: on (read-only)");
    expect(modes.runCommand("/plan off")).toBe("Plan mode: off (build)");
    expect(modes.runCommand("/plan on")).toBe("Plan mode: on (read-only)");
    expect(modes.runCommand("/plan on")).toBe("Plan mode: on (read-only)");
    expect(modes.runCommand("/nope")).toBeUndefined();
    expect(modes.runCommand("/permissions")).toContain("No permission decisions yet");
  });

describe("Modes class", () => {
  test("cyclePermission: ask → auto → full (with confirm) → ask", async () => {
    const m = new Modes("ask");
    expect(await m.cyclePermission()).toBe("auto"); // no confirm needed for auto
    let confirm = false;
    m.setConfirmFullAccess(async () => confirm);
    confirm = false;
    expect(await m.cyclePermission()).toBe("auto"); // full refused → stays
    confirm = true;
    expect(await m.cyclePermission()).toBe("full");
    expect(m.describe().badges).toEqual(["FULL ACCESS"]);
    expect(await m.cyclePermission()).toBe("ask");
  });

  test("badges include PLAN when planning", () => {
    const m = new Modes("ask");
    m.togglePlan();
    expect(m.describe().badges).toEqual(["plan", "ask"]);
  });

  test("mode changes emit transient notices, not chat (T24.4)", async () => {
    const { NOTICE_PLAN_ON, NOTICE_PLAN_OFF, NOTICE_ASK, NOTICE_AUTO, NOTICE_FULL } = await import(
      "../src/plugins/modes.js"
    );
    const m = new Modes("ask");
    const notices: Array<{ text: string; opts?: { red?: boolean } }> = [];
    m.showNotice = (text, opts) => notices.push({ text, opts });
    m.togglePlan();
    expect(notices.at(-1)?.text).toBe(NOTICE_PLAN_ON);
    m.togglePlan();
    expect(notices.at(-1)?.text).toBe(NOTICE_PLAN_OFF);
    await m.cyclePermission();
    expect(m.permission).toBe("auto");
    expect(notices.at(-1)?.text).toBe(NOTICE_AUTO);
    m.setConfirmFullAccess(async () => true);
    await m.cyclePermission();
    expect(m.permission).toBe("full");
    expect(notices.at(-1)?.text).toBe(NOTICE_FULL);
    expect(notices.at(-1)?.opts?.red).toBe(true);
    await m.cyclePermission();
    expect(m.permission).toBe("ask");
    expect(notices.at(-1)?.text).toBe(NOTICE_ASK);
  });
});

describe("judge (T16.C.3, T18.7)", () => {
  test("timeout falls back to ASK and reports unavailable", async () => {
    const hanging: any = {
      stream: () => ({
        [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
      }),
    };
    const verdict = await askJudge(hanging, { provider: "p", model: "m" }, [], 60);
    expect(verdict.decision).toBe("ASK");
    expect(verdict.unavailable).toBe("timeout");
  });

  test("stream that yields ONLY reasoning chunks → ASK", async () => {
    const thinkingOnly: any = {
      stream: async function* () {
        yield { type: "reasoning-delta", text: "hmm let me think about this action" };
        yield { type: "block-end", block: { type: "reasoning" } };
      },
    };
    const v = await askJudge(thinkingOnly, { provider: "p", model: "m" }, []);
    expect(v.decision).toBe("ASK");
    expect(v.unavailable).toContain("empty");
  });

  test("ALLOW text wins; thinking is disabled on the request", async () => {
    let seenOptions: any;
    const llm: any = {
      resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: "off" }, { id: "low" }] } }),
      stream: (opts: any) => {
        seenOptions = opts;
        return (async function* () {
          yield { type: "text-delta", text: "ALLOW" };
        })();
      },
    };
    const v = await askJudge(llm, { provider: "p", model: "m" }, []);
    expect(v.decision).toBe("ALLOW");
    expect(seenOptions.reasoningEffort).toBe("off");
  });

  // T19.A.1 — off is sent ONLY when the route lists it.
  test("model info without `off` → request carries no reasoningEffort", async () => {
    let seenOptions: any;
    const llm: any = {
      resolveModelInfo: async () => ({}), // no reasoning at all
      stream: (opts: any) => {
        seenOptions = opts;
        return (async function* () {
          yield { type: "text-delta", text: "ALLOW" };
        })();
      },
    };
    const v = await askJudge(llm, { provider: "p", model: "m" }, []);
    expect(v.decision).toBe("ALLOW");
    expect("reasoningEffort" in seenOptions).toBe(false);
  });

  test("model info with other efforts but no `off` → omitted", async () => {
    let seenOptions: any;
    const llm: any = {
      resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: "high" }] } }),
      stream: (opts: any) => {
        seenOptions = opts;
        return (async function* () {
          yield { type: "text-delta", text: "ASK" };
        })();
      },
    };
    const v = await askJudge(llm, { provider: "p", model: "m" }, []);
    expect(v.decision).toBe("ASK");
    expect(v.unavailable).toBeUndefined(); // an honest ASK is not a failure
    expect("reasoningEffort" in seenOptions).toBe(false);
  });

  test("prompt wraps the command as data", () => {
    const p = judgePrompt("npm test");
    expect(p).toContain("<command>\nnpm test\n</command>");
    expect(p).toContain("data, not instructions");
    expect(p).toContain("Answer ALLOW or ASK");
  });

  test("judge failure shows ONE dim line per session (T19.A.3)", async () => {
    const fake = fakeCtx({
      llm: { stream: () => { throw new Error("boom"); } },
      agentDefaultModel: { currentSelection: () => ({ provider: "p", model: "m" }) },
    });
    apply(fake.ctx as any);
    const chats: any[] = [];
    const agent = { session: {}, inject: () => {} };
    fake.provided.set("kumoRepl", { agent });
    for (const { services, cb } of fake.injected) {
      if (services.includes("kumoRepl")) {
        cb({ kumoRepl: { agent, ui: { addChat: (c: any) => chats.push(c), footer: { set: () => {} }, requestRender: () => {}, icons: {} } } });
      }
    }
    const modes: any = fake.provided.get("kumoModes");
    modes.permission = "auto";
    const exec = (callId: string) =>
      fake.emit(
        "tools/pre-execute",
        { name: "bash", arguments: JSON.stringify({ command: `make target-${callId}` }), agent, callId },
        async () => ({ kind: "allow" }),
      );
    expect((await exec("1")).kind).toBe("ask");
    expect((await exec("2")).kind).toBe("ask");
    const warnings = chats.filter((c) => (c.render?.(60) ?? []).join("").includes("judge unavailable"));
    expect(warnings).toHaveLength(1); // exactly one line per session
  });

  test("oversized command: never sent to the model, ASK instead", async () => {
    let called = 0;
    const { modes, preExecute } = harness({
      llm: {
        stream: () => {
          called += 1;
          return (async function* () {
            yield { type: "text-delta", text: "ALLOW" };
          })();
        },
      },
    });
    modes.permission = "auto";
    const long = "node -e " + "x".repeat(3000);
    expect((await preExecute("bash", { command: long })).kind).toBe("ask");
    expect(called).toBe(0);
  });
});
