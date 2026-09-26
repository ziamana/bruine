# Tickets — how to run them

One ticket = one small job for the coding model (Qwen 3.8 Flash in ZCode, or Muse Spark in OpenCode).

## Prompt to paste (reasoning effort: LOW)
```
You are implementing one ticket of the kumo project.
1. Read docs/ARCHITECTURE.md and docs/tickets/<TICKET>.md.
2. Only create or modify the files listed under "Files". Touch nothing else.
3. Run `pnpm test` (and `pnpm build` if the ticket says so). Everything must pass.
4. If something in the ticket is unclear or impossible, STOP and say so. Do not guess.
5. End with: the list of files changed and the test output.
```

## After each ticket
1. `git add -A && git commit -m "<TICKET>: <title>"`
2. Tell BOS "<TICKET> done" → BOS reviews the diff before the next ticket.

## Order
| # | Title | Depends on |
|---|---|---|
| T01 | Repo scaffold | – |
| T02 | `kumo` launcher | T01 |
| T03 | Profile generator | T01 |
| T04 | Reasoning line renderer | T01 |
| T05 | Tool call renderer | T04 (uses its Screen type) |
| T06 | Text renderer | T04 (uses its Screen type) |
| T07 | REPL plugin | T02 T03 |
| T08 | Render plugin (wiring) | T04 T05 T06 T07 |
| T09 | Approval plugin | T07 |
| T10 | Simple setup | T03 |
| T11 | Review fixes (key echo, --help, bundle link, server address) | T10 |
| **T12** | **HOTFIX reasoning lines stacking** | T04 |
| T13a-d | UI rebuilt on pi-tui (pi look, Escape, markdown, footer) | T12 |
| T14 | Public groundwork: CI 3 OS, pinned dsh, telemetry off, paths, ASCII | T12 |
| T15 | Identity (kumo + model), short tone, tools (web fetch, ask user, subagents), web search options | T13 |
| T16 | Modes: Plan/Build (Tab) × Ask/Auto/Full access (Shift+Tab), sandbox off, SAME tools in both modes | T15 |
| T17 | Cache Hunter test: system+tools byte-identical, messages append-only | T16 |
| **T18** | **HOTFIX: gate bypasses (12/13) + lockfile leak** | T17 |
| T19 | Judge really works on local models + 6 remaining gate holes | T18 |
| T20 | Rename package to kumo-code (command stays kumo) | T19 |
| T21 | Full setup v0.2 (LAN discovery, roles, keys, mode, skills, theme, telemetry) | T20 + Aron's UI test |
| T22 | E2E tests in a real terminal (pty + headless xterm), 7 scenarios | parallel, worktree |
| T23 | UI polish: no emoji + animated spinner, sentence-by-sentence reasoning, spacing, tool args, mode label | T22 |
| T24 | Finishing: no em-dash in UI/skills, mode notes not as user msgs, no spinner when piped, e2e screens out of git | T23 |
| T25 | Honest TPS per LLM call, footer without duplicate auto, reasoning word by word inside sentences | T24 |
| T26 | Reuse skills from Claude Code / OpenCode / pi / ~/.agents (linked, not copied), shown in setup | T21 |
| T27 | Signature UI: cache meter, tool rail + grouping, turn summary, animated header, paste chip | T25 |
| T28 | BUG ask_user_question has no answerer + real question UI; ghost-text next-prompt suggestion | T25 |
| T30 | Update check at startup + `kumo update` (must be in the first release) | T26 |
| T31 | `/` command palette (pi-tui autocomplete) + `/new` + `/help` (first release) | T27 |
| T32 | Task list panel for the AI's todo_write (tool already loaded, no UI) | T31 |
| T33 | Lean toolset (9.2k → ≤5.5k base tokens), clear errors, quiet first run, visible compaction | T32 |
| T34 | Effort really sent (chat_template_kwargs), /effort + ctrl+e, preserve_thinking for the cache | T31 + T30 |
| T35 | `kumo setup` on an existing install: prefill from settings.yaml, change-one-thing menu, Skip everywhere | T33b |
| T36 | kumo-bench: ~20 tasks, variants of the system prompt, verdict on Qwen 3.8 27B | T33b |
| T29 | Paste an image (clipboard ctrl+v, vision gate, dsh attachment store) | done 2026-09-26 |
| T40 | Console band: painted bottom zone on the terminal's real background (OSC 11), no background at 16 colors | T27 |
| T37 | `/model`: switch provider + model in the session, from dsh's own `llm` catalog | T34 |
| T38 | f2 walks the recent routes; the reasoning effort follows the model | T37 |
| T39 | `/provider`: every provider, its endpoint, key and models (read-only) | T37 |
