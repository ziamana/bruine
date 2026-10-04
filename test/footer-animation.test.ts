import { afterEach, expect, test, vi } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { FooterComponent } from "../src/ui/footer.js";
import { ASCII_ICONS, UNICODE_ICONS } from "../src/render/chars.js";
import { strip } from "./fakes.js";

const saved = { ...process.env };
const tty = process.stdout.isTTY;
afterEach(() => { process.env = { ...saved }; process.stdout.isTTY = tty; vi.useRealTimers(); });
function animatedFooter() {
  vi.useFakeTimers(); vi.setSystemTime(0); process.stdout.isTTY = true;
  delete process.env.CI; delete process.env.BRUINE_ASCII; delete process.env.BRUINE_NO_ANIMATION;
  process.env.TERM = "xterm-256color";
  return new FooterComponent(UNICODE_ICONS, { cwd: "/tmp", home: "/tmp" });
}
const text = (footer: FooterComponent) => strip(footer.render(100).join("\n"));

test("tokens settle after the answer while real totals and other readings stay current", () => {
  const footer = animatedFooter();
  footer.set({ inputTokens: 100, outputTokens: 10, model: "model", cacheRead: 900 });
  footer.beginTurn(); footer.beginTurn();
  footer.set({ inputTokens: 1600, outputTokens: 536, cacheRead: 1200 });
  expect(text(footer)).toContain("↑100 ↓10");
  expect(text(footer)).toContain("1.2k served");
  expect(footer.state).toMatchObject({ inputTokens: 1600, outputTokens: 536 });
  expect(footer.active).toBe(false);
  footer.endTurn(); expect(footer.active).toBe(true);
  expect(text(footer)).toContain("↑100 ↓10");
  vi.advanceTimersByTime(325);
  expect(text(footer)).toContain("↑1.4k ↓470");
  expect(text(footer)).toContain("model");
  for (const width of [100, 60, 30]) for (const row of footer.render(width)) expect(visibleWidth(row)).toBeLessThanOrEqual(width);
  vi.advanceTimersByTime(325);
  expect(footer.active).toBe(false);
  expect(text(footer)).toContain("↑1.6k ↓536");
});

test("first reported totals animate from zero and missing usage stays unknown", () => {
  const footer = animatedFooter();
  footer.beginTurn(); footer.set({ inputTokens: 1600 });
  expect(text(footer)).not.toContain("↑"); footer.endTurn();
  expect(text(footer)).toContain("↑0"); expect(text(footer)).not.toContain("↓");
  vi.advanceTimersByTime(650);
  expect(text(footer)).toContain("↑1.6k"); expect(text(footer)).not.toContain("↓");
});

test("a new turn can interrupt settling without a counter jump", () => {
  const footer = animatedFooter(); footer.set({ inputTokens: 100 });
  footer.beginTurn(); footer.set({ inputTokens: 1600 }); footer.endTurn();
  vi.advanceTimersByTime(325); const before = text(footer);
  footer.beginTurn(); expect(text(footer)).toBe(before); expect(footer.active).toBe(false);
  footer.set({ inputTokens: 2000 }); footer.endTurn();
  vi.advanceTimersByTime(650); expect(text(footer)).toContain("↑2k");
});

test("session reset discards the previous animation and totals", () => {
  const footer = animatedFooter(); footer.set({ inputTokens: 100, outputTokens: 20 });
  footer.beginTurn(); footer.set({ inputTokens: 1600, outputTokens: 536 }); footer.endTurn();
  footer.set({ inputTokens: undefined, outputTokens: undefined });
  expect(footer.active).toBe(false); expect(text(footer)).not.toMatch(/[↑↓]/);
});

test.each(["reduced", "non-tty", "ascii"] as const)("%s settles immediately at the end", mode => {
  const footer = animatedFooter();
  if (mode === "reduced") process.env.BRUINE_NO_ANIMATION = "1";
  if (mode === "non-tty") process.stdout.isTTY = false;
  const target = mode === "ascii" ? new FooterComponent(ASCII_ICONS, { cwd: "/tmp" }) : footer;
  target.set({ inputTokens: 100 }); target.beginTurn(); target.set({ inputTokens: 1600 }); target.endTurn();
  expect(target.active).toBe(false); expect(text(target)).toContain(mode === "ascii" ? "^1.6k" : "↑1.6k");
});
