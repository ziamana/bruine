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

describe("CenteredPanel rain in the margins", () => {
  const plainText = (s: string): string => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
  const rainy = (allowed: boolean, rows = 30) =>
    new CenteredPanel(block(6), () => rows, { maxWidth: 60, fullscreen: () => false, rain: { allowed: () => allowed, time: () => 4000 } });
  const DROPS = /[·╷│╎]/;

  test("a wide terminal rains either side of the panel and the panel's own columns are untouched", () => {
    const lines = rainy(true).render(120).map(plainText);
    const panelRows = lines.filter((l) => l.includes("#"));
    expect(panelRows).toHaveLength(6);
    for (const row of panelRows) {
      expect(row.slice(30, 90)).toBe("#".repeat(60));
      expect(row.length).toBe(120);
    }
    // A drop is somewhere in the margins at some moment of the next few seconds.
    let seen = "";
    for (const time of [500, 1500, 2500, 3500, 4500, 6000]) {
      const panel = new CenteredPanel(block(6), () => 30, { maxWidth: 60, fullscreen: () => false, rain: { allowed: () => true, time: () => time } });
      seen += panel.render(120).map(plainText).filter((l) => l.includes("#")).map((r) => r.slice(0, 30) + r.slice(90)).join("");
    }
    expect(seen).toMatch(DROPS);
  });

  test("it also rains in the rows above and below a panel shorter than the console", () => {
    const lines = rainy(true).render(120).map(plainText);
    const above = lines.slice(0, lines.findIndex((l) => l.includes("#")));
    const below = lines.slice(lines.length - 8);
    expect(above.join("")).toMatch(DROPS);
    expect(below.join("")).toMatch(DROPS);
  });

  test("it never rains over the panel's own text", () => {
    for (const time of [0, 700, 1800, 3300, 9000]) {
      const panel = new CenteredPanel(block(6), () => 30, { maxWidth: 60, fullscreen: () => false, rain: { allowed: () => true, time: () => time } });
      const rows = panel.render(120).map(plainText).filter((l) => l.includes("#"));
      expect(rows.every((r) => r.slice(30, 90) === "#".repeat(60))).toBe(true);
    }
  });

  test("it moves with time", () => {
    const at = (time: number): string => new CenteredPanel(block(6), () => 30, { maxWidth: 60, fullscreen: () => false, rain: { allowed: () => true, time: () => time } }).render(120).join("\n");
    expect(at(1000)).not.toBe(at(1700));
  });

  test("with motion off the margins are plain space, as before", () => {
    const lines = rainy(false).render(120).map(plainText);
    expect(lines.join("")).not.toMatch(DROPS);
    expect(lines.filter((l) => l !== "").every((l) => /^ {30}#{60}$/.test(l))).toBe(true);
  });

  test("a terminal with no room around the panel has no margins to rain in", () => {
    const panel = new CenteredPanel(block(20), () => 20, { maxWidth: 100, fullscreen: () => false, rain: { allowed: () => true, time: () => 3000 } });
    const lines = panel.render(80).map(plainText);
    expect(panel.hasMargins).toBe(false);
    expect(lines).toEqual(Array(20).fill("#".repeat(80)));
  });

  test("hasMargins says when there is room to rain in", () => {
    const panel = rainy(true);
    panel.render(120);
    expect(panel.hasMargins).toBe(true);
  });
});

describe("rain behind the panel", () => {
  const plainText = (s: string): string => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
  const textual: Component = {
    render: (width: number) => [
      "┌" + "─".repeat(width - 2) + "┐",
      "│ Review your setup" + " ".repeat(width - 20) + "│",
      "│" + " ".repeat(width - 2) + "│",
      "│ Set up later" + " ".repeat(width - 15) + "│",
      "│" + " ".repeat(width - 2) + "│",
      "└" + "─".repeat(width - 2) + "┘",
    ],
    invalidate: () => {},
  };
  const panel = (time: number, interior = 0.5): CenteredPanel =>
    new CenteredPanel(textual, () => 20, { maxWidth: 60, fullscreen: () => false, rain: { allowed: () => true, time: () => time, density: () => 0.3, interior: () => interior } });

  test("drops fall in the blank rows inside the frame", () => {
    let seen = "";
    for (const t of [500, 1500, 2500, 3500, 4500, 6000]) {
      seen += panel(t).render(100).map(plainText).filter((l) => l.includes("│") && !/Review|Set up/.test(l)).join("");
    }
    expect(seen).toMatch(/[·╷│╎]/);
    expect(seen.replace(/[│ ]/g, "")).not.toBe("");
  });

  test("every word of the panel is always there, and the frame keeps its width", () => {
    for (const t of [0, 400, 1300, 2700, 5000, 9000]) {
      const lines = panel(t).render(100).map(plainText);
      expect(lines.some((l) => l.includes("Review your setup"))).toBe(true);
      expect(lines.some((l) => l.includes("Set up later"))).toBe(true);
      for (const l of lines.filter((x) => /Review|Set up/.test(x))) expect(l.slice(20, 80)).toMatch(/^│.*│$/);
    }
  });

  test("with no interior setting the inside of the panel is untouched, as before", () => {
    const p = new CenteredPanel(textual, () => 20, { maxWidth: 60, fullscreen: () => false, rain: { allowed: () => true, time: () => 3000 } });
    const inner = p.render(100).map(plainText).filter((l) => l.includes("│"));
    expect(inner.every((l) => !/[·╷╎]/.test(l.slice(21, 79)))).toBe(true);
  });

  test("a terminal exactly as wide as the panel still gets rain behind it when the weather asks", () => {
    const p = new CenteredPanel(textual, () => 6, { maxWidth: 100, fullscreen: () => false, rain: { allowed: () => true, time: () => 2000, density: () => 0, interior: () => 0.8 } });
    let seen = "";
    for (const t of [200, 1200, 2200, 3200]) {
      const q = new CenteredPanel(textual, () => 6, { maxWidth: 100, fullscreen: () => false, rain: { allowed: () => true, time: () => t, density: () => 0, interior: () => 0.8 } });
      seen += q.render(60).map(plainText).join("");
    }
    expect(seen).toMatch(/[·╷│╎]/);
    expect(p.render(60)).toHaveLength(6);
  });
});
