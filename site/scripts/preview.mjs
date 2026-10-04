// Finishes the preview build (PREVIEW=1 next build): every page gets a <base> pointing at the
// site's root, so its relative URLs resolve from wherever the files are hosted, and page.html
// (the French home, at the root) is the page a preview link opens.
import { cpSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const from = new URL("../out/", import.meta.url).pathname;
const to = new URL("../out-preview/", import.meta.url).pathname;
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });

// Some hosts reserve names that start with "_": Next's folder becomes next/.
renameSync(join(to, "_next"), join(to, "next"));
for (const file of [...readdirSync(join(to, "next/static/chunks")).map((f) => join(to, "next/static/chunks", f))]) {
  // A literal U+FFFD (in a UTF-8 decoder's strings) is written as its escape: some hosts refuse the raw character.
  if (file.endsWith(".js")) writeFileSync(file, readFileSync(file, "utf8").replaceAll("_next/", "next/").replaceAll("\uFFFD", "\\ufffd"));
}

const walk = (dir) => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));
let pages = 0;
for (const file of walk(to)) {
  // The RSC payloads only serve client-side navigation, which the preview does not use.
  if (file.endsWith(".txt")) {
    rmSync(file);
    continue;
  }
  if (!file.endsWith(".html")) continue;
  const depth = relative(to, file).split(sep).length - 1;
  if (depth === 0) {
    writeFileSync(file, readFileSync(file, "utf8").replaceAll("_next/", "next/"));
    continue;
  }
  const html = readFileSync(file, "utf8")
    .replaceAll("_next/", "next/")
    .replace("<head>", `<head><base href="${"../".repeat(depth)}">`);
  writeFileSync(file, html);
  pages += 1;
}
// The preview's name in a gallery is the product's name; the tagline stays in the description.
const home = readFileSync(join(from, "fr/index.html"), "utf8").replaceAll("_next/", "next/").replace(/<title>[^<]*<\/title>/, "<title>bruine</title>");
writeFileSync(join(to, "page.html"), home);
console.log(`preview: ${pages} pages based, page.html is the French home`);
