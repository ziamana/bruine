/**
 * Syntax highlighting for code fences in answers (pi-tui MarkdownTheme.highlightCode),
 * with highlight.js (BSD-3) core and the languages people actually paste. Its HTML
 * output is turned into Nuage palette colors; unknown languages fall back to plain.
 */
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { colorDepth, paint, type PaletteRole } from "./palette.js";

const LANGS: Record<string, unknown> = {
  bash, c, cpp, css, diff, go, java, javascript, json, markdown, python, rust, sql, typescript, xml, yaml,
};
for (const [name, lang] of Object.entries(LANGS)) hljs.registerLanguage(name, lang as never);
const ALIASES: Record<string, string> = {
  sh: "bash", shell: "bash", zsh: "bash", fish: "bash", console: "bash",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", tsx: "typescript", mts: "typescript",
  py: "python", rs: "rust", yml: "yaml", html: "xml", htm: "xml", svg: "xml", md: "markdown",
  "c++": "cpp", h: "c", hpp: "cpp",
};

/** hljs scope → palette role (the first matching prefix wins). */
const SCOPES: Array<[string, PaletteRole]> = [
  ["comment", "faint"], ["quote", "faint"],
  ["keyword", "pink"], ["built_in", "pink"], ["literal", "pink"], ["selector-tag", "pink"],
  ["string", "mint"], ["regexp", "mint"], ["addition", "mint"],
  ["deletion", "rose"],
  ["number", "amber"], ["type", "amber"], ["title.class", "amber"],
  ["title", "sky"], ["function", "sky"], ["section", "sky"],
  ["meta", "lavender"], ["symbol", "lavender"], ["attr", "lavender"], ["attribute", "lavender"],
  ["variable", "text"], ["params", "text"], ["property", "text"],
];

function roleFor(classes: string[]): PaletteRole | undefined {
  for (let i = classes.length - 1; i >= 0; i--) {
    const scope = classes[i]!.replace(/^hljs-/, "").replace(/_+$/, "");
    for (const [prefix, role] of SCOPES) if (scope === prefix || scope.startsWith(`${prefix}.`) || scope.startsWith(prefix)) return role;
  }
  return undefined;
}

function unescapeHtml(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

/** Resolve a fence language to a registered one, or undefined. */
export function resolveLanguage(lang?: string): string | undefined {
  if (lang === undefined) return undefined;
  const l = lang.trim().toLowerCase().split(/\s+/)[0] ?? "";
  if (l === "") return undefined;
  const name = ALIASES[l] ?? l;
  return hljs.getLanguage(name) !== undefined ? name : undefined;
}

/** Highlight code into colored lines (one entry per source line). Plain on no-color terminals. */
export function highlightCode(code: string, lang?: string): string[] {
  const language = resolveLanguage(lang);
  const plainLines = code.split("\n");
  if (language === undefined || colorDepth() === "none") return plainLines;
  let html: string;
  try {
    html = hljs.highlight(code, { language, ignoreIllegals: true }).value;
  } catch {
    return plainLines;
  }
  const out: string[] = [];
  let line = "";
  const stack: string[][] = [];
  const emit = (text: string): void => {
    const parts = unescapeHtml(text).split("\n");
    parts.forEach((part, i) => {
      if (i > 0) {
        out.push(line);
        line = "";
      }
      if (part === "") return;
      const role = roleFor(stack.flat());
      line += role === undefined ? part : paint(role, part);
    });
  };
  const re = /<span class="([^"]*)">|<\/span>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[1] !== undefined) stack.push(m[1].split(/\s+/));
    else if (m[0] === "</span>") stack.pop();
    else if (m[2] !== undefined) emit(m[2]);
  }
  out.push(line);
  return out;
}
