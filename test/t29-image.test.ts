import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { Terminal } from "@earendil-works/pi-tui";
import {
  clipboardReaders,
  draggedImagePath,
  distroId,
  formatBytes,
  installHint,
  MAX_IMAGE_BYTES,
  mediaTypeForPath,
  readClipboardImage,
  readImageFile,
  rejectionNotice,
  sniffImageMediaType,
  type ClipboardReader,
  type ClipboardRead,
  type RunResult,
} from "../src/image/clipboard.js";
import { imageChip, parseImageChips, PendingImages, stripImageChips } from "../src/image/pending.js";
import {
  entryVisionAnswer,
  modelsPayloadSeesImages,
  NO_VISION_NOTICE,
  probeVision,
  resolveVision,
} from "../src/image/vision.js";
import {
  attachFailureNotice,
  buildUserContent,
  NO_STORE_NOTICE,
  type AttachmentStoreLike,
} from "../src/image/attach.js";
import { BruineUi } from "../src/ui/bruine-ui.js";
import { UNICODE_ICONS } from "../src/render/chars.js";
import { strip } from "./fakes.js";

const savedDshHome = process.env.DSH_HOME;
beforeAll(() => {
  process.env.DSH_HOME = mkdtempSync(join(tmpdir(), "bruine-t29-test-"));
});
afterAll(() => {
  if (savedDshHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = savedDshHome;
});

/** A real 1x1 PNG, so the sniffer and the byte ceiling see honest input. */
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const RIFF = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
const TEXT = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]); // "hello"

const pngImage = (name = "clipboard.png") => ({ data: PNG, mediaType: "image/png" as const, name });

const ok = (stdout: Uint8Array): RunResult => ({ code: 0, stdout: Buffer.from(stdout), stderr: "" });
const fail = (code: number, stderr = ""): RunResult => ({ code, stdout: Buffer.alloc(0), stderr });
const all = async (): Promise<boolean> => true;

describe("clipboard readers", () => {
  test("each platform gets its own reader, Wayland never falls back to xclip", () => {
    const saved = process.env["WAYLAND_DISPLAY"];
    try {
      process.env["WAYLAND_DISPLAY"] = "wayland-0";
      expect(clipboardReaders("linux").map((r) => r.cmd)).toEqual(["wl-paste"]);
      delete process.env["WAYLAND_DISPLAY"];
      expect(clipboardReaders("linux").map((r) => r.cmd)).toEqual(["xclip", "xsel"]);
      expect(clipboardReaders("darwin").map((r) => r.cmd)).toEqual(["pngpaste", "osascript"]);
      expect(clipboardReaders("win32").map((r) => r.cmd)).toEqual(["powershell"]);
    } finally {
      if (saved === undefined) delete process.env["WAYLAND_DISPLAY"];
      else process.env["WAYLAND_DISPLAY"] = saved;
    }
  });

  test("every reader says what to install when it is missing", () => {
    for (const reader of clipboardReaders("darwin")) expect(reader.install).not.toBe("");
    for (const reader of clipboardReaders("win32")) expect(reader.install).not.toBe("");
  });

  test("the install line is the command this distro actually wants", () => {
    expect(installHint("wl-paste", "cachyos")).toBe("sudo pacman -S wl-clipboard");
    expect(installHint("wl-paste", "arch")).toBe("sudo pacman -S wl-clipboard");
    expect(installHint("wl-paste", "ubuntu")).toBe("sudo apt install wl-clipboard");
    expect(installHint("wl-paste", "fedora")).toBe("sudo dnf install wl-clipboard");
    expect(installHint("xclip", "debian")).toBe("sudo apt install xclip");
    expect(installHint("pngpaste", "darwin")).toBe("brew install pngpaste");
    expect(installHint("wl-paste", "plan9")).toContain("wl-clipboard");
  });

  test("the distro id comes from /etc/os-release, and a missing file is not fatal", () => {
    expect(distroId(() => 'NAME="CachyOS"\nID=cachyos\n')).toBe("cachyos");
    expect(distroId(() => {
      throw new Error("no os-release");
    })).toBe("unknown");
  });
});

describe("sniffImageMediaType", () => {
  test("the bytes decide, never the name", () => {
    expect(sniffImageMediaType(PNG)).toBe("image/png");
    expect(sniffImageMediaType(JPEG)).toBe("image/jpeg");
    expect(sniffImageMediaType(GIF)).toBe("image/gif");
    expect(sniffImageMediaType(RIFF)).toBe("image/webp");
    expect(sniffImageMediaType(TEXT)).toBeUndefined();
    expect(sniffImageMediaType(new Uint8Array(0))).toBeUndefined();
  });

  test("RIFF without the WEBP tag is not an image", () => {
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45]);
    expect(sniffImageMediaType(wav)).toBeUndefined();
  });
});

describe("readClipboardImage", () => {
  const reader: ClipboardReader = { cmd: "wl-paste", args: [], install: "install wl-clipboard" };

  test("an image becomes bytes plus a name", async () => {
    const read = await readClipboardImage(async () => ok(PNG), [reader], all);
    expect(read).toEqual({ kind: "image", image: pngImage() });
  });

  test("text on the clipboard is 'none', so the paste falls through to the editor", async () => {
    expect(await readClipboardImage(async () => ok(TEXT), [reader], all)).toEqual({ kind: "none" });
  });

  test("no reader installed is one line of advice, never a throw", async () => {
    const read = await readClipboardImage(async () => ok(PNG), [reader], async () => false);
    expect(read).toEqual({ kind: "no-tool", install: "install wl-clipboard" });
  });

  test("xclip exiting 1 on an empty selection means no image, not a failure", async () => {
    expect(await readClipboardImage(async () => fail(1), [reader], all)).toEqual({ kind: "none" });
  });

  test("a real failure names the tool", async () => {
    const read = await readClipboardImage(async () => fail(2, "cannot open display\nsecond line"), [reader], all);
    expect(read).toEqual({ kind: "failed", detail: "cannot open display" });
  });

  test("the second reader is tried when the first is not installed", async () => {
    const second: ClipboardReader = { cmd: "xsel", args: [], install: "install xsel" };
    const seen: string[] = [];
    const read = await readClipboardImage(
      async (r) => {
        seen.push(r.cmd);
        return ok(PNG);
      },
      [reader, second],
      async (cmd) => cmd === "xsel",
    );
    expect(seen).toEqual(["xsel"]);
    expect(read.kind).toBe("image");
  });

  test("an oversized image is refused with both sizes in the line", async () => {
    const huge = new Uint8Array(MAX_IMAGE_BYTES + 1);
    huge.set(PNG);
    const read = await readClipboardImage(async () => ok(huge), [reader], all);
    expect(read.kind).toBe("rejected");
    expect(read.kind === "rejected" ? read.reason : "").toContain(formatBytes(MAX_IMAGE_BYTES));
  });
});

describe("readImageFile", () => {
  const dir = mkdtempSync(join(tmpdir(), "bruine-t29-img-"));

  test("a real PNG file is read and named after its leaf", async () => {
    const file = join(dir, "shot.png");
    writeFileSync(file, PNG);
    expect(await readImageFile(file)).toEqual({ kind: "image", image: pngImage("shot.png") });
  });

  test("a .png that is really text is refused, not attached", async () => {
    const file = join(dir, "fake.png");
    writeFileSync(file, "this is not a png");
    const read = await readImageFile(file);
    expect(read.kind).toBe("rejected");
    expect(read.kind === "rejected" ? read.reason : "").toContain("fake.png");
  });

  test("a non-image extension is not an image at all", async () => {
    expect(await readImageFile(join(dir, "notes.txt"))).toEqual({ kind: "none" });
    expect(mediaTypeForPath("a/b/c.JPEG")).toBe("image/jpeg");
    expect(mediaTypeForPath("a/b/c.svg")).toBeUndefined();
  });

  test("a missing file fails without a crash", async () => {
    const read = await readImageFile(join(dir, "gone.png"));
    expect(read.kind).toBe("failed");
  });
});

describe("draggedImagePath", () => {
  test("a bare, quoted or file:// path is recognized, prose is not", () => {
    expect(draggedImagePath("/home/a/x.png")).toBe("/home/a/x.png");
    expect(draggedImagePath("'/home/a/x.png'")).toBe("/home/a/x.png");
    expect(draggedImagePath('"/home/a/x.png"')).toBe("/home/a/x.png");
    expect(draggedImagePath("file:///home/a/space%20name.png")).toBe("/home/a/space name.png");
    expect(draggedImagePath("look at /home/a/x.png")).toBeUndefined();
    expect(draggedImagePath("")).toBeUndefined();
    expect(draggedImagePath("/home/a/notes.txt")).toBeUndefined();
  });
});

describe("PendingImages", () => {
  test("numbering never restarts, so a chip always means the same image", () => {
    const pending = new PendingImages();
    expect(pending.add(pngImage())).toBe("[Image 1]");
    expect(pending.add(pngImage())).toBe("[Image 2]");
    expect(pending.add(pngImage())).toBe(imageChip(3));
  });

  test("resolve returns the referenced images once, in chip order", () => {
    const pending = new PendingImages();
    const a = pending.add(pngImage("a.png"));
    const b = pending.add(pngImage("b.png"));
    const images = pending.resolve(`see ${b} and ${a} and ${b} again`);
    expect(images.map((i) => i.name)).toEqual(["b.png", "a.png"]);
  });

  test("an unknown chip is text, not a reference to anything", () => {
    const pending = new PendingImages();
    expect(pending.resolve("[Image 99]")).toEqual([]);
    expect(pending.size).toBe(0);
  });

  test("release forgets the bytes once the store owns them", () => {
    const pending = new PendingImages();
    pending.add(pngImage());
    const [image] = pending.resolve("[Image 1]");
    pending.release(image === undefined ? [] : [image]);
    expect(pending.size).toBe(0);
    expect(pending.resolve("[Image 1]")).toEqual([]);
  });

  test("prune drops a chip the user deleted before sending", () => {
    const pending = new PendingImages();
    pending.add(pngImage("a.png"));
    pending.add(pngImage("b.png"));
    pending.prune("[Image 2]");
    expect(pending.get(1)).toBeUndefined();
    expect(pending.get(2)?.name).toBe("b.png");
  });

  test("a new conversation forgets every pending image", () => {
    const pending = new PendingImages();
    pending.add(pngImage());
    pending.clear();
    expect(pending.size).toBe(0);
  });

  test("parse and strip round-trip without leaving a hole", () => {
    expect(parseImageChips("a [Image 1] b [Image 12]")).toEqual([1, 12]);
    expect(stripImageChips("look at  [Image 1]  please")).toBe("look at please");
    expect(stripImageChips("[Image 1]")).toBe("");
  });
});

describe("vision", () => {
  test("an entry that says nothing is unknown, not a no", () => {
    expect(entryVisionAnswer({ id: "/m/Ornith.gguf", name: "Ornith" })).toBe("unknown");
    expect(entryVisionAnswer(undefined)).toBe("unknown");
    expect(entryVisionAnswer({})).toBe("unknown");
  });

  test("an explicit declaration is honoured in any casing", () => {
    expect(entryVisionAnswer({ capabilities: ["completion", "multimodal"] })).toBe("yes");
    expect(entryVisionAnswer({ capabilities: "completion multimodal" })).toBe("yes");
    expect(entryVisionAnswer({ vision: true })).toBe("yes");
    expect(entryVisionAnswer({ multimodal: "yes" })).toBe("yes");
    expect(entryVisionAnswer({ vision: false })).toBe("no");
    expect(entryVisionAnswer({ capabilities: ["completion"] })).toBe("no");
  });

  test("the /v1/models payload is matched on the model id", () => {
    const payload = { data: [{ id: "a", capabilities: ["completion"] }, { id: "b", capabilities: ["multimodal"] }] };
    expect(modelsPayloadSeesImages(payload, "b")).toBe("yes");
    expect(modelsPayloadSeesImages(payload, "a")).toBe("no");
    expect(modelsPayloadSeesImages(payload, "missing")).toBe("unknown");
    expect(modelsPayloadSeesImages([{ id: "b", capabilities: ["multimodal"] }], "b")).toBe("yes");
    expect(modelsPayloadSeesImages("nonsense", "b")).toBe("unknown");
  });

  test("only a local server is ever probed", async () => {
    const doFetch = vi.fn();
    expect(await probeVision("https://api.example.com/v1", "m", doFetch as never)).toBe("unknown");
    expect(doFetch).not.toHaveBeenCalled();
  });

  test("a local probe reads capabilities and survives a dead server", async () => {
    const yes = vi.fn(async () => ({ ok: true, json: async () => ({ data: [{ id: "m", capabilities: ["multimodal"] }] }) }));
    expect(await probeVision("http://192.168.1.64:8081/v1", "m", yes as never)).toBe("yes");
    const dead = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(await probeVision("http://localhost:8080/v1", "m", dead as never)).toBe("unknown");
  });

  test("settings answer first, and a no is never overridden by the probe", async () => {
    const doFetch = vi.fn();
    expect(
      await resolveVision({
        settingsEntry: { vision: false },
        baseUrl: "http://localhost:8080/v1",
        model: "m",
        doFetch: doFetch as never,
      }),
    ).toBe("no");
    expect(doFetch).not.toHaveBeenCalled();
    expect(
      await resolveVision({
        settingsEntry: { vision: true },
        baseUrl: undefined,
        model: "m",
      }),
    ).toBe("yes");
  });

  test("the refusal line is the one the ticket names", () => {
    expect(NO_VISION_NOTICE).toBe("This model cannot see images");
  });
});

describe("buildUserContent", () => {
  const ref = { attachmentId: "sha256:abc", mediaType: "image/png", bytes: 16, width: 1, height: 1 } as never;
  const store = (): AttachmentStoreLike => ({ saveImage: async () => ref });

  test("no image means exactly the text part, unchanged", async () => {
    const built = await buildUserContent("hello", [], store());
    expect(built.parts).toEqual([{ type: "text", text: "hello" }]);
    expect(built).toMatchObject({ attached: 0, failures: [], noStore: false });
  });

  test("the chip label stays in the text, the image follows it", async () => {
    const built = await buildUserContent("look [Image 1]", [pngImage()], store());
    expect(built.parts).toEqual([
      { type: "text", text: "look [Image 1]" },
      { type: "image", attachment: ref },
    ]);
    expect(built.attached).toBe(1);
  });

  test("a missing store sends the words and says so", async () => {
    const built = await buildUserContent("look [Image 1]", [pngImage()], undefined);
    expect(built).toMatchObject({ attached: 0, noStore: true });
    expect(built.parts).toHaveLength(1);
    expect(NO_STORE_NOTICE).not.toBe("");
  });

  test("one refusal never costs the message or the other image", async () => {
    let call = 0;
    const flaky: AttachmentStoreLike = {
      saveImage: async () => {
        call += 1;
        if (call === 1) throw new Error("image is 40 MB\nsecond line");
        return ref;
      },
    };
    const built = await buildUserContent("two [Image 1] [Image 2]", [pngImage("a.png"), pngImage("b.png")], flaky);
    expect(built.attached).toBe(1);
    expect(built.failures).toEqual(["image is 40 MB"]);
    expect(built.parts).toHaveLength(2);
    expect(attachFailureNotice(built.failures)).toBe("Image not attached: image is 40 MB");
  });

  test("the notice counts the losses when there are several", () => {
    expect(attachFailureNotice(["a", "b"])).toBe("2 images not attached: a, b");
    expect(attachFailureNotice([])).toBe("");
  });
});

class FakeTerminal implements Terminal {
  writes: string[] = [];
  onInput?: (data: string) => void;
  columns = 60;
  rows = 20;
  kittyProtocolActive = false;
  start(onInput: (data: string) => void): void {
    this.onInput = onInput;
  }
  stop(): void {}
  async drainInput(): Promise<void> {}
  write(data: string): void {
    this.writes.push(data);
  }
  moveBy(): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(): void {}
  setProgress(): void {}
}

describe("pasting an image into the editor", () => {
  const makeUi = async () => {
    const terminal = new FakeTerminal();
    const ui = new BruineUi(
      "test",
      { onSubmit: () => {}, onEscape: () => {}, onQuit: () => {} },
      terminal,
      UNICODE_ICONS,
    );
    await ui.start();
    return { ui, terminal };
  };
  const anImage = async (): Promise<ClipboardRead> => ({ kind: "image", image: pngImage() });
  const painted = (ui: BruineUi): string => ui.tui.render(80).map(strip).join("\n");

  test("a clipboard image becomes a chip plus pending bytes, never base64 in the buffer", async () => {
    const { ui } = await makeUi();
    expect(await ui.pasteClipboardImage(anImage)).toBe(true);
    expect(ui.editor.getText()).toBe("[Image 1]");
    expect(ui.pendingImages.size).toBe(1);
    expect(ui.pendingImages.get(1)?.data).toEqual(PNG);
    await ui.shutdown();
  });

  test("a second image gets its own chip and its own bytes", async () => {
    const { ui } = await makeUi();
    await ui.pasteClipboardImage(anImage);
    await ui.pasteClipboardImage(anImage);
    expect(ui.editor.getText()).toBe("[Image 1][Image 2]");
    expect(ui.pendingImages.size).toBe(2);
    await ui.shutdown();
  });

  test("the chip sits in the buffer, the words the user typed are untouched", async () => {
    const { ui } = await makeUi();
    ui.editor.setText("what is wrong here ");
    await ui.pasteClipboardImage(anImage);
    expect(ui.editor.getText()).toBe("what is wrong here [Image 1]");
    await ui.shutdown();
  });

  test("a missing clipboard tool explains what to install and attaches nothing", async () => {
    const { ui } = await makeUi();
    expect(await ui.pasteClipboardImage(async () => ({ kind: "no-tool", install: "sudo pacman -S wl-clipboard" }))).toBe(false);
    expect(ui.editor.getText()).toBe("");
    expect(ui.pendingImages.size).toBe(0);
    const text = painted(ui);
    expect(text).toContain("Cannot paste an image: sudo pacman -S wl-clipboard.");
    // The way out that needs no package at all.
    expect(text).toContain("Or drag the image in.");
    // A notice that wraps is a notice nobody reads.
    expect(text.split("\n").some((l) => l.includes("Cannot paste an image:") && l.includes("drag the image in."))).toBe(true);
    await ui.shutdown();
  });

  test("an oversized image is refused with both sizes in one line", async () => {
    const { ui } = await makeUi();
    const reason = `${formatBytes(MAX_IMAGE_BYTES + 1)} is over the ${formatBytes(MAX_IMAGE_BYTES)} limit`;
    expect(await ui.pasteClipboardImage(async () => ({ kind: "rejected", reason }))).toBe(false);
    expect(painted(ui)).toContain(rejectionNotice(reason));
    await ui.shutdown();
  });

  test("a clipboard with no image says so quietly and leaves the buffer alone", async () => {
    const { ui } = await makeUi();
    expect(await ui.pasteClipboardImage(async () => ({ kind: "none" }))).toBe(false);
    expect(ui.editor.getText()).toBe("");
    expect(painted(ui)).toContain("No image in the clipboard.");
    await ui.shutdown();
  });

  test("a dropped image path becomes the same chip", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bruine-t29-drop-"));
    const file = join(dir, "drop.png");
    writeFileSync(file, PNG);
    const { ui } = await makeUi();
    expect(await ui.pasteDroppedImage(file)).toBe(true);
    expect(ui.editor.getText()).toBe("[Image 1]");
    expect(ui.pendingImages.get(1)?.name).toBe("drop.png");
    await ui.shutdown();
  });

  test("ctrl+v reaches the clipboard read and never types into the buffer", async () => {
    const { ui, terminal } = await makeUi();
    const paste = vi.spyOn(ui, "pasteClipboardImage").mockResolvedValue(true);
    terminal.onInput?.("\x16");
    expect(paste).toHaveBeenCalledTimes(1);
    expect(ui.editor.getText()).toBe("");
    await ui.shutdown();
  });

  test("alt+v does the same, for Windows Terminal, which keeps ctrl+v for itself", async () => {
    const { ui, terminal } = await makeUi();
    const paste = vi.spyOn(ui, "pasteClipboardImage").mockResolvedValue(true);
    terminal.onInput?.("\x1bv");
    expect(paste).toHaveBeenCalledTimes(1);
    expect(ui.editor.getText()).toBe("");
    await ui.shutdown();
  });

  test("a dropped path arrives as one bracketed paste and becomes a chip", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bruine-t29-brack-"));
    const file = join(dir, "dropped.png");
    writeFileSync(file, PNG);
    const { ui, terminal } = await makeUi();
    terminal.onInput?.(`\x1b[200~${file}\x1b[201~`);
    await vi.waitFor(() => expect(ui.pendingImages.size).toBe(1));
    expect(ui.editor.getText()).toBe("[Image 1]");
    await ui.shutdown();
  });

  test("a bracketed paste of prose is left to the editor, never claimed as an image", async () => {
    const { ui, terminal } = await makeUi();
    const drop = vi.spyOn(ui, "pasteDroppedImage").mockResolvedValue(true);
    terminal.onInput?.("\x1b[200~look at this\x1b[201~");
    expect(drop).not.toHaveBeenCalled();
    expect(ui.pendingImages.size).toBe(0);
    await ui.shutdown();
  });
});
