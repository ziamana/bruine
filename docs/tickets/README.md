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
| T11 | Review fixes (key echo, --help, bundle link) | T10 |
