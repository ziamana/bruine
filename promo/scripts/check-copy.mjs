// Fails when a text shown on screen carries an em dash (U+2014). Run with `npm run check:copy`.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../src", import.meta.url).pathname;
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(tsx?|json)$/.test(name)) files.push(path);
  }
};
walk(root);

let bad = 0;
for (const file of files) {
  readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    if (line.includes("—")) {
      console.error(`${file}:${i + 1}: em dash: ${line.trim()}`);
      bad += 1;
    }
  });
}
if (bad > 0) process.exit(1);
console.log(`No em dash in ${files.length} source files.`);
