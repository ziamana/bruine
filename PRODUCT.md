# Product

<!-- impeccable:product-schema 1 -->

## Platform

web (the product itself is a terminal app; this record covers its web surfaces: the README and the site)

## Stack

The site is a Next.js app in `site/`, static export, bilingual (English by default, French). Chosen by the user.

## Users

Developers who code in a terminal, in two groups the site must speak to equally:

- people who run a model on their own hardware (llama.cpp, Qwen, a single GPU) and want an agent that treats it as first class;
- people already using Claude Code, Codex or OpenCode who want an open alternative that runs any model, local or cloud.

They arrive from a link (GitHub, a forum, a friend), decide in under a minute whether it is worth an `npm install`, and will read further only if the first screen shows the real thing.

## Product Purpose

bruine is a coding agent for the terminal that runs your own models. It reads and edits code, runs commands, and asks before anything risky. No account; nothing is sent anywhere the user did not point it at. Success for the site: the visitor installs it, or stars it to come back.

## Positioning

- Built for local models: the prompt cache is kept warm (system prompt and tool list never change in a session), side requests stay off a single-slot server, tok/s is measured by bruine's own clock.
- One permission gate you can read: a rule table in plain TypeScript with tests, Ask / Auto / Full, Plan mode.
- Calm, visible behaviour: reasoning folds into one line, edits are diffs, a quiet model is retried out loud ("Retry 2/5"), images the model reads are drawn in the terminal.
- It rains in the terminal, as hard as the model is asked to think. The weather is the product's signature.
- A profile and plugins on top of DeepSeek Harness (dsh), not a fork.

## Operating Context

Terminal (Windows Terminal, PowerShell, macOS Terminal, iTerm2, Konsole, GNOME Terminal), Node 22+, `npm install -g @ziamana/bruine`, then `bruine`. A setup wizard finds a local server or asks for API keys. Config in `~/.bruine/`.

## Capabilities and Constraints

- Version 0.1.3, MIT. Young: no checkpoints or rewind, no IDE integration, MCP tools only (no resources or prompts), no LSP.
- Any OpenAI-compatible `/v1` server, llama.cpp, about thirty cloud providers.
- Published on npm as `@ziamana/bruine` since 0.1.0 (4 October 2026; npm refused the plain name); the repository `ziamana/bruine` is public, with a GitHub release per version. Releases are published by the release workflow (trusted publishing). Site links must still not promise what is not live: the website is not deployed yet.
- A security audit of the gate, the file and web tools and MCP is published in `docs/SECURITY-AUDIT.md`; its open items (Auto as the default mode, `web_fetch` to public addresses, project skills loaded without approval) are product decisions still to make.

## Brand Commitments

- Name: bruine, always lowercase. French, /bʁɥin/, "a fine, steady rain".
- Established world (TUI, wordmark, film): night ground `#0b0d14`, pastel sky `#7dcfff`, lavender `#b4a7ff`, pink `#ff9ed2`, mint `#8fe3a3`, amber for approvals; rain and rings; Inter and JetBrains Mono.
- Voice: plain, exact, a little dry, no hype words; says what it does not do.
- References the user named for the site: deepseekharness.io (dsh) and pi.dev (pi).

## Evidence on Hand

- `docs/media/bruine-film.mp4` (42 s film), `hero.webp`, `effort.webp`, wordmarks (dark, light).
- Real screenshots recorded from the running app: `docs/media/approval.png`, `retry.png`, `image.png`, `light.png`, `thinking.png`, `done.png`; `docs/demo/bruine.svg` (animated session) and `bruine.cast`.
- The honest comparison table and FAQ in README.md.
- No testimonials, users, download counts or benchmarks to show: never invent them.

## Product Principles

- Show the real thing; every screen on the site comes from the running app.
- Say what it does not do as plainly as what it does.
- Your model, your machine, your keys.
- Calm over loud.
