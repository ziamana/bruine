// Draws the BRUINE block logo (the one the terminal shows at launch) as SVG, from the same
// box-drawing letters: public/media/wordmark-nav.svg for the menu, and public/icon.svg (its B) for the tab.
import { writeFileSync } from "node:fs";

const LOGO = ["┏┓ ┏━┓╻ ╻╻┏┓╻┏━╸", "┣┻┓┣┳┛┃ ┃┃┃┗┫┣╸ ", "┗━┛╹┗╸┗━┛╹╹ ╹┗━╸"];
const ARMS = { "┏": "rd", "┓": "ld", "┗": "ur", "┛": "ul", "━": "lr", "┃": "ud", "┣": "udr", "┫": "udl", "┳": "dlr", "┻": "ulr", "╸": "l", "╹": "u", "╻": "d" };
const W = 30, H = W * 2.05;
const STOPS = ["#7dcfff", "#b4a7ff", "#ff9ed2", "#7dcfff"];

/** The path of columns [from, to) of the logo, and its tight bounds. */
function draw(from, to, T = W * 0.3) {
  let d = "";
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  const rect = (a, b, c, e) => {
    d += `M${a.toFixed(1)} ${b.toFixed(1)}H${c.toFixed(1)}V${e.toFixed(1)}H${a.toFixed(1)}Z`;
    [x0, y0, x1, y1] = [Math.min(x0, a), Math.min(y0, b), Math.max(x1, c), Math.max(y1, e)];
  };
  LOGO.forEach((row, r) =>
    [...row].slice(from, to).forEach((ch, i) => {
      if (ch === " ") return;
      const x = i * W, y = r * H, cx = x + W / 2, cy = y + H / 2, h = T / 2;
      rect(cx - h, cy - h, cx + h, cy + h);
      for (const a of ARMS[ch] ?? "") {
        if (a === "u") rect(cx - h, y, cx + h, cy + h);
        if (a === "d") rect(cx - h, cy - h, cx + h, y + H);
        if (a === "l") rect(x, cy - h, cx + h, cy + h);
        if (a === "r") rect(cx - h, cy - h, x + W, cy + h);
      }
    }),
  );
  return { d, x0, y0, w: x1 - x0, h: y1 - y0 };
}
const gradient = (x0, w) =>
  `<linearGradient id="g" x1="${x0}" y1="0" x2="${x0 + w}" y2="0" gradientUnits="userSpaceOnUse">${STOPS.map((s, i) => `<stop offset="${(i / (STOPS.length - 1)).toFixed(3)}" stop-color="${s}"/>`).join("")}</linearGradient>`;

const all = draw(0, 16);
writeFileSync(
  new URL("../public/media/wordmark-nav.svg", import.meta.url),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${all.x0} ${all.y0} ${all.w.toFixed(1)} ${all.h.toFixed(1)}" role="img" aria-label="bruine"><defs>${gradient(all.x0, all.w)}</defs><path d="${all.d}" fill="url(#g)"/></svg>\n`,
);

// The tab icon is a few pixels wide: its strokes are drawn heavier to stay a B.
const b = draw(0, 3, W * 0.5);
const side = Math.max(b.w, b.h) * 1.36;
const ox = b.x0 - (side - b.w) / 2, oy = b.y0 - (side - b.h) / 2;
writeFileSync(
  new URL("../public/icon.svg", import.meta.url),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${ox.toFixed(1)} ${oy.toFixed(1)} ${side.toFixed(1)} ${side.toFixed(1)}"><defs>${gradient(b.x0, b.w)}</defs><rect x="${ox.toFixed(1)}" y="${oy.toFixed(1)}" width="${side.toFixed(1)}" height="${side.toFixed(1)}" rx="${(side * 0.22).toFixed(1)}" fill="#0b0d14"/><path d="${b.d}" fill="url(#g)"/></svg>\n`,
);
console.log(`wordmark ${all.w.toFixed(0)}x${all.h.toFixed(0)}, icon ${side.toFixed(0)}`);
