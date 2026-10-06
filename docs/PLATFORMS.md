# Windows and macOS: audit

> **Status.** Everything below was found by reading the code and pinned by unit tests; none of it has
> been run by hand on a real Windows or macOS machine. Linux is the platform used every day.

An audit of paths, keys, colours, glyphs, clipboard and shells for Windows Terminal, the classic
Windows console, PowerShell, macOS Terminal and iTerm2, against the product constraints in
[ARCHITECTURE.md](ARCHITECTURE.md). It was done by reading the code, with every fix pinned by a
unit test that runs on Linux with the other platform's inputs (`path.win32`, a `win32` platform,
a Windows release string). The CI matrix (ubuntu, windows, macos × Node 22 and 24) runs those
tests for real on each system.

## Known open: three terminal tests on Windows

These e2e tests are skipped on Windows because they fail on the CI runner's terminal (ConPTY) and the
cause is not found: `fresh setup offers Set up later and exits…` (the exit code never arrives), `the logo
comes in with an effect…` (no animation frames are seen) and `a light terminal gets dark ink…` (the ink
stays the dark-theme one, so the terminal's background is probably not learnt there). Whether the product
itself is wrong on Windows Terminal is not known. Every other test, unit and e2e, passes on Windows.

## What broke, and what was done

| Area | What broke | Fix |
|---|---|---|
| Permission gate (Windows) | On Windows dsh mounts `pwsh` instead of `bash`, and the gate only analysed `bash`. **Plan mode let PowerShell commands through** (Ask asked, Auto let the judge decide, so a modifying command could run in Plan), and **"Always for this session" on one PowerShell command allowed every PowerShell command** (the rule key was the tool name, not the command). | `pwsh` is a shell tool like `bash`: Plan refuses anything but one simple read-only cmdlet, the rule key is the command, and PowerShell has its own always-ask list (`Remove-Item -Recurse/-Force`, `iex`, `iwr \| iex`, `Set-ExecutionPolicy`, `Stop-Process`, registry writes, `schtasks`, `icacls`, `winget/choco install`...) on top of the bash patterns that read the same there (`git push`, `npm install`). Reads of `$env:*_KEY`, `Get-ChildItem env:`, `C:\…` and `\\host\…` paths outside the project ask. |
| Copy (Windows) | `clip.exe` reads stdin in the console code page: `é`, `›`, `✓` came out of a mouse-selection copy as two or three wrong characters. | `clip` gets UTF-16LE with a byte order mark, which it reads as Unicode. |
| Image paste (Windows Terminal) | Windows Terminal keeps `ctrl+v` for its own text paste; with only an image on the clipboard it sends nothing, so `ctrl+v` never reached bruine and an image could not be pasted. | `alt+v` pastes an image too, everywhere. Documented in `/help` and the README. |
| `!cmd` (Windows) | Ran in `cmd.exe`, while the agent's own commands run in PowerShell: `!ls`, `!cat` failed, and the same line meant two things. | PowerShell (`pwsh`, else Windows PowerShell, else `cmd.exe`), `-NoProfile -NonInteractive`, with the execution policy bypassed for that one process (the user typed it, and `npm` on PATH is an `npm.ps1` a default Restricted policy refuses). The same order dsh uses for its tool. |
| `/config` (Windows) | Notepad opens the first file and silently ignores the rest, so `bruine.json` never opened. | Notepad, like `xdg-open`, gets one file per call. |
| Colours (classic Windows console) | Without `WT_SESSION` or `TERM`, the console was treated as 16 colours, though conhost renders 24-bit colour since Windows 10 build 14931. | Windows 10 14931+ is truecolor, 10586+ is 256, older stays 16. A `TERM` set by Git Bash or MSYS is read as it is. |
| Glyphs (macOS) | A shell that never exported `LANG` (iTerm2 with "Set locale variables automatically" off, some login shells) fell back to ASCII, though every macOS terminal is UTF-8. | macOS with no locale at all is UTF-8; only an explicit non-UTF-8 locale (`LANG=C`) is ASCII. |
| Glyphs (Windows) | VS Code's terminal on Windows (no `WT_SESSION`) got ASCII. | `TERM_PROGRAM` of a terminal that always renders UTF-8 (vscode, WezTerm, ghostty, iTerm2, Terminal, Hyper, Tabby) means Unicode. The classic console keeps ASCII: its fonts have no braille cells for the rain spinner. |
| Links | A tool summary with a Windows path was matched on its basename by splitting on `/` only, so a relative summary of a backslash path lost its link. | Split on either separator. |
| Tests | The update-notice test waited a fixed 20 ms for an async read, and failed on a busy machine. | It waits for the notice (up to 500 ms). |

## Checked, and fine as it is

- **Paths**: `node:path` and `os.homedir()` everywhere; a source audit test forbids `/home/` and `~/` in
  `src/`. `isPathInside` compares Windows paths case-insensitively and resolves symlinks.
- **Home**: `BRUINE_HOME`, else `~/.bruine` through `os.homedir()`; the setup writes secrets with mode
  0600 (a no-op on Windows, where the file inherits the user profile's ACL).
- **Clipboard read**: `osascript`/`pngpaste` on macOS, Windows PowerShell's `Get-Clipboard -Format Image`
  (5.1, where the image format still exists) on Windows, Wayland before X11 on Linux.
- **Keys**: Escape, Shift+Tab (`\x1b[Z`), ctrl+e, f2, the arrows and the kitty protocol are matched by
  name, not by byte, so every encoding Windows Terminal, Terminal and iTerm2 send is read.
- **Spawning**: user and tool commands go through `execFile`/`spawn` with explicit arguments; `/verify`
  goes through the same shell as `!cmd`. Executables are found with `PATHEXT` on Windows.
- **Truecolor**: `COLORTERM`, `WT_SESSION`, VS Code; macOS Terminal reports `xterm-256color` and gets
  256 colours (it has no 24-bit colour before macOS 26).

## Known limits (not fixed here)

- **macOS Terminal: PageUp and PageDown** scroll Terminal's own buffer by default; `shift+PageUp` and
  `shift+PageDown` reach bruine. Said in `/help`. iTerm2 sends them through.
- **macOS: `alt+v`** needs "Use Option as Meta key" in Terminal (iTerm2: "Esc+"); `ctrl+v` works there
  without it.
- **Classic Windows console**: no braille, so the rain spinner and the weather are ASCII; Windows
  Terminal (the default on Windows 11) has neither limit.
- **Windows PowerShell 5.1 only**: dsh's tool and `!cmd` both fall back to it; PowerShell 7 is better
  (UTF-8 output by default).
- Nothing here was run on a physical Windows or Mac in this pass: the CI matrix is the check, and the
  e2e suite runs in ConPTY on the Windows runners.
