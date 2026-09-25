import { describe, expect, test } from "vitest";
import { apply, buildQuestion, parseAnswer } from "../src/plugins/approval.js";
import { createUi } from "../src/plugins/render.js";
import { fakeCtx, FakeScreen, strip } from "./fakes.js";

describe("buildQuestion", () => {
  const base = { agent: {}, toolName: "bash" };

  test("uses the streamed tool-call summary when available", () => {
    const q = buildQuestion({ ...base, callId: "t1" }, (id) =>
      id === "t1" ? { tool: "bash", summary: "rm -rf dist" } : undefined,
    );
    expect(q).toBe("? Allow bash: rm -rf dist ? [y/N] ");
  });

  test("falls back to the request reason", () => {
    const q = buildQuestion({ ...base, reason: "writes outside the workspace" });
    expect(q).toBe("? Allow bash: writes outside the workspace ? [y/N] ");
  });

  test("tool name only when there is no detail", () => {
    expect(buildQuestion(base)).toBe("? Allow bash ? [y/N] ");
  });
});

describe("parseAnswer", () => {
  test("y and yes allow", () => {
    for (const a of ["y", "Y", "yes", "YES", "Yes", " y "]) expect(parseAnswer(a)).toBe(true);
  });
  test("everything else rejects", () => {
    for (const a of ["", "n", "N", "no", "yeah", "sure", "1"]) expect(parseAnswer(a)).toBe(false);
  });
});

describe("approval plugin apply", () => {
  function setup(answer: string) {
    const screen = new FakeScreen();
    const ui = createUi(screen);
    const agent = { session: {} };
    const questions: string[] = [];
    const repl = {
      agent,
      ask: async (q: string) => {
        questions.push(q);
        return answer;
      },
    };
    const fake = fakeCtx();
    apply(fake.ctx as any);
    for (const { cb } of fake.injected) cb({ kumoRepl: repl, kumoRender: ui });
    const request = (req: Record<string, unknown>, next = async () => "unavailable" as const) =>
      fake.emit("approval/request", { agent, toolName: "bash", ...req }, next) as Promise<string>;
    return { screen, ui, agent, questions, request, nextSpy: async () => "unavailable" as const };
  }

  test("y allows once and shows the verdict", async () => {
    const { screen, ui, questions, request } = setup("y");
    ui.tools.start("t1", "bash");
    ui.tools.args("t1", '{"command":"rm -rf dist"}');
    const outcome = await request({ callId: "t1" });
    expect(outcome).toBe("allowed-once");
    expect(questions).toEqual(["? Allow bash: rm -rf dist ? [y/N] "]);
    expect(strip(screen.last)).toBe("✓ allowed\n");
  });

  test("empty answer rejects", async () => {
    const { request } = setup("");
    expect(await request({ callId: "t1" })).toBe("rejected");
  });

  test("n rejects and shows the verdict", async () => {
    const { screen, request } = setup("n");
    expect(await request({})).toBe("rejected");
    expect(strip(screen.last)).toBe("✗ rejected\n");
  });

  test("requests from another agent are delegated to next()", async () => {
    const { request } = setup("y");
    let delegated = false;
    const outcome = await request({ agent: { other: true } }, async () => {
      delegated = true;
      return "unavailable";
    });
    expect(delegated).toBe(true);
    expect(outcome).toBe("unavailable");
  });

  test("aborted request short-circuits to cancelled", async () => {
    const { request } = setup("y");
    const outcome = await request({ signal: { aborted: true } });
    expect(outcome).toBe("cancelled");
  });
});
