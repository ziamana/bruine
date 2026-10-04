// Builds public/tape/session.json from recordings of the real bruine: the promo film's session
// (data/recording.ts, from test/e2e/video-recording.test.ts) and the stills
// (data/shots*.json, from test/e2e/screenshots.test.ts). Every screen the site plays is one of these.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const ROWS = 26;
const source = readFileSync(new URL("../data/recording.ts", import.meta.url), "utf8");
const rec = JSON.parse(source.slice(source.indexOf('{"cols"'), source.lastIndexOf("}") + 1));
const rowTable = [...rec.rowTable];
const index = new Map(rowTable.map((row, i) => [JSON.stringify(row), i]));
const intern = (row) => {
  const key = JSON.stringify(row);
  if (!index.has(key)) {
    index.set(key, rowTable.length);
    rowTable.push(row);
  }
  return index.get(key);
};
/** Adjacent cells with one style become one run, as the recorder writes them. */
const merge = (spans) => {
  const out = [];
  for (const [col, text, fg, bg, flags] of spans) {
    const last = out.at(-1);
    if (last && last[2] === fg && last[3] === bg && last[4] === flags && last[0] + [...last[1]].length === col) last[1] += text;
    else out.push([col, text, fg, bg, flags]);
  }
  return out;
};
/** The bottom ROWS rows of a still (the prompt box and footer live there), padded at the top if short. */
const fit = (rows) => {
  const tail = rows.slice(-ROWS).map((r) => intern(merge(r)));
  return [...Array(Math.max(0, ROWS - tail.length)).fill(intern([])), ...tail];
};
const shots = JSON.parse(readFileSync(new URL("../data/shots.json", import.meta.url), "utf8")).shots;
const light = JSON.parse(readFileSync(new URL("../data/shots-light.json", import.meta.url), "utf8"));

const tape = {
  cols: rec.cols,
  rows: ROWS,
  fps: rec.fps,
  markers: rec.markers,
  rowTable,
  frames: rec.frames,
  stills: {
    retry: fit(shots["4-retry"]),
    image: fit(shots["2b-image"]),
    light: fit(light.shots["6-light"]),
  },
  lightBackground: light.background,
};
mkdirSync(new URL("../public/tape/", import.meta.url), { recursive: true });
writeFileSync(new URL("../public/tape/session.json", import.meta.url), JSON.stringify(tape));
console.log(`tape: ${tape.frames.length} frames, ${rowTable.length} distinct rows`);
