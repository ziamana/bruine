import { describe, expect, test } from "vitest";
import { ChangedFilesComponent, changedSince, parseNumstat, parsePorcelain, turnChanges, type GitStatus } from "../src/ui/changes.js";
import { strip } from "./fakes.js";
import { ToolCallComponent } from "../src/ui/tool-call-component.js";
import { BruineUi } from "../src/ui/bruine-ui.js";
import { UNICODE_ICONS } from "../src/render/chars.js";
import { visibleWidth, type Terminal } from "@earendil-works/pi-tui";
import type { ToolResult } from "../src/platform/tool.js";

/**
 * Recorded from a real repository, not written from imagination:
 *
 *   git init; commit tracked.txt renamed-old.txt
 *   edit tracked.txt; add untracked.txt; add staged.txt
 *   git mv renamed-old.txt renamed-new.txt; rm tracked.txt
 *   printf x > "a file with spaces.txt"
 *
 * The `-z` form is the one bruine reads, and it is the reason the last path has no
 * quotes around it: without `-z`, git writes `?? "a file with spaces.txt"`, and
 * a path with a quote or a backslash in it would arrive escaped.
 */
const PORCELAIN = [
  "R  renamed-new.txt",
  "renamed-old.txt",
  "A  staged.txt",
  "D  tracked.txt",
  "A  untracked.txt",
  "?? a file with spaces.txt",
  "",
].join("\0");

const NUL = "\0";

/** Porcelain text, the way git writes it with -z: every field NUL-terminated. */
const porcelain = (entries: readonly string[]): string => entries.map((e) => `${e}${NUL}`).join("");

/** A runner that answers one `git status` and fails if anything else is asked. */
function gitSaying(...outputs: Array<string | undefined>): (cmd: string, args: readonly string[]) => Promise<ToolResult> {
  let call = 0;
  return async (cmd, args) => {
    if (cmd !== "git" || (args[0] !== "status" && args[0] !== "diff")) throw new Error(`unexpected tool: ${cmd} ${args.join(" ")}`);
    // `--numstat` is a second question, not a second status: it answers `-\t-` for
    // a binary, which is a "cannot say" rather than a zero.
    const out = args[0] === "diff" ? NUMSTAT : outputs[Math.min(call, outputs.length - 1)];
    call += 1;
    return { code: out === undefined ? 128 : 0, stdout: Buffer.from(out ?? "", "utf8"), stderr: out === undefined ? "fatal: not a git repository" : "" };
  };
}

describe("reading the workspace (T59)", () => {
  test("porcelain is read into path and code, and a rename keeps the path that exists", () => {
    const status = parsePorcelain(PORCELAIN);
    expect(status.get("staged.txt")).toBe("A");
    expect(status.get("tracked.txt")).toBe("D");
    expect(status.get("untracked.txt")).toBe("A");
    // The destination is the file a user can open; the source is already gone.
    expect(status.get("renamed-new.txt")).toBe("R");
    expect(status.has("renamed-old.txt")).toBe(false);
  });

  test("a path with spaces is a path, not a quoted one", () => {
    expect(parsePorcelain(PORCELAIN).get("a file with spaces.txt")).toBe("??");
  });

  test("what a turn did is the difference between two readings", () => {
    const before = parsePorcelain([" M src/a.ts", "?? scratch.txt", ""].join(NUL));
    const after = parsePorcelain([" M src/a.ts", "M  src/b.ts", "?? scratch.txt", "?? src/c.ts", ""].join(NUL));
    expect(changedSince(before, after).map((c) => c.path)).toEqual(["src/b.ts", "src/c.ts"]);
  });

  test("a file the turn deleted is still something the turn did", () => {
    const before = parsePorcelain(["M  src/gone.ts", ""].join(NUL));
    const after = new Map<string, string>();
    expect(changedSince(before, after)).toEqual([{ path: "src/gone.ts", status: "gone" }]);
  });

  test("a path that did not move is not reported: a turn that touched nothing says nothing", () => {
    const same = parsePorcelain(PORCELAIN);
    expect(changedSince(same, parsePorcelain(PORCELAIN))).toEqual([]);
  });
});

const NUMSTAT = ["7\t2\tsrc/b.ts", "-\t-\tlogo.png"].join("\0") + "\0";
/** `strip` plus the OSC 8 wrapper: the link URI is invisible but has characters. */
/** What the row says, with `/` for the separator: Windows paths are drawn with `\\`, the claim is the same. */
const shown = (text: string): string => strip(text).replace(/\x1b]8;;[^\x1b]*\x1b\\/g, "").replaceAll("\\", "/");

describe("reading the counts (T59)", () => {
  test("numstat is read per path, and a binary is left uncounted", () => {
    const counts = parseNumstat(NUMSTAT);
    expect(counts.get("src/b.ts")).toEqual({ added: 7, removed: 2 });
    // `-\t-` is git saying "not a text file": counting it as zero would be a claim.
    expect(counts.has("logo.png")).toBe(false);
    expect(parseNumstat("")).toEqual(new Map());
  });

  test("a file git cannot count keeps its path and shows no number", () => {
    const files = changedSince(new Map(), parsePorcelain(" M src/b.ts\0"));
    expect(files[0]).toEqual({ path: "src/b.ts", status: "M" });
    expect(strip(new ChangedFilesComponent(files, "/w").render(100)[0] ?? "")).not.toMatch(/[+-]\d/);
  });
});

describe("attribution (T59)", () => {
  test("git answers, so the tools are not asked", async () => {
    // A file the user touched by hand is in both readings, so it is not the
    // turn's work, and a tool's declared path is not consulted at all.
    const changed = await turnChanges({
      before: parsePorcelain(porcelain([" M src/a.ts", "?? scratch.txt"])),
      declared: ["/somewhere/else/declared.ts"],
      cwd: "/tmp",
      run: gitSaying(porcelain([" M src/a.ts", "M  src/b.ts", "?? scratch.txt"])),
    });
    expect(changed.map((c) => c.path)).toEqual(["src/b.ts"]);
    // The size comes from git's own count, not from the tool that named the file.
    expect(changed[0]).toMatchObject({ added: 7, removed: 2 });
  });

  test("outside a repository the tools are the only source, and they are smaller", async () => {
    const changed = await turnChanges({
      before: undefined,
      declared: ["/w/src/written.ts", "/w/src/written.ts", ""],
      cwd: "/w",
      run: gitSaying(undefined),
    });
    expect(changed).toEqual([{ path: "/w/src/written.ts", status: "M" }]);
  });

  test("no measurement and nothing declared is no line", async () => {
    expect(await turnChanges({ before: undefined, declared: [], cwd: "/w", run: gitSaying(undefined) })).toEqual([]);
  });
});

class FakeTerminal implements Terminal {
  writes: string[] = [];
  onInput?: (data: string) => void;
  columns = 100;
  rows = 30;
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

describe("the line in the transcript (T59)", () => {
  test("the turn's files land in the chat, and an empty list lands nothing", async () => {
    const ui = new BruineUi("test", { onSubmit: () => {}, onEscape: () => {}, onQuit: () => {} }, new FakeTerminal(), UNICODE_ICONS);
    const painted = (): string => ui.tui.render(100).map(strip).join("\n");
    ui.showTurnChanges([]);
    expect(painted()).not.toContain("changed");
    ui.showTurnChanges([{ path: "src/ui/changes.ts", status: "A" }]);
    expect(painted()).toContain("changed");
    expect(painted()).toContain("src/ui/changes.ts");
    await ui.shutdown();
  });
});

describe("the paths a tool named (T59)", () => {
  const call = (tool: string, args: string): string | undefined => {
    const comp = new ToolCallComponent(tool);
    comp.args(args);
    return comp.touchedPath();
  };

  test("a write names the file it wrote", () => {
    expect(call("write", '{"file_path":"/w/src/a.ts","content":"x"}')).toBe("/w/src/a.ts");
    expect(call("edit", '{"file_path":"/w/src/b.ts"}')).toBe("/w/src/b.ts");
  });

  test("a read names a file too, and printing that as a change is a lie", () => {
    // The workspace can contradict it, so it is not reported at all.
    expect(call("read", '{"file_path":"/w/src/a.ts"}')).toBeUndefined();
    expect(call("bash", '{"command":"sed -i s/a/b/ src/a.ts"}')).toBeUndefined();
  });

  test("half-streamed arguments are not a path", () => {
    expect(call("write", '{"file_path":"/w/src/a')).toBeUndefined();
  });
});

describe("the line under the receipt (T59)", () => {
  const files = [
    { path: "src/a.ts", status: "M" },
    { path: "src/b.ts", status: "A" },
    { path: "src/c.ts", status: "M" },
    { path: "src/d.ts", status: "M" },
    { path: "src/e.ts", status: "M" },
  ];
  const line = (n: number, width = 100): string =>
    strip(new ChangedFilesComponent(files.slice(0, n), "/w").render(width)[0] ?? "");

  test("the paths come first, and the rest becomes a count", () => {
    const text = line(5);
    expect(text).toContain("changed");
    expect(text).toContain("src/a.ts");
    // Three are printed, so a count says what the line could not.
    expect(text).not.toContain("src/d.ts");
    expect(text).toContain("+2 more");
  });

  test("a line too narrow for its paths says how many instead of wrapping", () => {
    // A wrapped path list is a path list nobody reads.
    const text = line(3, 22);
    expect(text).toContain("3 files");
    expect(text.split(NUL).length).toBe(1);
  });

  test("each path carries its own size, and the sizes are the first thing to go", () => {
    const counted = [
      { path: "src/a.ts", status: "M", added: 12, removed: 3 },
      { path: "src/b.ts", status: "M", added: 4, removed: 0 },
    ];
    const at = (width: number): string =>
      strip(new ChangedFilesComponent(counted, process.cwd()).render(width)[0] ?? "");
    const wide = shown(at(100));
    expect(wide).toContain("src/a.ts +12 -3");
    // A count of zero on either side is not printed: `+4 -0` is noise.
    expect(wide).toContain("src/b.ts +4");
    expect(wide).not.toContain("-0");
    // Too narrow for the numbers, the paths stay: the sizes are what the turn did,
    // but the paths are what the user has to open.
    const narrow = shown(at(30));
    expect(narrow).toContain("src/a.ts");
    expect(narrow).not.toContain("+12");
  });

  test("a path too long for the row keeps its name, not its head", () => {
    const long = [{ path: `${process.cwd()}/src/ui/deeply/nested/folder/mouse.ts`, status: "M", added: 1, removed: 0 }];
    const row = new ChangedFilesComponent(long, process.cwd()).render(40)[0] ?? "";
    const text = shown(row);
    expect(text).toContain("\u2026");
    expect(text).toContain("mouse.ts");
    expect(visibleWidth(strip(row))).toBeLessThanOrEqual(40);
  });

  test("nothing changed, nothing is printed", () => {
    expect(new ChangedFilesComponent([], "/w").render(100)).toEqual([]);
  });
});
