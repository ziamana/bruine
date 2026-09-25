import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import ts from "typescript";

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(p));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

function skillFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...skillFiles(p));
    else out.push(p);
  }
  return out;
}

/** Em-dashes inside string or template literals (comments stripped by the scanner). */
function emDashInStrings(file: string, src: string): string[] {
  const source = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const hits: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      if (node.text.includes("—")) hits.push(node.text.slice(0, 80));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

describe("style (T24.1)", () => {
  test("no em-dash inside string literals in src/**/*.ts", () => {
    const root = join(__dirname, "..", "src");
    const offenders: string[] = [];
    for (const file of sourceFiles(root)) {
      const text = readFileSync(file, "utf8");
      const hits = emDashInStrings(file, text);
      if (hits.length > 0) offenders.push(`${file}: ${hits.join(" | ")}`);
    }
    expect(offenders).toEqual([]);
  });

  test("no em-dash anywhere in skills/**", () => {
    const root = join(__dirname, "..", "skills");
    const offenders: string[] = [];
    for (const file of skillFiles(root)) {
      const text = readFileSync(file, "utf8");
      if (text.includes("—")) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
