import { describe, expect, test } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { ASCII_ICONS, UNICODE_ICONS } from "../src/render/chars.js";
import { QuestionCallComponent } from "../src/ui/question-call-component.js";
import { ToolCallComponent } from "../src/ui/tool-call-component.js";

const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
const payload = JSON.stringify({
  questions: [{
    id: "q1",
    question: "Sur quel sujet souhaitez-vous que je vous pose des questions ?",
    options: [
      { label: "Un projet de code", description: "Vous travaillez sur un projet" },
      { label: "Une décision technique" },
      { label: "Autre" },
    ],
  }],
});
const text = (c: { render(w: number): string[] }, w = 100): string => c.render(w).map(strip).join("\n");

describe("QuestionCallComponent: the question is drawn while the model writes it", () => {
  test("nothing yet is a bare header, then the question grows with the stream", () => {
    const c = new QuestionCallComponent(() => 0, UNICODE_ICONS);
    expect(text(c)).toContain("ask_user");
    c.args(payload.slice(0, payload.indexOf("Sur quel") + 10));
    expect(text(c)).toContain("Sur quel s");
    expect(text(c)).not.toContain("Waiting for user input");
    expect(c.rail).toBe("active");
  });

  test("options show once they arrive, and the call says it is waiting once complete", () => {
    const c = new QuestionCallComponent(() => 0, UNICODE_ICONS);
    c.args(payload.slice(0, payload.indexOf('{"label":"Une')));
    expect(text(c)).toContain("1 option(s): Un projet de code");
    c.args(payload.slice(payload.indexOf('{"label":"Une')));
    const done = text(c);
    expect(done).toContain("3 option(s): Un projet de code, Une décision technique, Autre");
    expect(done).toContain("Waiting for user input…");
  });

  test("the answer settles the call into what was asked and chosen", () => {
    const c = new QuestionCallComponent(() => 0, UNICODE_ICONS);
    c.setArgs(payload);
    c.answer([{ id: "q1", selected: ["Un projet de code"] }]);
    const out = text(c);
    expect(c.rail).toBe("blue");
    expect(c.doneOk).toBe(true);
    expect(out).toContain("✓ Un projet de code");
    expect(out).toContain("Q: Sur quel sujet");
    expect(out).toContain("Options:");
    expect(out).toContain("● Un projet de code - Vous travaillez sur un projet");
    expect(out).toContain("○ Une décision technique");
    expect(out).not.toContain("Waiting for user input");
  });

  test("a free-text answer and a skipped question are both on the record", () => {
    const custom = new QuestionCallComponent(() => 0, UNICODE_ICONS);
    custom.setArgs(payload);
    custom.answer([{ id: "q1", selected: [], custom: "autre chose" }]);
    expect(text(custom)).toContain("✓ autre chose");
    const skipped = new QuestionCallComponent(() => 0, UNICODE_ICONS);
    skipped.setArgs(payload);
    skipped.answer([{ id: "q9", selected: [] }]);
    expect(text(skipped)).toContain("skipped");
  });

  test("a call that is cancelled is red and says so", () => {
    const c = new QuestionCallComponent(() => 0, UNICODE_ICONS);
    c.setArgs(payload);
    c.cancel();
    expect(c.rail).toBe("red");
    expect(text(c)).toContain("Cancelled");
  });

  test("ASCII terminals get ASCII marks", () => {
    const c = new QuestionCallComponent(() => 0, ASCII_ICONS);
    c.setArgs(payload);
    c.answer([{ id: "q1", selected: ["Autre"] }]);
    const out = c.render(100).map(strip).join("\n");
    expect(out).toContain("(*) Autre");
    expect(out).toContain("( ) Un projet de code");
    expect(out).not.toMatch(/[●○✓…]/u);
  });

  test.each([100, 60, 30])("no line is wider than %i columns, streaming or answered", (width) => {
    const c = new QuestionCallComponent(() => 0, UNICODE_ICONS);
    c.args(payload);
    for (const line of c.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    c.answer([{ id: "q1", selected: ["Un projet de code"] }]);
    for (const line of c.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
  });
});

describe("ToolCallComponent: any call is drawn while it is being written", () => {
  test("a command is read out of the partial arguments, word by word", () => {
    const c = new ToolCallComponent("bash", () => 0, UNICODE_ICONS);
    c.args('{"command":"ls -la /ho');
    expect(text(c)).toContain("ls -la /ho");
    c.args('me/tu44"}');
    expect(text(c)).toContain("ls -la /home/tu44");
    expect(c.rail).toBe("active");
  });

  test("a multi-line command keeps its later lines on screen while in flight", () => {
    const c = new ToolCallComponent("bash", () => 0, UNICODE_ICONS);
    c.args('{"command":"echo one\\necho two\\necho thr');
    const out = text(c);
    expect(out).toContain("echo one");
    expect(out).toContain("echo two");
    expect(out).toContain("echo thr");
  });

  test("it settles green on success and red on failure", () => {
    const ok = new ToolCallComponent("bash", () => 0, UNICODE_ICONS);
    ok.setArgs('{"command":"true"}');
    ok.result(true, "");
    expect(ok.rail).toBe("blue");
    const bad = new ToolCallComponent("bash", () => 0, UNICODE_ICONS);
    bad.setArgs('{"command":"false"}');
    bad.result(false, "exit 1");
    expect(bad.rail).toBe("red");
  });

  test.each([100, 60, 30])("a streaming call fits %i columns", (width) => {
    const c = new ToolCallComponent("bash", () => 0, UNICODE_ICONS);
    c.args('{"command":"echo a very long first line that keeps going and going\\nsecond line that is long too');
    for (const line of c.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
  });
});
