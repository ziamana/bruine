# Security audit, 2026-10-06

A review of the permission gate, the file and web tools, MCP and skill loading, secrets handling, the
update path and the published package, followed by fixes pinned by tests (`test/gate-audit.test.ts`,
`test/mcp.test.ts`). It was done by reading the code and by running the gate against attack shapes; it
is not a penetration test, and it did not cover dsh (the agent runtime bruine is built on) itself.

The threat it assumes: the model is steered by text it reads (a file in the repository, a web page, an
MCP result) and asks for something the user did not mean. The gate is what must hold.

## Found and fixed (in the next release after 0.1.2)

| # | Severity | What | Fix |
|---|---|---|---|
| 1 | High | `read`, `read_image`, `glob` and `grep` were allowed without asking in every mode, whatever the path. `read ~/.aws/credentials`, `/etc/passwd` or `grep` over `~/.ssh` went straight into the model's context (and so to a cloud provider). Only `.env`, `.ssh`, keys and shell rc files were guarded, and only for `read`. The `bash` tool already asked for these; the file tools did not. | The four tools ask for a path outside the project, or a secret. Installed skills stay readable (a skill reads its own files). "Always" on `read` does not open the rest. |
| 2 | Medium | "Always for this session" on `write` or `edit` was keyed on the tool name, so after one yes in the project, writes anywhere (`~/.local/bin`, `~/.config/autostart`, `/etc`) went through unasked. | A path outside the project asks every time, whatever the session rules say. |
| 3 | Medium | `web_fetch` reached `localhost`, the LAN and the cloud metadata address (`169.254.169.254`) without asking. | It asks for loopback, private, link-local and CGNAT ranges, IPv6 equivalents (including IPv4-mapped), intranet names (`nas`, `*.local`, `*.internal`, `*.lan`), numeric forms (`2130706433`, `0x7f.1`) and URLs with a password. |
| 4 | Medium | A project's `.mcp.json` is approved once, by a fingerprint of its command, arguments, env and address. `alwaysAllow` (tools that run unasked) and `readOnly` (usable in Plan mode, never asks) were left out, so a repository could widen an approved server later, with a `git pull`, and have its tools run without a prompt. | Both are in the fingerprint (a change asks again) and in the approval prompt. Existing approvals ask once more. |
| 5 | Low | `ps eww`, `ps auxe` counted as read-only, and print every process's environment, API keys included. | `ps` with an environment flag is no longer read-only. |
| 6 | Low | `writeEnvVar` used the value as a regular-expression replacement, so a key containing `$&` or `$1` was stored altered. | Literal replacement; the variable name is escaped. |
| 7 | High (advisory) | `sharp` < 0.35.5 (librsvg, CVE-2026-96889), a dsh dependency used when images are read. | Lockfile updated to 0.35.5. dsh asks for `^0.35.3`, so a fresh install gets the fixed version. |
| 8 | Low | More secret locations were not recognised: `~/.aws`, `~/.kube`, `~/.gnupg`, `~/.azure`, `~/.docker/config.json`, `~/.netrc`, `~/.git-credentials`, `~/.config/gh`, `~/.config/gcloud`, and bruine's own `bruine.json` (MCP tokens can live there). | Added to the sensitive list; they ask in every tool. |

## Checked and fine

- No secret in the git history (common key, token and private-key formats: nothing matched); commits carry the GitHub noreply address.
- The npm package holds `dist`, `skills`, `THIRD_PARTY_NOTICES.md` and `cordis.patch.yml`, nothing else.
- API keys go to `.env` in bruine's home with mode 0600, written atomically; `.env` asks to read.
- Telemetry is off unless the user turns it on.
- Without a terminal to ask on (headless), a request that would ask is denied, not allowed.
- Sub-agents are governed by the same gate as the main agent.
- The self-update fetches a version number over HTTPS and runs a fixed `npm install -g @ziamana/bruine@latest`; nothing from the response is executed.
- Skill names are validated (`^[A-Za-z0-9][A-Za-z0-9._-]*$`) before they become a path; copies keep symlinks as symlinks.
- Project MCP servers do not start before the user has seen the command and said yes; the user's own entry wins over a project's of the same name.
- Shell commands: pipes, chaining, redirects and substitution make a command "not simple"; `rm -r`, `sudo`, `git push`, `curl | sh`, installs, `chmod` and the like always ask, and "Always" never covers them.

## Open, and what is left to decide

1. **`web_fetch` and `web_search` to a public address do not ask.** A model steered by injected text can put data in the URL (`https://attacker.example/?k=…`). This is how most agents ship; the stricter choice is to ask per domain once. Not changed, because it changes how every session feels.
2. **The default mode is Auto**, where a second model call decides what is not plainly read-only. That judge reads the same kind of text the main model does, so it can be argued with; it fails to Ask on a timeout or an odd answer. Ask is the stricter default.
3. **Text from the repository is trusted as instructions**: `AGENTS.md`, and the skills in a project's `.agents/skills` (whose descriptions reach the system prompt). MCP has an approval step; project skills do not.
4. **A hostname that resolves to a private address** (DNS rebinding, `evil.example` → `127.0.0.1`) is not caught by the URL check, which sees the name only.
5. **The gate on Windows** (PowerShell rules, Windows paths) is pinned by unit tests on Linux and macOS and run on Windows by CI, but has not been used by hand there.
6. **Not examined**: dsh's own tools and runtime, the bundled skills' scripts, and whether the provider keys in bruine's environment reach the processes the `bash` tool starts.
