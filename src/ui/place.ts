import type { Component } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import { clipStart } from "../render/reasoning.js";
import { kumoIcons, type KumoIcons } from "../render/chars.js";
import { ansi } from "./theme.js";

/** The path flavour the string is written in, not the one this process runs on. */
function flavourOf(path: string): typeof posix {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\") ? win32 : posix;
}

/**
 * The place, said the way a person says it (UI polish 2026-09-27).
 *
 * The defect: kumo never said where it was, so the only answer was the shell's own
 * `pwd` in another window. A coding agent's whole world is one directory, and the
 * home directory is the one a person names by its last part: `Bureau` is "le
 * Bureau", `/home/tu44/Bureau` is a path to be decoded. So home collapses to `~`,
 * separators become `/` on every platform, and a directory outside the home keeps
 * its full path because shortening it would name somewhere else.
 */
export function displayPlace(cwd: string, home: string = homedir()): string {
  const path = cwd === "" ? home : cwd;
  if (home === "" || path === home) return "~";
  const impl = flavourOf(path);
  // One flavour for both, or `relative` is comparing a Windows path to a POSIX one
  // and answers about a directory neither of them is in.
  if (impl !== flavourOf(home) || !impl.isAbsolute(path) || !impl.isAbsolute(home)) return path;
  const rel = impl.relative(home, path);
  // A sibling of the home directory is `../projets/kumo`, not `~projets/kumo`:
  // `relative` already said so, and the label keeps that answer.
  if (rel === "" || rel.startsWith("..")) return path.split(/[\\/]/).join("/");
  return `~/${rel.split(/[\\/]/).join("/")}`;
}

/**
 * One faint row under the input: where the tools run, where the paths resolve.
 *
 * Faint because it is context and not an answer, and clipped from the left
 * because a path that does not fit is still worth showing its tail.
 */
export class PlaceRow implements Component {
  constructor(
    private place: string = displayPlace(process.cwd()),
    private icons: KumoIcons = kumoIcons(),
  ) {}
  render(width: number): string[] {
    if (width <= 2) return [""];
    const room = width - 2;
    return [`${this.icons.folder} ${ansi.faint(clipStart(this.place, room, this.icons.think === "*" ? "..." : "…"))}`];
  }
  invalidate(): void {}
}
