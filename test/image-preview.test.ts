import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { afterEach, describe, expect, test } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { decodeImage, decodePng, describeImage, halfBlocks, imageSize, previewSize, sniffImage, type Pixels } from "../src/ui/image-preview.js";
import { ToolCallComponent } from "../src/ui/tool-call-component.js";
import { UNICODE_ICONS } from "../src/render/chars.js";
import { resetColorDepth } from "../src/ui/palette.js";
import { strip } from "./fakes.js";

/** A real PNG file, filters and all, written the way an encoder would. */
function png(width: number, height: number, colorType: number, depth: number, raw: number[][], extra: Array<[string, number[]]> = []): Uint8Array {
  const chunk = (type: string, data: Uint8Array): Buffer => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    Buffer.from(data).copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)])), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth;
  ihdr[9] = colorType;
  // Each row: a filter byte (Sub on odd rows, to exercise the unfiltering), then its bytes.
  const rows = raw.map((row, y) => {
    if (y % 2 === 0) return [0, ...row];
    const bpp = Math.max(1, (({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType]! * depth) >> 3);
    return [1, ...row.map((v, x) => (v - (x >= bpp ? row[x - bpp]! : 0) + 256) & 255)];
  });
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    ...extra.map(([type, data]) => chunk(type, new Uint8Array(data))),
    chunk("IDAT", deflateSync(Buffer.from(rows.flat()))),
    chunk("IEND", new Uint8Array()),
  ]));
}

const pixel = (img: Pixels, x: number, y: number): number[] => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

describe("decoding", () => {
  test("RGB and RGBA, with filtered rows", () => {
    const rgb = decodePng(png(2, 2, 2, 8, [[255, 0, 0, 0, 255, 0], [0, 0, 255, 10, 20, 30]]))!;
    expect([rgb.width, rgb.height]).toEqual([2, 2]);
    expect(pixel(rgb, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(rgb, 1, 1)).toEqual([10, 20, 30, 255]);
    const rgba = decodePng(png(1, 2, 6, 8, [[1, 2, 3, 4], [5, 6, 7, 128]]))!;
    expect(pixel(rgba, 0, 1)).toEqual([5, 6, 7, 128]);
  });

  test("a palette with transparency, grayscale, and 16 bits", () => {
    const indexed = decodePng(png(2, 1, 3, 8, [[0, 1]], [["PLTE", [9, 8, 7, 200, 100, 50]], ["tRNS", [0]]]))!;
    expect(pixel(indexed, 0, 0)).toEqual([9, 8, 7, 0]);
    expect(pixel(indexed, 1, 0)).toEqual([200, 100, 50, 255]);
    const gray = decodePng(png(1, 1, 0, 8, [[77]]))!;
    expect(pixel(gray, 0, 0)).toEqual([77, 77, 77, 255]);
    const deep = decodePng(png(1, 1, 2, 16, [[0xab, 0xcd, 0x12, 0x34, 0xff, 0xff]]))!;
    expect(pixel(deep, 0, 0)).toEqual([0xab, 0x12, 0xff, 255]);
  });

  test("JPEG through jpeg-js, and the formats are told apart", () => {
    const jpeg = createRequire(import.meta.url)("jpeg-js") as typeof import("jpeg-js");
    const data = Buffer.alloc(8 * 8 * 4, 0);
    for (let i = 0; i < 64; i += 1) data.set([200, 40, 40, 255], i * 4);
    const bytes = new Uint8Array(jpeg.encode({ width: 8, height: 8, data }, 90).data);
    expect(sniffImage(bytes)).toBe("image/jpeg");
    expect(imageSize(bytes)).toEqual({ width: 8, height: 8 });
    const img = decodeImage(bytes)!;
    expect(img.width).toBe(8);
    expect(img.data[0]).toBeGreaterThan(150);
    expect(describeImage(png(3, 2, 2, 8, [[0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0]]))).toBe("PNG 3×2");
    expect(decodeImage(new Uint8Array([1, 2, 3]))).toBeUndefined();
  });
});

describe("drawing", () => {
  test("proportions: a cell is one pixel wide and two tall", () => {
    expect(previewSize(1280, 720, 64, 16)).toEqual({ cols: 57, rows: 16 });
    expect(previewSize(100, 50, 64, 16)).toEqual({ cols: 64, rows: 16 });
    expect(previewSize(10, 10, 64, 16)).toEqual({ cols: 10, rows: 5 });
  });

  test("two pixels per cell: the top one is the glyph, the bottom one the background", () => {
    const img = decodePng(png(1, 2, 2, 8, [[255, 0, 0], [0, 0, 255]]))!;
    const lines = halfBlocks(img, 10, 10, "truecolor")!;
    expect(lines).toEqual(["\x1b[38;2;255;0;0m\x1b[48;2;0;0;255m▀\x1b[39m\x1b[49m"]);
    expect(halfBlocks(img, 10, 10, "256")![0]).toMatch(/^\x1b\[38;5;\d+m\x1b\[48;5;\d+m▀/);
    expect(halfBlocks(img, 10, 10, "basic")).toBeUndefined();
  });
});

describe("the tool card", () => {
  afterEach(() => {
    process.env.BRUINE_COLOR = "basic";
    resetColorDepth();
  });

  test("an image the model read is shown in the transcript, with what it is", () => {
    process.env.BRUINE_COLOR = "truecolor";
    resetColorDepth();
    const dir = mkdtempSync(join(tmpdir(), "bruine-image-"));
    const file = join(dir, "shot.png");
    const row = Array.from({ length: 20 }, (_, x) => [x * 12, 100, 255 - x * 12]).flat();
    writeFileSync(file, png(20, 10, 2, 8, Array.from({ length: 10 }, () => row)));
    const call = new ToolCallComponent("read_image", () => 0, UNICODE_ICONS);
    call.setArgs(JSON.stringify({ path: file }));
    call.result(true, "<image attached>");
    const lines = call.render(80);
    expect(lines.filter((l) => l.includes("▀"))).toHaveLength(5);
    expect(strip(lines.at(-1)!)).toMatch(/PNG 20×10/);
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(80);
  });

  test("where colours cannot draw it, the card says what the image is", () => {
    const dir = mkdtempSync(join(tmpdir(), "bruine-image-"));
    const file = join(dir, "shot.png");
    writeFileSync(file, png(4, 2, 2, 8, [Array(12).fill(0), Array(12).fill(0)]));
    const call = new ToolCallComponent("read_image", () => 0, UNICODE_ICONS);
    call.setArgs(JSON.stringify({ path: file }));
    call.result(true, "<image attached>");
    const text = call.render(80).map(strip).join("\n");
    expect(text).not.toContain("▀");
    expect(text).toContain("PNG 4×2");
  });
});

test("a tool name longer than the column does not push the header past the edge", () => {
  const call = new ToolCallComponent("read_image", () => 0, UNICODE_ICONS);
  call.setArgs(JSON.stringify({ file_path: "design/missing.png" }));
  call.result(true, "ok");
  const head = strip(call.render(60)[0]!);
  expect(head).toMatch(/^✓ read_image  design\/missing\.png\s*$/);
  expect(visibleWidth(head)).toBeLessThanOrEqual(60);
});
