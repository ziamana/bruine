/**
 * The setup panel sits in the middle of the console.
 *
 * The defect: the frame took the whole width and started on the first row, so on a big
 * terminal it hugged the top-left corner and left the rest of the screen empty.
 */
import { describe, expect, test } from "vitest";
import type { Component } from "@earendil-works/pi-tui";
import { CenteredPanel } from "../src/setup/frame.js";

const block = (height: number): Component => ({
  render: (width: number) => Array.from({ length: height }, () => "#".repeat(width)),
  invalidate: () => {},
});

describe("CenteredPanel", () => {
  test("a wide terminal gains equal margins, and the panel keeps its cap", () => {
    const panel = new CenteredPanel(block(4), () => 20, { maxWidth: 60, fullscreen: () => false });
    const lines = panel.render(100);
    const body = lines.filter((l) => l !== "");
    expect(body[0]).toBe(`${" ".repeat(20)}${"#".repeat(60)}`);
    expect(body.every((l) => l.length === 80)).toBe(true);
  });

  test("it sits in the vertical middle", () => {
    const panel = new CenteredPanel(block(6), () => 20, { maxWidth: 60, fullscreen: () => false });
    const lines = panel.render(100);
    expect(lines.slice(0, 7).every((l) => l === "")).toBe(true);
    expect(lines).toHaveLength(7 + 6);
  });

  test("a narrow terminal is not given margins it has no room for", () => {
    const panel = new CenteredPanel(block(3), () => 3, { maxWidth: 60, fullscreen: () => false });
    const lines = panel.render(40);
    expect(lines).toEqual(Array(3).fill("#".repeat(40)));
  });

  test("a panel taller than the console starts on the first row", () => {
    const panel = new CenteredPanel(block(30), () => 20, { maxWidth: 60, fullscreen: () => false });
    expect(panel.render(100)[0]).not.toBe("");
  });

  test("it does not jump while a list shrinks inside one step, and a new step starts again", () => {
    let height = 12;
    const inner: Component = { render: (w) => Array.from({ length: height }, () => "#".repeat(w)), invalidate: () => {} };
    const panel = new CenteredPanel(inner, () => 30, { maxWidth: 60, fullscreen: () => false });
    const first = panel.render(100);
    const topFirst = first.findIndex((l) => l !== "");
    height = 4;
    const shrunk = panel.render(100);
    expect(shrunk.findIndex((l) => l !== "")).toBe(topFirst);
    panel.reset();
    expect(panel.render(100).findIndex((l) => l !== "")).toBe(Math.floor((30 - 4) / 2));
  });

  test("the welcome mark owns the whole terminal and is not framed", () => {
    const panel = new CenteredPanel(block(5), () => 40, { maxWidth: 60, fullscreen: () => true });
    expect(panel.render(100)).toEqual(Array(5).fill("#".repeat(100)));
  });
});
