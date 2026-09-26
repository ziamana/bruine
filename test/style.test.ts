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

  // T41: the README is what a person reads before they install anything, so it
  // holds the same line as the user-facing strings.
  test("no em-dash in README.md", () => {
    const file = join(__dirname, "..", "README.md");
    const text = readFileSync(file, "utf8");
    expect(text).not.toContain("—");
  });

  /**
   * T41: `npm view kumo-code` printed `repository: TODO_GITHUB_URL` and the
   * package could not be published. Every publishable field is asserted here so
   * a placeholder cannot come back.
   */
  test("package.json has no placeholder left, and every publishable field is real", () => {
    const raw = readFileSync(join(__dirname, "..", "package.json"), "utf8");
    expect(raw).not.toMatch(/TODO_GITHUB_URL/);
    const pkg = JSON.parse(raw) as {
      name: string;
      description: string;
      repository: { type: string; url: string };
      homepage: string;
      bugs: { url: string };
      license: string;
      bin: Record<string, string>;
      keywords?: string[];
    };
    expect(pkg.name).toBe("kumo-code");
    expect(pkg.bin.kumo).toBe("dist/bin.js");
    expect(pkg.license).toBe("MIT");
    expect(pkg.repository.type).toBe("git");
    // npm only turns a repository into a working link with the git+https form.
    expect(pkg.repository.url).toMatch(/^git\+https:\/\/github\.com\/[\w.-]+\/[\w.-]+\.git$/);
    expect(pkg.homepage).toMatch(/^https:\/\/github\.com\//);
    expect(pkg.bugs.url).toMatch(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues$/);
    // A description that only names the harness tells a browsing user nothing.
    expect(pkg.description.length).toBeGreaterThan(20);
    expect(pkg.keywords ?? []).toContain("cli");
  });
});
