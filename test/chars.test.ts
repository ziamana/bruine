import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, test } from "vitest";
import { ASCII_ICONS, UNICODE_ICONS, iconsFor } from "../src/render/chars.js";

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(p));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("iconsFor (T14.5)", () => {
  test("KUMO_ASCII=1 forces ASCII", () => {
    expect(iconsFor({ KUMO_ASCII: "1", LANG: "fr_FR.UTF-8" }, "linux")).toBe(ASCII_ICONS);
  });

  test("UTF-8 locale → unicode glyphs", () => {
    expect(iconsFor({ LANG: "en_US.UTF-8" }, "linux")).toBe(UNICODE_ICONS);
    expect(iconsFor({ LC_ALL: "C.utf8" }, "darwin")).toBe(UNICODE_ICONS);
  });

  test("POSIX without UTF-8 locale → ASCII", () => {
    expect(iconsFor({}, "linux")).toBe(ASCII_ICONS);
  });

  test("Windows Terminal → unicode, legacy console → ASCII", () => {
    expect(iconsFor({ WT_SESSION: "abc" }, "win32")).toBe(UNICODE_ICONS);
    expect(iconsFor({}, "win32")).toBe(ASCII_ICONS);
  });
});

describe("cross-platform source audit (T14.4)", () => {
  test("no POSIX home paths or ~ strings in src/", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(__dirname, "..", "src"))) {
      // T18.3 deliberately matches "~/" targets in the gate; everything else
      // must stay free of hardcoded POSIX home paths and ~ strings.
      if (file.endsWith(join("gate", "rules.ts"))) continue;
      const text = readFileSync(file, "utf8");
      if (/\/home\/|~\//.test(text)) offenders.push(file.split(sep).slice(-2).join("/"));
    }
    expect(offenders).toEqual([]);
  });
});
