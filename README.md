# kumo

An interactive terminal coding agent that runs **your** models.

Point kumo at a local llama.cpp server, OpenRouter, DeepSeek, or anything that speaks the
OpenAI-compatible `/v1` API. It edits files, runs commands, and asks before anything risky. It is a
profile plus a bundle of plugins on top of [DeepSeek Harness](https://github.com/deepseek-ai) (dsh),
not a fork, so harness updates arrive without a merge.

```
npm install -g kumo-code
kumo
```

The first launch opens the setup wizard: it scans for a local model server, asks for API keys if you
want a cloud route, lets you pick skills, and writes `~/.kumo/`. There is no account and nothing is
sent anywhere you did not point it at.

## What it does

| | |
|---|---|
| Live reasoning | The model's thinking streams in place, word by word, then collapses to `Thought for 4.2s` |
| Tool calls | Every call streams its arguments, then a grouped summary with a duration and a coloured rail |
| A real permission gate | Ask / Auto / Full access, decided by a rule table you can read, not a black box |
| Plan mode | `Shift+Tab` to plan before it builds; the plan is a message, the tools never change |
| `/model` and `/provider` | Switch model mid-session from the server's own live catalogue |
| Skills | Reuses the skills you already wrote for Claude Code, OpenCode, pi or `~/.agents/skills` |
| Images | `ctrl+v` pastes a screenshot straight to a vision model |
| Context and speed | A footer that shows context used, tok/s, prefill and cache hit rate |
| Works on | Windows Terminal, PowerShell, macOS Terminal, iTerm2, Konsole, GNOME Terminal |
| herdr | Works with herdr: shows up as `kumo` in `herdr agent list`. |

## Commands

```
kumo                Start kumo. Extra args are passed through to dsh.
kumo --continue     Resume the latest conversation in this project.
kumo -p "task"      Run a task without the terminal UI and print its answer.
kumo -p -           Read a task from stdin.
kumo setup          (Re)run the setup wizard, pre-filled with your current values.
kumo skills         List the skills kumo has enabled.
kumo update         Update kumo through its installer.
kumo --version      Print the version.
kumo --help         Print the help.
```

Use `--output-format json` or `--output-format stream-json` with `-p` for scripts. A headless
task denies any tool action that would need a permission prompt; use `--permission-mode full`
only when that task should run with full access.

Inside a session, `/` opens the command palette: `/new`, `/resume`, `/verify`, `/compact`, `/plan`, `/permissions`,
`/model`, `/provider`, `/effort`, `/skills`, `/reload`, `/help`, `/exit`. `f2` walks the routes you
used recently. `ctrl+t` shows the task list, `ctrl+o` expands tool output, `ctrl+e` cycles the
reasoning effort, `ctrl+v` pastes an image.

## Environment

| Variable | Effect |
|---|---|
| `KUMO_HOME` | Where kumo keeps its config (default `~/.kumo`) |
| `KUMO_ASCII=1` | Plain-ASCII glyphs instead of symbols |
| `KUMO_NO_ANIMATION=1` | No header or spinner animation |
| `KUMO_TOOL_SUMMARIES=0` | Disable readable tool descriptions (also `"toolSummaries": false` in `kumo.json`). Summaries reuse existing arguments and make no model calls. |
| `KUMO_BG=0` | Never paint a background, whatever the terminal reports |
| `KUMO_NO_UPDATE_CHECK=1` | Never contact the npm registry to check for a version |

## Three promises

**The numbers are measured, not quoted.** The tok/s in the footer is computed by kumo from its own
timestamps. The same measurement found the harness reporting 79 tok/s where the truth was 60, so
kumo does not copy it.

**The permission gate is the only one.** The harness sandbox is deliberately left fully open and
kumo's own rule table is what asks. One layer, readable, testable: a plain command is allowed, a
path outside the workspace is not, and a dangerous one is never guessed about.

**Your prompt cache survives.** The system prompt and the tool list stay byte-identical for the whole
session. A mode change is an appended message, never a prompt or tool swap. A test spawns the real
harness and asserts the request prefix never changes.

Telemetry is off unless you turn it on in the wizard. Network discovery is opt-in and only ever
touches private ranges (10/8, 172.16/12, 192.168/16, and Tailscale 100.64/10).

## Requirements

Node 22 or newer. Windows, macOS, or Linux.

## License

MIT. Everything that runs locally stays MIT.

## More

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) - the design, the product constraints, and the
  dsh APIs kumo depends on
- [`docs/tickets/`](./docs/tickets) - the work, one ticket at a time
- [`bench/`](./bench) - the benchmark: a system-prompt change only ships when a number says it helps
