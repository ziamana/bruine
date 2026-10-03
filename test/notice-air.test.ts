/**
 * The air between the blocks at the bottom of the screen.
 *
 * The defect: the notice box (the approval list, a notice, the question form)
 * was the one bottom block with no gap above it, so a question the model asked
 * sat glued under the tool call that asked it, and the two read as one block.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import type { Terminal } from "@earendil-works/pi-tui";
import { KumoUi } from "../src/ui/kumo-ui.js";
import { UNICODE_ICONS } from "../src/render/chars.js";

class FakeTerminal implements Terminal {
  writes: string[] = [];
  columns = 80;
  rows = 24;
  kittyProtocolActive = false;
  onInput?: (data: string) => void;
  start(onInput: (data: string) => void): void { this.onInput = onInput; }
  stop(): void {}
  async drainInput(): Promise<void> {}
  write(data: string): void { this.writes.push(data); }
  moveBy(): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(): void {}
  setProgress(): void {}
}

const plain = (s: string): string => s.replace(/\r/g, "").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

async function ui(): Promise<KumoUi> {
  vi.stubEnv("KUMO_HOME", await mkdtemp(join(tmpdir(), "kumo-air-")));
  vi.stubEnv("KUMO_NO_UPDATE_CHECK", "1");
  const shell = new KumoUi(
    "0.1.0",
    { onSubmit: () => {}, onEscape: () => {}, onQuit: () => {} },
    new FakeTerminal(),
    UNICODE_ICONS,
  );
  await new Promise((r) => setTimeout(r, 20));
  return shell;
}

describe("a block that is showing brings its own air (T56 rhythm)", () => {
  test("the question form is one blank row under the transcript, not glued to it", async () => {
    const shell = await ui();
    void shell.askQuestions([
      { id: "suite", header: "Quel faire du texte", question: "Tu m'as renvoyé l'histoire coupée, que veux-tu que j'en fasse ?", options: [{ label: "Une vraie suite" }] },
    ]);
    const rows = shell.tui.render(80).map((row) => plain(row).trimEnd());
    const top = rows.findIndex((row) => row.includes("Quel faire du texte"));
    expect(top).toBeGreaterThan(0);
    // The row above the form's top edge is empty: one blank, the rhythm the rest
    // of the screen already speaks.
    expect(rows[top - 1]).toBe("");
    expect(rows[top]).toContain("1/1");
  });

  test("the approval list brings the same air, since it shares the box", async () => {
    const shell = await ui();
    void shell.askChoice("Allow bash: rm -rf dist?", [{ value: "no", label: "No" }]);
    const rows = shell.tui.render(80).map((row) => plain(row).trimEnd());
    const top = rows.findIndex((row) => row.includes("Allow bash"));
    expect(top).toBeGreaterThan(0);
    expect(rows[top - 1]).toBe("");
  });
});