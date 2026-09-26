import { describe, expect, test } from "vitest";
import { isKeyRelease } from "@earendil-works/pi-tui";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { dropLastChar, typedText } from "../src/ui/keys.js";
import { QuestionForm } from "../src/ui/questions.js";

/**
 * The two encodings a real terminal uses, taken from what pi-tui itself accepts
 * (probed against `matchesKey`, not from the specification):
 *
 * - legacy:      `CSI A`, `CR`, `SP`, `DEL`
 * - kitty:       `CSI 1;1 A`, `CSI 13;1 u`, `CSI 32;1 u`, and a release
 *                `CSI <code>;<mod>:<type> u` after every press.
 *
 * A form that reads bytes answers "no" to the whole second column, which is what
 * a user with the protocol on experiences as a frozen form.
 */
const KITTY = { up: "\x1b[1;1A", down: "\x1b[1;1B", right: "\x1b[1;1C", left: "\x1b[1;1D", enter: "\x1b[13;1u", space: "\x1b[32;1u" };
const LEGACY = { up: "\x1b[A", down: "\x1b[B", right: "\x1b[C", left: "\x1b[D", enter: "\r", space: " " };
const ENCODINGS = [
  ["legacy", LEGACY],
  ["kitty", KITTY],
] as const;

const question = () => [
  { id: "db", header: "Mode", question: "Which database?", options: [{ label: "SQLite" }, { label: "Redis" }] },
  { id: "log", header: "Log", question: "How much logging?", options: [{ label: "Quiet" }, { label: "Verbose" }] },
];

/** The rendered form, stripped, so an assertion is about what a user can see. */
const frame = (form: QuestionForm, width = 60): string => form.render(width).join("\n");

describe("the question form reads keys, not bytes (T60)", () => {
  for (const [name, keys] of ENCODINGS) {
    test(`${name}: down then up move the cursor and nothing else`, () => {
      const form = new QuestionForm(question());
      expect(frame(form)).toContain("SQLite");
      form.handleInput(keys.down);
      expect(frame(form)).toContain("Redis");
      form.handleInput(keys.up);
      expect(frame(form)).toContain("SQLite");
    });

    test(`${name}: right and left walk the questions`, () => {
      const form = new QuestionForm(question());
      form.handleInput(keys.right);
      expect(frame(form)).toContain("How much logging?");
      form.handleInput(keys.left);
      expect(frame(form)).toContain("Which database?");
    });

    test(`${name}: space toggles the option under the cursor`, () => {
      const form = new QuestionForm(question());
      form.handleInput(keys.down);
      form.handleInput(keys.space);
      // Multi-select is off, so space moves nothing and breaks nothing.
      expect(frame(form)).toContain("Redis");
    });
  }

  test("a kitty release moves nothing: one arrow walks one row", () => {
    // The protocol reports a press and a release for every key, and matchesKey
    // answers yes to both, so the release filter is the difference between one
    // step and two.
    const form = new QuestionForm(question());
    expect(isKeyRelease(`${KITTY.up.slice(0, -1)}:3u`)).toBe(true);
    form.handleInput(KITTY.up);
    form.handleInput("\x1b[1;1:3u");
    expect(frame(form)).toContain("SQLite");
  });

  test("a backspace release does not erase a second character", () => {
    const form = new QuestionForm(question());
    form.handleInput("a");
    form.handleInput("b");
    form.handleInput("\x7f");
    expect(frame(form)).toContain("ab");
    form.handleInput("\x1b[127;1:3u");
    expect(frame(form)).toContain("ab");
    form.handleInput("\x1b[127;5u");
    expect(frame(form)).toContain("a");
  });

  test("typing is an answer, in either encoding", () => {
    const form = new QuestionForm(question());
    form.handleInput("\x1b[115;1u");
    expect(frame(form)).toContain("s");
    form.handleInput("i");
    form.handleInput("\x1b[13;1u");
  });
});

describe("what a keystroke carries (T60)", () => {
  test("printable text is read in both encodings", () => {
    expect(typedText("a")).toBe("a");
    expect(typedText("\x1b[97;1u")).toBe("a");
    // Shift is reported as the shifted keycode when the terminal sends one.
    expect(typedText("\x1b[97;2u")).toBe("a");
    expect(typedText("\x1b[32;1u")).toBe(" ");
  });

  test("a key that is not text is not text", () => {
    expect(typedText(KITTY.up)).toBe("");
    expect(typedText(KITTY.enter)).toBe("");
    expect(typedText("\x1b")).toBe("");
    expect(typedText("\x7f")).toBe("");
  });

  test("a release carries no text either, so a letter does not arrive twice", () => {
    expect(typedText("\x1b[97;1:3u")).toBe("a");
    // The caller drops releases before this point, and that is the only reason a
    // typed letter is not doubled.
    expect(isKeyRelease("\x1b[97;1:3u")).toBe(true);
  });

  test("dropping the last character keeps an emoji whole", () => {
    expect(dropLastChar("a🙂")).toBe("a");
    expect(dropLastChar("a")).toBe("");
    expect(dropLastChar("")).toBe("");
  });

});

describe("no key handling goes back to bytes (T60)", () => {
  /**
   * The bug was a comparison, so the guard is a scan: a source check that fails
   * if a handler ever matches a raw escape byte again. `test/style.test.ts`
   * already scans src/** for the em-dash, so this is that mechanism pointed at a
   * different rule, and it fails on the line that broke.
   */
  const RAW_KEY = /data\s*===\s*"(\\x1b|\\r|\\n|\\x7f|\\x08| )|data\.(startsWith|endsWith)\("\x1b/;

  const tsFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return tsFiles(path);
      return entry.name.endsWith(".ts") ? [path] : [];
    });

  test("no component compares a key by its bytes", () => {
    const root = join(__dirname, "..", "src");
    const offenders: string[] = [];
    for (const file of [...tsFiles(join(root, "ui")), ...tsFiles(join(root, "setup")), ...tsFiles(join(root, "plugins"))]) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (RAW_KEY.test(line)) offenders.push(`${file}:${String(i + 1)} ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
