import { afterEach, expect, test } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { ChatTranscript } from "../src/ui/chat-layout.js";
import { ToolCallComponent } from "../src/ui/tool-call-component.js";
import { CollapsedToolsComponent } from "../src/ui/tool-group.js";
import { userMessageComponent } from "../src/ui/assistant-text.js";
import { ReasoningComponent } from "../src/ui/reasoning-component.js";
import { bgCode, contrastRatio, NUAGE, resetColorDepth } from "../src/ui/palette.js";
import { ASCII_ICONS, UNICODE_ICONS } from "../src/render/chars.js";
import { strip } from "./fakes.js";
const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; resetColorDepth(); });
test.each([100, 60, 30])("a complete turn fits %i columns at every color depth", width => {
  for (const depth of ["truecolor", "256", "basic", "none"] as const) {
    process.env.KUMO_COLOR = depth; resetColorDepth();
    const t = new ChatTranscript(UNICODE_ICONS);
    t.addChild(userMessageComponent("Read the project and check its tests"));
    const r = new ReasoningComponent(() => 0); r.push("Inspect the project first "); t.addChild(r);
    const ok = new ToolCallComponent("bash", () => 0); ok.setArgs('{"command":"pnpm test"}'); ok.result(true, "All tests passed"); t.addChild(ok);
    const bad = new ToolCallComponent("read", () => 0); bad.result(false, "Permission denied"); t.addChild(bad);
    t.addChild(new ToolCallComponent("ask_user", () => 0));
    t.addChild(new CollapsedToolsComponent("read", 3, 1));
    const rows = t.render(width); const text = rows.join("\n");
    for (const row of rows) expect(visibleWidth(row)).toBeLessThanOrEqual(width);
    expect(text).toContain("Took 0.0s");
    if (depth === "truecolor" || depth === "256") for (const role of ["userBlock", "toolOk", "toolErr", "toolPending"] as const) expect(text).toContain(bgCode(role, depth));
    else { expect(text).not.toContain("\x1b[48;"); expect(text).toContain("▍"); }
    if (depth === "none") expect(text).not.toContain("\x1b[");
  }
});
test("transparent ASCII blocks have a rail and no background", () => {
  process.env.KUMO_COLOR = "truecolor"; process.env.KUMO_BG = "0"; resetColorDepth();
  const t = new ChatTranscript(ASCII_ICONS); t.addChild(new ToolCallComponent("read", () => 0, ASCII_ICONS));
  const text = t.render(30).join("\n"); expect(text).toContain("|"); expect(text).not.toContain("\x1b[48;");
});
test("block text and secondary text meet AA", () => {
  for (const role of ["userBlock", "toolOk", "toolErr", "toolPending"] as const) {
    expect(contrastRatio(NUAGE.text.hex, NUAGE[role].hex)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(NUAGE.muted.hex, NUAGE[role].hex)).toBeGreaterThanOrEqual(4.5);
  }
});

test("a diff block is neutral, and the two bands are the only colour in it", () => {
  process.env.KUMO_COLOR = "truecolor"; resetColorDepth();
  const edit = new ToolCallComponent("edit", () => 0);
  edit.setArgs(JSON.stringify({ path: "/nope/x.ts", old_string: "a\nb\n", new_string: "a\nc\nd\n" }));
  edit.result(true, "");
  const bash = new ToolCallComponent("bash", () => 0);
  bash.result(true, "done");
  const t = new ChatTranscript(UNICODE_ICONS);
  t.addChild(bash);
  t.addChild(edit);
  const rows = t.render(60);
  const text = rows.join("\n");
  // A finished call is green; a call that shows a diff is not, or the added band
  // would have nothing of its own and only the deletion would read.
  expect(text).toContain(bgCode("toolOk", "truecolor"));
  expect(text).toContain(bgCode("toolPending", "truecolor"));
  expect(text).toContain(bgCode("addBg", "truecolor"));
  expect(text).toContain(bgCode("delBg", "truecolor"));
  for (const row of rows) expect(visibleWidth(row)).toBeLessThanOrEqual(60);
});

test("a diff block at 30 columns and in ASCII: no band, and the sign still reads", () => {
  process.env.KUMO_COLOR = "truecolor"; process.env.KUMO_BG = "0"; resetColorDepth();
  const edit = new ToolCallComponent("edit", () => 0);
  edit.setArgs(JSON.stringify({ path: "/nope/x.ts", old_string: "a\nb\n", new_string: "a\nc\nd\n" }));
  edit.result(true, "");
  const t = new ChatTranscript(ASCII_ICONS);
  t.addChild(edit);
  const text = t.render(30).join("\n");
  expect(text).not.toContain("\x1b[48;");
  // The rail and the indents move the sign around; what matters is that a gutter
  // cell always separates it from the text.
  expect(strip(text)).toMatch(/-\sb/);
  expect(strip(text)).toMatch(/\+\sc/);
  for (const row of t.render(30)) expect(visibleWidth(row)).toBeLessThanOrEqual(30);
});
