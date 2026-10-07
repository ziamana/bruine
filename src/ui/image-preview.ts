import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { crc32, deflateSync, inflateSync } from "node:zlib";
import { bgEnabled, colorDepth, to256, type ColorDepth } from "./palette.js";

/**
 * An image the model read, shown in the transcript as the image itself.
 *
 * A terminal that speaks a graphics protocol (kitty, iTerm2: Kitty, Ghostty, WezTerm, Warp,
 * iTerm2, Konsole) is sent the image, at its own resolution: `terminalImageFile` prepares it.
 * Everywhere else every pixel pair becomes one `▀`: the upper pixel is the glyph's colour, the
 * lower one its background. That is text, so it works in any terminal with 24-bit or 256
 * colours, but it is a sketch: a 64-column preview is 64 pixels wide. PNG and JPEG are decoded
 * here; other formats, and a terminal with only 16 colours, get a line that says what it is.
 */

/** Decoded pixels, 8 bits per channel, RGBA, row by row. */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Files larger than this are not decoded for a preview. */
export const MAX_PREVIEW_BYTES = 16 * 1024 * 1024;
/** Images with more pixels than this are not decoded for a preview. */
export const MAX_PREVIEW_PIXELS = 40_000_000;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** `image/png`, `image/jpeg`, `image/gif`, `image/webp`, from the file's first bytes. */
export function sniffImage(bytes: Uint8Array): string | undefined {
  if (PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const ascii = (from: number, n: number): string => String.fromCharCode(...bytes.subarray(from, from + n));
  if (ascii(0, 4) === "GIF8") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  return undefined;
}

/** The pixel size an image declares in its header (PNG, JPEG, GIF), without decoding it. */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = sniffImage(bytes);
  try {
    if (type === "image/png") return { width: view.getUint32(16), height: view.getUint32(20) };
    if (type === "image/gif") return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
    if (type === "image/jpeg") {
      let at = 2;
      while (at + 9 < bytes.length) {
        if (bytes[at] !== 0xff) return undefined;
        const marker = bytes[at + 1]!;
        const length = view.getUint16(at + 2);
        // Start-of-frame markers carry the size (SOF0..SOF15 but DHT, JPG and DAC).
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: view.getUint16(at + 5), width: view.getUint16(at + 7) };
        }
        at += 2 + length;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** A PNG's pixels (8 and 16 bits per channel, every colour type, not interlaced). */
export function decodePng(bytes: Uint8Array): Pixels | undefined {
  if (sniffImage(bytes) !== "image/png") return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Uint8Array | undefined;
  let transparency: Uint8Array | undefined;
  const idat: Uint8Array[] = [];
  let at = 8;
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      depth = bytes[at + 16]!;
      colorType = bytes[at + 17]!;
      interlace = bytes[at + 20]!;
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") transparency = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    at += 12 + length;
  }
  if (width === 0 || height === 0 || interlace !== 0 || width * height > MAX_PREVIEW_PIXELS) return undefined;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType as 0 | 2 | 3 | 4 | 6];
  if (channels === undefined || ![1, 2, 4, 8, 16].includes(depth)) return undefined;
  let raw: Uint8Array;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return undefined;
  }
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  if (raw.length < height * (stride + 1)) return undefined;
  // Undo the per-row filters (None, Sub, Up, Average, Paeth).
  const rows = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const out = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? rows[out + x - bpp]! : 0;
      const b = y > 0 ? rows[out - stride + x]! : 0;
      const c = x >= bpp && y > 0 ? rows[out - stride + x - bpp]! : 0;
      let v = raw[src + x]!;
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      rows[out + x] = v & 255;
    }
  }
  const sample = (y: number, index: number): number => {
    // The index-th sample of row y, scaled to 8 bits.
    if (depth === 16) return rows[y * stride + index * 2]!;
    if (depth === 8) return rows[y * stride + index]!;
    const bit = index * depth;
    const byte = rows[y * stride + (bit >> 3)]!;
    const value = (byte >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
    return colorType === 3 ? value : Math.round((value * 255) / ((1 << depth) - 1));
  };
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      if (colorType === 3) {
        const i = sample(y, x);
        data[o] = palette?.[i * 3] ?? 0;
        data[o + 1] = palette?.[i * 3 + 1] ?? 0;
        data[o + 2] = palette?.[i * 3 + 2] ?? 0;
        data[o + 3] = transparency?.[i] ?? 255;
      } else if (colorType === 0 || colorType === 4) {
        const g = sample(y, x * channels);
        data[o] = data[o + 1] = data[o + 2] = g;
        data[o + 3] = colorType === 4 ? sample(y, x * channels + 1) : 255;
      } else {
        data[o] = sample(y, x * channels);
        data[o + 1] = sample(y, x * channels + 1);
        data[o + 2] = sample(y, x * channels + 2);
        data[o + 3] = colorType === 6 ? sample(y, x * channels + 3) : 255;
      }
    }
  }
  return { width, height, data };
}

/** A JPEG's pixels, through jpeg-js (pure JavaScript), loaded only when one is shown. */
export function decodeJpeg(bytes: Uint8Array): Pixels | undefined {
  try {
    const jpeg = createRequire(import.meta.url)("jpeg-js") as typeof import("jpeg-js");
    const img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: MAX_PREVIEW_PIXELS / 1e6, maxMemoryUsageInMB: 512 });
    return { width: img.width, height: img.height, data: img.data };
  } catch {
    return undefined;
  }
}

export function decodeImage(bytes: Uint8Array): Pixels | undefined {
  const type = sniffImage(bytes);
  if (type === "image/png") return decodePng(bytes);
  if (type === "image/jpeg") return decodeJpeg(bytes);
  return undefined;
}

/** Average the pixels of a box onto `bg` (transparency shows the terminal through). */
function boxColor(img: Pixels, x0: number, y0: number, x1: number, y1: number, bg: [number, number, number]): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const xa = Math.floor(x0);
  const ya = Math.floor(y0);
  const xb = Math.max(xa + 1, Math.ceil(x1));
  const yb = Math.max(ya + 1, Math.ceil(y1));
  for (let y = ya; y < Math.min(yb, img.height); y += 1) {
    for (let x = xa; x < Math.min(xb, img.width); x += 1) {
      const o = (y * img.width + x) * 4;
      const a = img.data[o + 3]! / 255;
      r += img.data[o]! * a + bg[0] * (1 - a);
      g += img.data[o + 1]! * a + bg[1] * (1 - a);
      b += img.data[o + 2]! * a + bg[2] * (1 - a);
      n += 1;
    }
  }
  return n === 0 ? bg : [r / n, g / n, b / n];
}

/** The cell grid an image fills at most `cols` wide and `rows` tall, keeping its proportions. */
export function previewSize(width: number, height: number, cols: number, rows: number): { cols: number; rows: number } {
  // A cell is about twice as tall as it is wide, and holds two pixel rows: one pixel per column
  // and two per row keeps the image's own proportions.
  let w = Math.max(1, Math.min(cols, width));
  let h = Math.max(1, Math.round((w * height) / width / 2));
  if (h > rows) {
    h = rows;
    w = Math.max(1, Math.min(cols, Math.round((rows * 2 * width) / height)));
  }
  return { cols: w, rows: h };
}

const esc = (c: [number, number, number], depth: ColorDepth, ground: 38 | 48): string => {
  const [r, g, b] = c.map((v) => Math.max(0, Math.min(255, Math.round(v)))) as [number, number, number];
  if (depth === "truecolor") return `\x1b[${String(ground)};2;${String(r)};${String(g)};${String(b)}m`;
  const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  return `\x1b[${String(ground)};5;${String(to256(hex, true))}m`;
};

/** The image as `rows` lines of `▀`, or undefined where colours cannot show it. */
export function halfBlocks(img: Pixels, cols: number, rows: number, depth: ColorDepth = colorDepth(), bg: [number, number, number] = [14, 16, 24]): string[] | undefined {
  if ((depth !== "truecolor" && depth !== "256") || !bgEnabled(depth)) return undefined;
  const size = previewSize(img.width, img.height, cols, rows);
  const sx = img.width / size.cols;
  const sy = img.height / (size.rows * 2);
  const out: string[] = [];
  for (let row = 0; row < size.rows; row += 1) {
    let line = "";
    for (let col = 0; col < size.cols; col += 1) {
      const top = boxColor(img, col * sx, row * 2 * sy, (col + 1) * sx, (row * 2 + 1) * sy, bg);
      const bottom = boxColor(img, col * sx, (row * 2 + 1) * sy, (col + 1) * sx, (row * 2 + 2) * sy, bg);
      line += `${esc(top, depth, 38)}${esc(bottom, depth, 48)}▀`;
    }
    out.push(`${line}\x1b[39m\x1b[49m`);
  }
  return out;
}

/** What an image is, in a word, for a terminal that cannot show it. */
export function describeImage(bytes: Uint8Array): string {
  const type = sniffImage(bytes)?.replace("image/", "").toUpperCase() ?? "image";
  const size = imageSize(bytes);
  return size === undefined ? type : `${type} ${String(size.width)}×${String(size.height)}`;
}

/** The preview of an image file: its lines, or a description when it cannot be drawn. */
export function previewImageFile(path: string, cols: number, rows: number): { lines?: string[]; description: string } | undefined {
  try {
    if (statSync(path).size > MAX_PREVIEW_BYTES) return undefined;
    const bytes = new Uint8Array(readFileSync(path));
    const description = describeImage(bytes);
    const img = decodeImage(bytes);
    const lines = img === undefined ? undefined : halfBlocks(img, cols, rows);
    return lines === undefined ? { description } : { lines, description };
  } catch {
    return undefined;
  }
}

/** A PNG of `img`: RGBA, no filter, deflated. Enough for a terminal to show what was decoded. */
export function encodePng(img: Pixels): Uint8Array {
  const chunk = (type: string, data: Uint8Array): Buffer => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    Buffer.from(data).copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)])), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(img.width, 0);
  header.writeUInt32BE(img.height, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = img.width * 4;
  const raw = Buffer.alloc((stride + 1) * img.height);
  for (let y = 0; y < img.height; y += 1) Buffer.from(img.data.buffer, img.data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  return new Uint8Array(Buffer.concat([Buffer.from(PNG_SIGNATURE), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())]));
}

/** `img` scaled down to fit `max` pixels on its longer side, each pixel the average of its box. */
export function shrink(img: Pixels, max: number): Pixels {
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  if (scale >= 1) return img;
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const data = new Uint8Array(width * height * 4);
  const sx = img.width / width;
  const sy = img.height / height;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sum = [0, 0, 0, 0];
      let n = 0;
      for (let yy = Math.floor(y * sy); yy < Math.min(img.height, Math.ceil((y + 1) * sy)); yy += 1) {
        for (let xx = Math.floor(x * sx); xx < Math.min(img.width, Math.ceil((x + 1) * sx)); xx += 1) {
          const o = (yy * img.width + xx) * 4;
          for (let c = 0; c < 4; c += 1) sum[c]! += img.data[o + c]!;
          n += 1;
        }
      }
      for (let c = 0; c < 4; c += 1) data[(y * width + x) * 4 + c] = Math.round(sum[c]! / Math.max(1, n));
    }
  }
  return { width, height, data };
}

/** Past this many bytes or pixels on a side, the image is re-encoded smaller before it is sent. */
const SEND_MAX_BYTES = 2 * 1024 * 1024;
const SEND_MAX_SIDE = 1600;

/**
 * An image file ready for a graphics protocol: base64, its type and size, and what it is.
 * Kitty takes PNG only, so a JPEG is re-encoded; a large image is sent at most 1600 pixels on a
 * side. A format that cannot be re-encoded where it must be (GIF, WebP to kitty) is undefined.
 */
export function terminalImageFile(
  path: string,
  protocol: "kitty" | "iterm2",
): { base64: string; mimeType: string; widthPx: number; heightPx: number; description: string } | undefined {
  try {
    if (statSync(path).size > MAX_PREVIEW_BYTES) return undefined;
    const bytes = new Uint8Array(readFileSync(path));
    const mimeType = sniffImage(bytes);
    const size = imageSize(bytes);
    if (mimeType === undefined || size === undefined) return undefined;
    const description = describeImage(bytes);
    const tooBig = bytes.length > SEND_MAX_BYTES || Math.max(size.width, size.height) > SEND_MAX_SIDE;
    if (!tooBig && (protocol === "iterm2" || mimeType === "image/png")) {
      return { base64: Buffer.from(bytes).toString("base64"), mimeType, widthPx: size.width, heightPx: size.height, description };
    }
    const img = decodeImage(bytes);
    if (img === undefined) return undefined;
    const sent = shrink(img, SEND_MAX_SIDE);
    return { base64: Buffer.from(encodePng(sent)).toString("base64"), mimeType: "image/png", widthPx: sent.width, heightPx: sent.height, description };
  } catch {
    return undefined;
  }
}
