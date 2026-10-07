import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { afterEach, describe, expect, test } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { decodeImage, decodePng, describeImage, encodePng, halfBlocks, imageSize, previewSize, shrink, sniffImage, terminalImageFile, type Pixels } from "../src/ui/image-preview.js";
import { imageProtocolFor, imageRows, splitImageLine } from "../src/ui/term-images.js";
import { setCapabilities, resetCapabilitiesCache, setCapabilityOverrides } from "@earendil-works/pi-tui";
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

describe("a terminal that can show the image itself", () => {
  afterEach(() => {
    setCapabilityOverrides({});
    resetCapabilitiesCache();
  });
  const gradient = (w: number, h: number): number[][] => Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => [x * 10, y * 10, 200]).flat());

  test("PNG out of decoded pixels reads back the same, and shrinking keeps the proportions", () => {
    const img = decodePng(png(6, 4, 2, 8, gradient(6, 4)))!;
    const back = decodePng(encodePng(img))!;
    expect([back.width, back.height]).toEqual([6, 4]);
    expect(pixel(back, 5, 3)).toEqual(pixel(img, 5, 3));
    const small = shrink(img, 3);
    expect([small.width, small.height]).toEqual([3, 2]);
    expect(shrink(img, 10)).toBe(img);
  });

  test("kitty is sent a PNG, iTerm2 the file as it is", () => {
    const dir = mkdtempSync(join(tmpdir(), "bruine-image-"));
    const jpegPath = join(dir, "shot.jpg");
    const jpeg = createRequire(import.meta.url)("jpeg-js") as typeof import("jpeg-js");
    writeFileSync(jpegPath, jpeg.encode({ width: 8, height: 4, data: Buffer.alloc(8 * 4 * 4, 120) }, 90).data);
    expect(terminalImageFile(jpegPath, "iterm2")).toMatchObject({ mimeType: "image/jpeg", widthPx: 8, heightPx: 4, description: "JPEG 8×4" });
    const forKitty = terminalImageFile(jpegPath, "kitty")!;
    expect(forKitty.mimeType).toBe("image/png");
    expect(sniffImage(new Uint8Array(Buffer.from(forKitty.base64, "base64")))).toBe("image/png");
    const pngPath = join(dir, "shot.png");
    const bytes = png(4, 2, 2, 8, gradient(4, 2));
    writeFileSync(pngPath, bytes);
    expect(terminalImageFile(pngPath, "kitty")!.base64).toBe(Buffer.from(bytes).toString("base64"));
  });

  test("the card draws the real image in kitty and iTerm2, and the sketch elsewhere", () => {
    const dir = mkdtempSync(join(tmpdir(), "bruine-image-"));
    const file = join(dir, "shot.png");
    writeFileSync(file, png(40, 20, 2, 8, gradient(40, 20)));
    const card = (): string[] => {
      const call = new ToolCallComponent("read_image", () => 0, UNICODE_ICONS);
      call.setArgs(JSON.stringify({ path: file }));
      call.result(true, "<image attached>");
      return call.render(80);
    };
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: false });
    const kitty = card();
    expect(kitty.filter((l) => l.includes("\x1b_G"))).toHaveLength(1);
    expect(kitty.some((l) => l.includes("▀"))).toBe(false);
    expect(strip(kitty.at(-1)!)).toMatch(/PNG 40×20/);
    setCapabilities({ images: "iterm2", trueColor: true, hyperlinks: false });
    const iterm = card();
    const at = iterm.findIndex((l) => l.includes("\x1b]1337;File="));
    expect(at).toBeGreaterThan(1);
    // The image is drawn from its last row, after moving up over the rows reserved above it.
    expect(iterm[at]).toMatch(/\x1b\[\d+A\x1b\]1337;File=/);
    expect([...imageRows(iterm)].sort((a, b) => a - b)[0]).toBeGreaterThan(0);
    setCapabilities({ images: null, trueColor: true, hyperlinks: false });
    process.env.BRUINE_COLOR = "truecolor";
    resetColorDepth();
    expect(card().some((l) => l.includes("▀"))).toBe(true);
  });

  test("Konsole gets the iTerm2 protocol, BRUINE_IMAGES decides anywhere, and a multiplexer gets none", () => {
    expect(imageProtocolFor({ KONSOLE_VERSION: "230805" })).toBe("iterm2");
    expect(imageProtocolFor({ KONSOLE_VERSION: "211200" })).toBeUndefined();
    expect(imageProtocolFor({ KONSOLE_VERSION: "230805", TMUX: "/tmp/tmux" })).toBeUndefined();
    expect(imageProtocolFor({ BRUINE_IMAGES: "kitty" })).toBe("kitty");
    expect(imageProtocolFor({ BRUINE_IMAGES: "blocks", KONSOLE_VERSION: "230805" })).toBeNull();
    expect(imageProtocolFor({})).toBeUndefined();
  });

  test("the rows an image covers are known, for the rain to stay off them", () => {
    expect([...imageRows(["a", "\x1b_Ga=T,f=100,C=1,c=10,r=3;AAAA\x1b\\", "", "", "b"])]).toEqual([1, 2, 3]);
    expect([...imageRows(["", "", "\x1b[2A\x1b]1337;File=inline=1:AAAA\x07", "x"])].sort()).toEqual([0, 1, 2]);
  });

  test("a line is split at its image, cursor-up included, so the layout never clips the base64", () => {
    expect(splitImageLine("    \x1b[2A\x1b]1337;File=inline=1:AAAA\x07")).toEqual({ before: "    ", sequence: "\x1b[2A\x1b]1337;File=inline=1:AAAA\x07" });
    expect(splitImageLine("  \x1b_Ga=T,f=100;AAAA\x1b\\")).toEqual({ before: "  ", sequence: "\x1b_Ga=T,f=100;AAAA\x1b\\" });
    expect(splitImageLine("plain text")).toBeUndefined();
  });
});
