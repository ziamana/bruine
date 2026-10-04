# bruine — Architecture

`bruine` is an interactive terminal agent built on top of **DeepSeek Harness (dsh)**.
It is NOT a fork: it is a dsh **profile** plus a **bundle of plugins**, so dsh updates flow in for free.

All user-facing text is **English**. (A French locale may come later; never hardcode French.)

## 0. Product constraints (read first)
bruine is a **public product** for **Windows, macOS and Linux**, not a personal tool.

| Rule | Consequence for every ticket |
|---|---|
| Cross-platform | `node:path` / `os.homedir()` only, never `/home/...` or `~` strings. No bash-only scripts in the product. Test paths with backslashes. |
| UI library | **`@earendil-works/pi-tui`** (MIT, pure TS, no native deps, synchronized output, used by pi on all 3 OS). Ink rejected (flicker history in Gemini CLI / Qwen Code), OpenTUI rejected (native Zig; on Node only experimental, Windows tested with Bun only). |
| dsh is a developer preview | **Pin an exact dsh version** in `package.json`. Upgrades are a deliberate ticket, never automatic. |
| Privacy | dsh telemetry is ON by default: bruine sets `DSH_TELEMETRY_DISABLED=1` unless the user opts in during setup. Network discovery is **opt-in**, private ranges only (10/8, 172.16/12, 192.168/16, 100.64/10 Tailscale). |
| Secrets | OS keyring (`@napi-rs/keyring`: Windows Credential Manager, macOS Keychain, Linux Secret Service). Fallback file chmod 600 (Linux/macOS) with a warning. Never echo a key. |
| Terminals | Must work in Windows Terminal, PowerShell, macOS Terminal, iTerm2, Konsole, GNOME Terminal. Provide an ASCII fallback (`*` for `💭`, `>` for `›`) when `BRUINE_ASCII=1` or the terminal is not UTF-8. |
| CI | GitHub Actions matrix: ubuntu, windows, macos × Node 22 and 24. A ticket is done only when CI is green on all 3. |
| **Prompt cache (critical for local models)** | The request prefix must stay byte-identical across a session. **Never** change the system prompt or the tools array mid-session (modes, skills, MCP, settings). New information (new skill, AGENTS.md change, mode switch) is **appended as a message at the end**. Compaction keeps the same system prompt and tools. No timestamps / token counts / mode badges in the prompt. Source: youtu.be/AkwItxJ9AbA (Cache Hunter test, 2026-09): dsh itself keeps the cache perfectly; Pi lost it by swapping tools on plan→build. |
| **Thinking effort (T34)** | `chat_template_kwargs.preserve_thinking: true` is bruine's default when the local template supports it: it keeps the prefix stable across turns (a template that strips old thinking would rewrite it; the cost is more context, and compaction handles it). Switching effort (`/effort`, ctrl+e) changes ONLY request parameters, never the system prompt or the tools; it applies to the next message. |
| **Route switch (T37)** | `/model` replaces `.current` on dsh's selection ref — the same seam as the effort — so bruine itself rewrites nothing: the persona is composed at boot (T36) and still names the first model. dsh appends its own durable `[model changed: …]` notice at the end of the history, which is the cache-safe mechanism. What does change is the wire role label (`developer` vs `system`), because that is pi-ai's per-model convention, so a route switch costs one cache rebuild, exactly like `/new` would. Only a model the route DECLARES in settings.yaml may be chosen: `dsh-llm-pi-ai` throws `UNKNOWN_MODEL` otherwise, so an unrecorded model is refused at the command, not at the next turn. |
| **MCP** | `bruine-mcp` (src/plugins/mcp.ts) mounts one `@deepseek-ai/dsh-mcp-client` per server from `mcpServers` in bruine.json and the project's `.mcp.json` (Claude Code format, src/mcp/config.ts). Every server connects before the first turn (20 s budget) so the tools array is fixed for the session; config changes apply to the next session. Project servers run only after the launcher showed what they run and the user approved (per project, per fingerprint, `mcp-state.json`). `mcp__*` tools go through bruine's gate: ask/judge by mode, Plan denies unless the server is `readOnly`, `alwaysAllow` per tool. A server that changes its own tool list mid-session is re-synced by dsh, which can cost one cache rebuild. |
| Honest numbers | The footer's tok/s is computed by bruine from its own timestamps, never copied from dsh (the same test found dsh's figure overstated: 79 shown vs 60 real). |
| Business model (Aron, 2026-09-25) | **Open source first (MIT), paid features later.** Everything that runs locally stays free and MIT forever. Future paid features must be hosted services (sync, team, cloud), never a lock on a local feature. Dependencies must stay MIT/BSD/Apache (checked 2026-09-25: dsh MIT, pi-tui MIT, all 147 deps MIT or BSD-3). |
| Names | npm package **`bruine`** (T20), commands `bruine` and the compatibility alias `kumo`. |

---

## 1. How it runs

```
$ bruine [args]
   │
   ├─ first run? ──► setup wizard (plain Node, before dsh boots)
   │                  writes ~/.bruine/bruine.json, ~/.bruine/settings.yaml,
   │                  ~/.bruine/profiles/bruine/{package.json,cordis.patch.yml}
   │
   └─ spawn: DSH_HOME=~/.bruine  dsh --profile bruine [args]
                │
                profile "bruine" = bundles [@deepseek-ai/dsh-base, bruine]
                │
                bruine bundle patch inserts 4 Cordis plugins:
                  bruine-startup   parse argv, provide ctx.bruineStartup
                  bruine-repl      create ONE Agent, readline loop, followup(), whenIdle()
                  bruine-render    draw reasoning / text / tool calls from live events
                  bruine-approval  answer approval requests with a y/n prompt
```

`DSH_HOME=~/.bruine` isolates bruine from the user's own `~/.dsh`.

---

## 2. dsh APIs we rely on (verified in dsh 0.1.5-rc.2)

Reference implementation to copy from: `@deepseek-ai/dsh-headless/lib/index.js` (one-shot runner, 187 lines)
and its `cordis.patch.yml` / `lib/startup.js`.

### 2.1 Plugin shape
```js
export const name = "bruine-repl";          // stable Cordis plugin name
export const inject = ["agentDefaultModel", "agents", "sessions"];
export const Config = z.object({ ... });  // z = @deepseek-ai/schemastery
export function apply(ctx, config) { ... }
```
- `ctx.get("appExit")` → function to request process exit (launcher provides it).
- `ctx.get("loader")?.await()` before using services.
- `ctx.provide("serviceName", value)` to publish a service.
- `parseCmdline(ctx, commanderProgram)` from `@deepseek-ai/dsh-cmdline` to read argv.

### 2.2 Agent lifecycle (from dsh-headless `run()`)
```js
const selection = ctx.get("agentDefaultModel").currentSelection();
const { agent } = await ctx.get("agents").create({
  sessionId: brandString(`session-${randomUUID()}`),     // @deepseek-ai/dsh-brand
  meta: { cwd: process.cwd() },
  agentOptions: { provider: selection.provider, model: selection.model },
  setup: (agentCtx) => installModelSelection(agentCtx, { current: selection, assembled: undefined }), // @deepseek-ai/dsh-agent
});
await agent.whenIdle();
agent.followup(createUserMessage({                        // @deepseek-ai/dsh-llm
  content: [{ type: "text", text: userInput }],
  source: { kind: "user" },
}));
await agent.whenIdle();                                   // turn finished
await ctx.get("sessions").flush(agent.session);           // persist
```
**bruine keeps the SAME agent for the whole conversation** (headless creates one per task).

### 2.3 Live stream (drives the UI)
```js
ctx.on("agent/assistant-stream", ({ agent: subject, frame }) => {
  if (subject !== agent) return;
  // frame.type: "start" | "end" | "chunk"
  // frame.chunk.type:
  //   "reasoning-delta"  chunk.text
  //   "text-delta"       chunk.text
  //   "tool-call-delta"  (tool name + streamed JSON arguments)
  //   "block-start"      chunk.blockType ("reasoning" | ...)
  //   "block-end"        chunk.block.type
  //   "usage" | "finish"
});
```
### 2.4 Durable session events
```js
ctx.on("session/event", (session, event) => { /* event.type */ });
```
Types seen: `turn/start`, `turn/end` (`event.data.reason.kind`: "completed" | "error" …),
`assistant/message`, `user/message`, `tool/call`, `tool/result`,
`approval/asked`, `approval/decided`, `compaction/start|end`.
Reference consumer: `@deepseek-ai/dsh-acp/lib/index.js` lines ~890-905.

### 2.5 Approvals
```js
ctx.on("approval/request", (request, next) => {
  if (request.agent !== agent) return next();
  return askUser(request).then(ok => ok ? "allowed-once" : "rejected");
});
```
Outcomes: `"allowed-once" | "rejected" | "cancelled" | "unavailable"`. Policies: `"ask" | "never"`.
Reference: `@deepseek-ai/dsh-acp/lib/index.js` line ~1115.

---

## 3. Display spec (the bruine look)

| Stream | Rendering |
|---|---|
| **Reasoning** | ONE dim line, rewritten in place: `💭 <current line>`. Deltas append to it. When a delta contains `\n`, the finished line disappears and the next one takes its place. When the reasoning block ends, the line is replaced by `💭 thought for 4.2s` |
| **Text** | streamed as it arrives |
| **Tool call** | header streamed while arguments arrive: `● bash  ls -la src/` ; on result: `✓ bash  0.4s` (or `✗`) + first 5 lines of output, dimmed, `… 37 more lines` |
| **Approval** | `? Allow bash: rm -rf dist ? [y/N]` |

Renderers are **pure classes** (input: deltas, output: strings / terminal ops) so they are unit-testable without dsh.

---

## 4. Repo layout
```
bruine/
  package.json          name "bruine", bin { "bruine": "dist/bin.js" }, type module
  src/
    bin.ts              launcher (T02)
    profile.ts          profile generator (T03)
    render/reasoning.ts (T04)   render/tools.ts (T05)   render/text.ts (T06)
    plugins/startup.ts  plugins/repl.ts  plugins/render.ts  plugins/approval.ts
    setup/              wizard (v0.2)
  cordis.patch.yml      bundle patch (inserts the 4 plugins)
  test/                 vitest, one test file per module
```
Stack: TypeScript, ESM, `tsup` build, `vitest`, `pnpm`. Node ≥ 22.

⚠️ The repo lives in `~/projets/bruine` (btrfs). Never on the exFAT drive: pnpm needs symlinks.

---

## 5. Settings (bruine.json)
```json
{ "mode": "simple",
  "models": { "main": {...}, "fast": {...}, "vision": {...} },
  "access": "ask",              // readonly | ask | project | full
  "browser": "off",             // off | headless | visible
  "memory": true,
  "skills": ["github", "systematic-debugging"],
  "theme": "default",
  "locale": "en",
  "reasoningEffort": { "qwen3.8*": "low" } }
```
API keys: system keyring (`secret-tool` on Linux), fallback `~/.bruine/.env` chmod 600. Never in bruine.json.

---

## 6. Roadmap
| Version | Scope |
|---|---|
| **0.1** | `bruine` command, simple setup, interactive chat, live reasoning/text/tool rendering, approvals |
| 0.2 | full setup: network model discovery (LAN + Tailscale, ports 8080-8090, 11434, 1234, 8000, `GET /v1/models`), API keys, roles, access, theme, skills picker, memory on/off |
| 0.3 | **local voice input** (hold Space = push-to-talk like Claude Code `/voice`, configurable; STT on the user's machine: small Whisper, or any OpenAI-compatible `/v1/audio/transcriptions` server; offline). Spike first: cross-platform mic capture from a terminal. Decided by Aron 2026-09-25, after the first public release |
| 0.3 | browser control via Playwright MCP (dsh already has `dsh-mcp-client`) |
| 0.4 | `bruine doctor`, persistent memory, proof mode |
| later | mouse as *control* (click to act), OFF by default. Mouse *reading* is on since T56: drag to select, release to copy, notice in the corner. It takes the wheel with it (bruine has no scroll of its own), so `/mouse` and `BRUINE_MOUSE_SELECT=0` give it back, and a form does it by itself |

## Naming compatibility

`src/compat.ts` is the single owner of environment, home and on-disk read fallbacks.
New `BRUINE_*` values override `KUMO_*`; the launcher forwards their effective values under the new names to the dsh bundle.
Config and skills-manifest reads prefer the canonical Bruine file, then the legacy Kumo file only if absent. Writes target only the new file.
The launcher creates the Bruine profile without deleting the old profile or modifying user sessions, settings, secrets or legacy files.
The compatibility command and old npm installation-path detection remain supported; update checks and install commands use `bruine`.
