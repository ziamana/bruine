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
