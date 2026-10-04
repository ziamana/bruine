// Builds public/tape/session.json (104 columns) and session-narrow.json (56 columns, for phones)
// from recordings of the real bruine: the session (data/recording.ts, the promo film's, and
// data/narrow/recording.json, both from test/e2e/video-recording.test.ts) and the stills
// (shots*.json, from test/e2e/screenshots.test.ts). Every screen the site plays is one of these.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const ROWS = 26;
const read = (path) => readFileSync(new URL(`../data/${path}`, import.meta.url), "utf8");
const parseRecording = (text) => JSON.parse(text.slice(text.indexOf('{"cols"'), text.lastIndexOf("}") + 1));

function build(rec, shots, light, file) {
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
  const tape = {
    cols: rec.cols,
    rows: ROWS,
    fps: rec.fps,
    markers: rec.markers,
    rowTable,
    frames: rec.frames,
    stills: {
      retry: fit(shots.shots["4-retry"]),
      image: fit(shots.shots["2b-image"]),
      light: fit(light.shots["6-light"]),
    },
    lightBackground: light.background,
  };
  mkdirSync(new URL("../public/tape/", import.meta.url), { recursive: true });
  writeFileSync(new URL(`../public/tape/${file}`, import.meta.url), JSON.stringify(tape));
  console.log(`${file}: ${tape.cols} columns, ${tape.frames.length} frames, ${rowTable.length} distinct rows`);
}

build(parseRecording(read("recording.ts")), JSON.parse(read("shots.json")), JSON.parse(read("shots-light.json")), "session.json");
build(JSON.parse(read("narrow/recording.json")), JSON.parse(read("narrow/shots.json")), JSON.parse(read("narrow/shots-light.json")), "session-narrow.json");
