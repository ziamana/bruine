# Changelog

Every version that reaches npm, newest first. bruine checks for a new one once a day and offers
`/update` in the session (or `bruine update` from a shell).

## 0.1.3

### Security

An audit of the permission gate, the file and web tools and MCP (see `docs/SECURITY-AUDIT.md`).

- **`read`, `glob`, `grep` and `read_image` ask for a path outside the project, or for a secret.**
  They used to read `~/.aws/credentials` or `/etc/passwd` without asking, in every mode. The skills
  you have installed stay readable.
- **"Always for this session" on `write` and `edit` stays inside the project.** A path outside it
  asks every time.
- **`web_fetch` asks for this machine, the local network and cloud metadata addresses** (`localhost`,
  `192.168.x.x`, `169.254.169.254`, `*.local`, IPv6 and numeric forms, URLs with a password).
- **A project's `.mcp.json` can no longer widen an approved server.** `alwaysAllow` and `readOnly`
  are part of what you approve, and the approval prompt shows them. Servers you approved before ask
  once more.
- More places count as secrets (`~/.aws`, `~/.kube`, `~/.gnupg`, `~/.docker/config.json`, `~/.netrc`,
  `~/.config/gh`, `bruine.json`), `ps` with an environment flag is no longer treated as read-only, a
  `$` in an API key is stored as typed, and `sharp` is updated past CVE-2026-96889.

## 0.1.2

### Skills

- **Every skill that ships with bruine starts on, except remotion.** `code-review`, `git-workflow`,
  `impeccable`, `make-interfaces-feel-better`, `playwright-cli`, `systematic-debugging`,
  `thermo-nuclear-code-quality-review`, `write-tests` and `youtube-transcript` are checked in the
  setup, and kept when you skip that step or take the simple route. A launch that never chose
  skills turns them on once. Uncheck one in `bruine setup` to turn it off; a saved choice is never
  touched.

## 0.1.1

### First launch

- **Setting up the first time no longer needs pnpm.** bruine used to call `dsh plugin add`, which
  stops with "pnpm not found on PATH" on a machine that has only node and npm. It now links the
  copies that came with the install, with no network and no pnpm; dsh's installer stays as the
  fallback.
- **The package is `@ziamana/bruine`.** npm refused the plain name as too close to another package.
  Install with `npm install -g @ziamana/bruine`; the command is still `bruine`, and `bruine update`
  and `/update` look under the new name.

### Websites

- When you ask for a complete or professional site, the agent plans every page first, builds all
  of them, then goes back over them for detail and polish, and invents a brand name instead of
  taking the folder's name.

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

- Space Bunny Free may write 128k tokens in one answer (it was cut at the 32k default, tool
  call included, on a large file at the highest level).

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
