import { afterEach, expect, test, vi } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { FooterComponent } from "../src/ui/footer.js";
import { attachTui } from "../src/plugins/render.js";
import { ASCII_ICONS, UNICODE_ICONS } from "../src/render/chars.js";
import { resetColorDepth } from "../src/ui/palette.js";
import { fakeCtx, strip } from "./fakes.js";
const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; resetColorDepth(); });

for (const icons of [UNICODE_ICONS, ASCII_ICONS]) test.each([100, 60, 30])("subagent count sits below the model at %i columns", width => {
  process.env.BRUINE_COLOR = "basic"; delete process.env.NO_COLOR; resetColorDepth();
  const footer = new FooterComponent(icons, { cwd: "/tmp" });
  footer.set({ modelName: "qwen 3.8 flash", effort: "low", subagents: 1, tps: 14 });
  const rows = footer.render(width);
  const plain = rows.map(strip);
  expect(plain[1]).toContain("qwen 3.8 flash");
  expect(plain[2]).toMatch(/subagents 1$/);
  expect(visibleWidth(rows[2]!)).toBe(width);
  if (icons === UNICODE_ICONS) expect(rows[2]).toContain("\x1b[36msubagents 1");
  else expect(rows[2]).not.toContain("\x1b[");
  for (const row of rows) expect(visibleWidth(row)).toBeLessThanOrEqual(width);
  footer.set({ subagents: 0 }); expect(footer.render(width).map(strip).join("\n")).not.toContain("subagents");
});

test("agent lifecycle counts owned running children, ignores other sessions, and cleans up", () => {
  type Agent = { session: { id: string }; status: string };
  const root: Agent = { session: { id: "root" }, status: "running" };
  const child: Agent = { session: { id: "child" }, status: "idle" };
  const nested: Agent = { session: { id: "nested" }, status: "running" };
  const other: Agent = { session: { id: "other" }, status: "running" };
  let agents: Agent[] = [root, other];
  const parents = new Map<Agent, Agent>([[child, root], [nested, child]]);
  const fake = fakeCtx({ agents: {
    list: () => agents,
    isOwnedBy: (id: string, parent: Agent) => agents.some(agent => agent.session.id === id && parents.get(agent) === parent),
  } });
  const footer = new FooterComponent(UNICODE_ICONS, { cwd: "/tmp" });
  const repaint = vi.fn();
  const ui = { footer, icons: UNICODE_ICONS, requestRender: repaint, addChat() {} };
  const detach = attachTui(fake.ctx, root, ui as never, {});
  try {
    agents.push(child); fake.emit("agent/created", { agent: child });
    expect(footer.state.subagents ?? 0).toBe(0);
    child.status = "running"; fake.emit("agent/status", { agent: child, status: "running" });
    expect(footer.state.subagents).toBe(1);
    agents.push(nested); fake.emit("agent/created", { agent: nested });
    expect(footer.state.subagents).toBe(2);
    child.status = "idle"; fake.emit("agent/status", { agent: child, status: "idle" });
    expect(footer.state.subagents).toBe(1);
    agents = agents.filter(agent => agent !== nested); fake.emit("agent/disposed", { agent: nested });
    expect(footer.state.subagents).toBe(0);
    child.status = "running"; fake.emit("agent/status", { agent: child, status: "running" });
    expect(repaint).toHaveBeenCalled();
  } finally { detach(); }
  expect(footer.state.subagents).toBe(0);
  const finished = repaint.mock.calls.length;
  fake.emit("agent/status", { agent: child, status: "running" });
  expect(repaint.mock.calls).toHaveLength(finished);
});

test("existing children are counted on attachment and stop counting after a session switch", () => {
  const root = { session: { id: "root" }, status: "idle" };
  const child = { session: { id: "child" }, status: "running" };
  let current = root;
  const fake = fakeCtx({ agents: {
    list: () => [root, child],
    isOwnedBy: (id: string, parent: unknown) => id === "child" && parent === root,
  } });
  const footer = new FooterComponent(UNICODE_ICONS, { cwd: "/tmp" });
  const ui = { footer, icons: UNICODE_ICONS, requestRender() {}, addChat() {} };
  const detach = attachTui(fake.ctx, root, ui as never, {}, () => current);
  try {
    expect(footer.state.subagents).toBe(1);
    current = { session: { id: "new" }, status: "idle" };
    fake.emit("session/event", current.session, { type: "turn/start", data: {} });
    expect(footer.state.subagents).toBe(0);
  } finally { detach(); }
});
