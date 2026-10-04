# bruine-bench (T36)

Measures **agent quality** on twenty tiny task repos, so a system-prompt change
is only made when a number says it helps. bruine already sends DeepSeek Harness's
prompt word for word (only the identity line differs), so this bench exists to
answer one question per variant: *does it pass more tasks, for less time and
fewer tokens?*

- **Ornith 9B is for fast iteration only.** The verdict comes from
  Qwen 3.8 27B (and Tiel-Coder 35B when possible). A variant that helps the 9B
  but not the 27B is rejected.
- The variants here are **runnable, not judged**. Nobody should read a pass
  rate as a conclusion; the numbers exist to compare variants on the same
  server preset.

## Run it

```sh
pnpm bench -- --route local/ornith-9b --variant dsh --tasks read-default-port,bug-range-end --repeat 1
```

The full acceptance run (all tasks, three repeats, the whole variant list):

```sh
pnpm bench -- --route local/ornith-9b --variant dsh --repeat 3
pnpm bench -- --route local/ornith-9b --variant verify --repeat 3
pnpm bench -- --route local/ornith-9b --variant plan   --repeat 3
pnpm bench -- --route local/ornith-9b --variant style  --repeat 3
pnpm bench -- --route local/ornith-9b --variant all    --repeat 3
```

then the same five with `--route local/qwen3.8-27b` for the verdict.

A killed run continues where it stopped:

```sh
pnpm bench -- --route local/qwen3.8-27b --variant verify --repeat 3 --resume
```

`--help` lists every option. The bench needs a POSIX shell, Node ≥ 22.6 (to run
its own TypeScript) and `python3`; a task whose check cannot run on the machine
is reported as **not checkable**, never as a failure.

## What one run does

1. `bench/tasks/<id>/` is copied to a scratch directory and `git init`-ed (a
   baseline commit, so the agent can diff and the traps can be pinned).
2. A disposable `BRUINE_HOME` is written: the route read out of your
   `settings.yaml`, `permissionMode: full` (the copy is disposable), no search,
   an empty `HOME` (no user skills, no user settings), the dsh and bruine bundles
   **symlinked from this checkout** — no npm install, no network — and the
   variant's persona in the profile patch.
3. `bruine` is launched headless (piped, no TTY) with `task.md` as its first
   prompt, under a wall-clock limit (default 10 minutes).
4. `check.sh` runs in the copy: exit 0 = pass. It may also print
   `bruine-bench-check-mode: node-test` (or `unittest`, `go-test`, `file-report`,
   `expected-answer`), which is recorded so two checks are never compared
   silently.
5. One JSONL row is appended. Every row is flushed as it is written, so
   `--resume` only redoes the run that was in flight.

## Output

`bench/results/<date>-<route>-<variant>.jsonl`, one header row and one row per
run:

```json
{"kind":"header","route":"local/ornith-9b","variant":"verify","persona":{…},
 "props":{"n_ctx":32768,"templateHash":"a5df9b45da27f850","ok":true},
 "sampler":{"temperature":null,"seed":null,"fixed":false,"note":"dsh 0.1.5-rc.3 sends none"}}
{"kind":"run","task":"bug-range-end","repeat":1,"status":"pass","pass":true,
 "wallSec":41.2,"outputTokens":812,"toolCalls":7,"errors":[],"checkMode":"node-test"}
```

The header records the **server preset** (`/props`: model, `n_ctx`, chat
template hash). Appending to a file whose header describes a different preset is
refused: two presets in one file is how a benchmark lies. `temperature`/`seed`
are recorded as `null` with a note, because dsh 0.1.5-rc.3 has no knob for
them — that is also why `--repeat` defaults to 3.

The summary is printed after the run, one row per variant in the results
directory:

```
variant  route             pass rate  spread  median time  median tokens  runs  broken
-------  ---------------  ---------  ------  -----------  -------------  ----  ------
dsh      local/ornith-9b  45%        ±20pp   38s          1.2k           24/60 -
verify   local/ornith-9b  55%        ±10pp   41s          1.4k           33/60 -
```

- **pass rate** — passes / runs.
- **spread** — 1 when at least one task disagreed between its repeats (the
  noise floor a variant must beat), else 0.
- **median time / median tokens** — over all the runs of that variant.

## Variants

`bench/variants/<name>.yml` is a *delta* on today's persona, applied through the
persona section (the profile patch), never by editing dsh:

| variant | adds |
|---|---|
| `dsh` | nothing — byte-for-byte what a plain `bruine` session sends |
| `verify` | "Before saying a task is done, run the project's tests or the closest check, and report the result." |
| `plan` | "For work with 3+ steps, keep a todo_write list and update it as you go." |
| `style` | "Match the existing code style and structure; change only what the task needs." |
| `reread` | "Read a file again right before you edit it, and after any shell command that may have changed it. If an edit is refused, read the file again and copy the exact text; do not guess." |
| `all` | the three together |

Every run also records how many `edit` calls the tool refused (`edit fails` in the summary, `3/41` =
3 refused out of 41). In real sessions it was 42 of 332.

## The tasks

Twenty tiny repos, all original, named so the id says what is measured:

| kind | n | what it measures |
|---|---|---|
| `bug-*` | 6 | a red suite that must go green (TypeScript, Python, one Go) |
| `feat-*` | 4 | new behaviour across two files, with tests |
| `refactor-*` | 3 | same behaviour, different shape (tests stay green) |
| `read-*` | 3 | read the project and answer; checked against `expected.txt` |
| `shell-*` | 2 | find and rename files, report what you did |
| `trap-*` | 2 | a task that must **not** delete or overwrite a pinned file |

A task that passes with no work measures nothing, so the set is self-checked:

```sh
bench/tools/verify-tasks.sh
```

It proves every pristine copy fails its check and that every task turns green
after its scripted reference fix (`bench/tools/reference-fixes.sh`, a bench
self-check aid — nothing in it runs during a measurement).

## Layout

```
bench/
  run.ts              the CLI: options, the loop, the summary
  lib/options.ts      argument parsing (pure)
  lib/tasks.ts        task discovery and the run plan (pure)
  lib/route.ts        the route under test, and the server's /props
  lib/variant.ts      variant files and persona composition
  lib/home.ts         the bench home: settings, bruine.json, profile, bundles
  lib/exec.ts         run bruine (wall clock, signals), run check.sh
  lib/session.ts      tokens, tool calls and errors from dsh's session log
  lib/results.ts      the JSONL: header guard, rows, resume
  lib/summary.ts      pass rate, spread, medians, the table
  tasks/              the twenty task repos
  tools/              test helpers, the fake bruine, the task self-check
  variants/           dsh, verify, plan, style, all
  results/            run output (git-ignored: it is data, not source)
```

`pnpm test` covers the runner with `bench/tools/fake-bruine.mjs`, a fake bruine that
writes the session log dsh would have written — no model server, no network.
