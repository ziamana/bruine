# Changelog

Every version that reaches npm, newest first. bruine checks for a new one once a day and offers
`/update` in the session (or `bruine update` from a shell).

## 0.1.0

### When the model goes quiet

- **An adaptive silence budget.** How long a model may stay silent before bruine gives the request
  up and retries now depends on what it was doing: waiting for its first token, preparing after
  its reasoning, mid-answer, or writing a tool call, where it grows with the size of the file
  being written. It is longer at a higher effort, doubles on every retry, and never cuts short a
  silence the session has already seen end well. The route's `streamIdleTimeoutMs` stays the
  ceiling; routes bruine writes get 15 minutes for the budget to grow under.
- **Retries you can see.** "↻ The model has not answered for 3m. Retry 2/5 in 1.2s." in the
  transcript, `retry 2/5` beside the working label, and after 20 s of silence "no answer for 45s,
  retrying at 3m". It used to be a clock that kept counting.

### Updates

- The update notice appears as soon as the launch's check answers, on the first launch too.
- `/update` installs the latest version from inside a session, after a yes.

### Approvals and safety

- **Security:** an "Always" on one bash command allowed every later bash command for the session
  (the gate read dsh's parsed arguments as a string, so every command looked empty). Fixed, with
  a test; read-only commands are recognised again.
- The approval is a framed amber band with `y` / `a` / `n`; "Always" says what it covers; the
  prompt box reads "Waiting for you" with the turn's clock paused, and the rain stops.

### Look and feel

- Readable on light terminals: the text colours follow the terminal's background.
- 256-colour terminals (macOS Terminal) get gray surfaces instead of navy and black.
- One name per reading on the status bar (`cache 96%`, `40 tok/s`, `effort auto`), `localhost:8080`
  in the header, bruine's own plugins counted rather than listed (`/plugins` lists them).

## 0.0.1

The first version: the agent, the rain, the permission gate, MCP, queued prompts.
