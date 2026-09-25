# kumo — Architecture

`kumo` is an interactive terminal agent built on top of **DeepSeek Harness (dsh)**.
It is NOT a fork: it is a dsh **profile** plus a **bundle of plugins**, so dsh updates flow in for free.

All user-facing text is **English**. (A French locale may come later; never hardcode French.)

## 0. Product constraints (read first)
kumo is a **public product** for **Windows, macOS and Linux**, not a personal tool.

| Rule | Consequence for every ticket |
|---|---|
| Cross-platform | `node:path` / `os.homedir()` only, never `/home/...` or `~` strings. No bash-only scripts in the product. Test paths with backslashes. |
| UI library | **`@earendil-works/pi-tui`** (MIT, pure TS, no native deps, synchronized output, used by pi on all 3 OS). Ink rejected (flicker history in Gemini CLI / Qwen Code), OpenTUI rejected (native Zig; on Node only experimental, Windows tested with Bun only). |
| dsh is a developer preview | **Pin an exact dsh version** in `package.json`. Upgrades are a deliberate ticket, never automatic. |
| Privacy | dsh telemetry is ON by default: kumo sets `DSH_TELEMETRY_DISABLED=1` unless the user opts in during setup. Network discovery is **opt-in**, private ranges only (10/8, 172.16/12, 192.168/16, 100.64/10 Tailscale). |
| Secrets | OS keyring (`@napi-rs/keyring`: Windows Credential Manager, macOS Keychain, Linux Secret Service). Fallback file chmod 600 (Linux/macOS) with a warning. Never echo a key. |
| Terminals | Must work in Windows Terminal, PowerShell, macOS Terminal, iTerm2, Konsole, GNOME Terminal. Provide an ASCII fallback (`*` for `💭`, `>` for `›`) when `KUMO_ASCII=1` or the terminal is not UTF-8. |
| CI | GitHub Actions matrix: ubuntu, windows, macos × Node 22 and 24. A ticket is done only when CI is green on all 3. |


---

## 1. How it runs

```
$ kumo [args]
   │
   ├─ first run? ──► setup wizard (plain Node, before dsh boots)
   │                  writes ~/.kumo/kumo.json, ~/.kumo/settings.yaml,
   │                  ~/.kumo/profiles/kumo/{package.json,cordis.patch.yml}
   │
   └─ spawn: DSH_HOME=~/.kumo  dsh --profile kumo [args]
                │
                profile "kumo" = bundles [@deepseek-ai/dsh-base, kumo-cli]
                │
                kumo-cli bundle patch inserts 4 Cordis plugins:
                  kumo-startup   parse argv, provide ctx.kumoStartup
                  kumo-repl      create ONE Agent, readline loop, followup(), whenIdle()
                  kumo-render    draw reasoning / text / tool calls from live events
                  kumo-approval  answer approval requests with a y/n prompt
```

`DSH_HOME=~/.kumo` isolates kumo from the user's own `~/.dsh`.

---

## 2. dsh APIs we rely on (verified in dsh 0.1.5-rc.2)

Reference implementation to copy from: `@deepseek-ai/dsh-headless/lib/index.js` (one-shot runner, 187 lines)
and its `cordis.patch.yml` / `lib/startup.js`.

### 2.1 Plugin shape
```js
export const name = "kumo-repl";          // stable Cordis plugin name
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
**kumo keeps the SAME agent for the whole conversation** (headless creates one per task).

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

## 3. Display spec (the kumo look)

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
kumo/
  package.json          name "kumo-cli", bin { "kumo": "dist/bin.js" }, type module
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

⚠️ The repo lives in `~/projets/kumo` (btrfs). Never on the exFAT drive: pnpm needs symlinks.

---

## 5. Settings (kumo.json)
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
API keys: system keyring (`secret-tool` on Linux), fallback `~/.kumo/.env` chmod 600. Never in kumo.json.

---

## 6. Roadmap
| Version | Scope |
|---|---|
| **0.1** | `kumo` command, simple setup, interactive chat, live reasoning/text/tool rendering, approvals |
| 0.2 | full setup: network model discovery (LAN + Tailscale, ports 8080-8090, 11434, 1234, 8000, `GET /v1/models`), API keys, roles, access, theme, skills picker, memory on/off |
| 0.3 | browser control via Playwright MCP (dsh already has `dsh-mcp-client`) |
| 0.4 | `kumo doctor`, persistent memory, proof mode |
| later | mouse/keyboard control, OFF by default |
