# T22 terminal test report

Local run: Linux, branch t22-e2e. All eight tests execute independently; no bail-out and no src/ or test/cache/ changes. The user instruction to continue after failures supersedes the ticket's original stop rule.

## Results

| Scenario | Result | Evidence |
| --- | --- | --- |
| Reasoning | PASS | 40 mixed reasoning lines sampled every 50 ms; one visible thought marker maximum; final duration shown. |
| Escape | PASS | Server observed cancellation, screen stabilized within one second, and a second turn completed. |
| Tool call | PASS | Streaming read header, successful tool result, and sentinel in the second model request. |
| Ask label | EXPECTED FAILURE | Separate `it.fails` test with comment `fixed by T23`; initial footer has no ask label. Setup and cleanup are outside the expected-failure body. |
| Modes | FAIL | PLAN never appears after Tab; yellow Auto label missing; confirmation opens, but FULL ACCESS badge never appears after accepting. All checkpoints ran. |
| Keys | FAIL | Ctrl+C leaves PROMPT_TO_CLEAR visible. Ctrl+D still exits with code 0 in 101 ms. |
| Resize | PASS | Resizing to 60×20 while reasoning retains at most one thought marker and all visible lines fit 60 cells. |
| Approval | PASS | Allow once / Always / Reject selector displayed; Down, Down, Enter rejects write; rejected.txt is absent and the next model request contains a tool result. |

No tests were skipped. Windows and macOS remain unverified locally; CI is configured for all three OS on Node 22 and 24.

## Kumo bugs found

- **Known T23 issue — Ask label absent.** The product decision is to always show ask dim, auto yellow, or FULL ACCESS red. Only the Ask-label test is marked as expected failure.
- **Modes — PLAN does not appear after Tab.** The second Tab was still sent. The no-PLAN check after the second Tab passes, but because PLAN never appeared, that alone cannot prove the Build transition worked. [Failure dump](__screens__/modes-plan-failure.txt).
- **Modes — Auto permission label absent.** The existing gray `(auto)` belongs to the context meter and is not accepted as a permission label. The next Shift+Tab correctly opens Full access confirmation, which shows the permission cycle continued. [Failure dump](__screens__/modes-auto-failure.txt).
- **Modes — confirmed FULL ACCESS badge absent.** Both confirmation choices are visible; Down and Enter dismiss the dialog, but no red badge appears within two seconds. The red-cell assertion cannot be reached because the badge is absent. [Failure dump](__screens__/modes-full-failure.txt).
- **Keys — Ctrl+C leaves stale prompt text visible.** No model request is submitted. Ctrl+D then exits with code 0 in 101 ms, confirming the editor is internally empty despite the stale display. [Clear-screen failure dump](__screens__/keys-clear-failure.txt).

The code has no explicit render request in the mode-change listener or Ctrl+C clear handler; this is consistent with the stale-screen failures, but no product fix was attempted.

## Tool stream and historical EMPTY_RESPONSE

The new fake sends an assistant role chunk, then tool_calls with index 0, a stable id and function name; subsequent chunks carry arguments fragments under the same index. It terminates with finish_reason: tool_calls, then [DONE]. The real launcher executed read and submitted its result in the next request, without EMPTY_RESPONSE.

The exact cause of Qwen's historical EMPTY_RESPONSE is **not established**: the historical failing stream and llama.cpp capture are not supplied in this checkout. The existing test/cache fake already includes index, id and a tool_calls finish; lack of argument fragmentation alone is not evidence of a protocol defect. Claiming one particular difference caused the old failure would be guessing. A captured failing response and the real llama.cpp stream are needed for that comparison.

## Commands

- pnpm build: PASS, automatically run by the e2e suite.
- pnpm typecheck: PASS.
- pnpm test: PASS, 18 files / 202 tests, 9.49 s. [Full output](unit-output.txt).
- pnpm test:e2e: FAIL, 5 normal passes + 1 expected failure + 2 failures, 32.22 s. Vitest counts the expected failure as passed, reporting `2 failed | 6 passed (8)`. No skipped or unrun tests. [Full output](e2e-output.txt).

No install or pull was performed. Test commands ran with permission to use loopback servers and PTYs. BOS's pre-existing modified tool-call dump was preserved as [tool-call-bos.txt](__screens__/tool-call-bos.txt) before refreshing the local run's dump.

## Screen dumps

The dumps below show visible xterm content (100×30, or 60×20 for resize). Trailing whitespace and empty trailing rows are omitted here; raw files retain all rows.

### reasoning

[Raw dump](__screens__/reasoning.txt)

```text
 kumo v0.0.1
 escape interrupt · ctrl+c clear · ctrl+d exit · / commands
 │ Think through the problem
💭 thought for 4.1s
 REASONING_DONE
────────────────────────────────────────────────────────────────────────────────────────────────────

────────────────────────────────────────────────────────────────────────────────────────────────────
0.0%/262k (auto)                                                             (local) e2e-model • off
```

### escape

[Raw dump](__screens__/escape.txt)

```text
 kumo v0.0.1
 escape interrupt · ctrl+c clear · ctrl+d exit · / commands
 │ Start a long answer
 word0 word1 word2 word3 word4 word5 word6 word7 word8 word9
 - cancelled
────────────────────────────────────────────────────────────────────────────────────────────────────

────────────────────────────────────────────────────────────────────────────────────────────────────
0.0%/262k (auto)                                                             (local) e2e-model • off
```

### escape-second-turn

[Raw dump](__screens__/escape-second-turn.txt)

```text
 kumo v0.0.1
 escape interrupt · ctrl+c clear · ctrl+d exit · / commands
 │ Start a long answer
 word0 word1 word2 word3 word4 word5 word6 word7 word8 word9
 - cancelled
 │ Try another turn
 SECOND_TURN_WORKS
────────────────────────────────────────────────────────────────────────────────────────────────────

────────────────────────────────────────────────────────────────────────────────────────────────────
0.0%/262k (auto)                                                             (local) e2e-model • off
```

### tool-call-streaming

[Raw dump](__screens__/tool-call-streaming.txt)

```text
 kumo v0.0.1
 escape interrupt · ctrl+c clear · ctrl+d exit · / commands
 │ Read note.txt
● read
────────────────────────────────────────────────────────────────────────────────────────────────────

────────────────────────────────────────────────────────────────────────────────────────────────────
0%/— (auto)                                                                  (local) e2e-model • off
```

### tool-call

[Raw dump](__screens__/tool-call.txt)

```text
 kumo v0.0.1
 escape interrupt · ctrl+c clear · ctrl+d exit · / commands
 │ Read note.txt
✓ read  …  0.6s
    <path>/tmp/kumo-e2e-project-JAgtam/note.txt</path>
    <type>file</type>
    <content>
    1: E2E_READ_SENTINEL

    … 2 more lines
 READ_FINISHED
────────────────────────────────────────────────────────────────────────────────────────────────────

────────────────────────────────────────────────────────────────────────────────────────────────────
0.0%/262k (auto)                                                             (local) e2e-model • off
```

### ask-label

[Raw dump](__screens__/ask-label.txt)

```text
 kumo v0.0.1
 escape interrupt · ctrl+c clear · ctrl+d exit · / commands
────────────────────────────────────────────────────────────────────────────────────────────────────

────────────────────────────────────────────────────────────────────────────────────────────────────
0%/— (auto)                                                                  (local) e2e-model • off
```

### modes-plan-failure

[Raw dump](__screens__/modes-plan-failure.txt)

```text
 kumo v0.0.1
 escape interrupt · ctrl+c clear · ctrl+d exit · / commands
────────────────────────────────────────────────────────────────────────────────────────────────────

────────────────────────────────────────────────────────────────────────────────────────────────────
0%/— (auto)                                                                  (local) e2e-model • off
```

### modes-build

[Raw dump](__screens__/modes-build.txt)

```text
 kumo v0.0.1
 escape interrupt · ctrl+c clear · ctrl+d exit · / commands
────────────────────────────────────────────────────────────────────────────────────────────────────

────────────────────────────────────────────────────────────────────────────────────────────────────
0%/— (auto)                                                                  (local) e2e-model • off
```

### modes-auto-failure

[Raw dump](__screens__/modes-auto-failure.txt)

```text
 kumo v0.0.1
 escape interrupt · ctrl+c clear · ctrl+d exit · / commands
────────────────────────────────────────────────────────────────────────────────────────────────────

────────────────────────────────────────────────────────────────────────────────────────────────────
0%/— (auto)                                                                  (local) e2e-model • off
```

### modes-confirmation

[Raw dump](__screens__/modes-confirmation.txt)

```text
 kumo v0.0.1
 escape interrupt · ctrl+c clear · ctrl+d exit · / commands
────────────────────────────────────────────────────────────────────────────────────────────────────

────────────────────────────────────────────────────────────────────────────────────────────────────
0%/— (auto)                                                                  (local) e2e-model • off







           Switch to FULL ACCESS? kumo will stop asking before commands run.
          → Stay in current mode
            Yes, grant full access
```

### modes-full-failure

[Raw dump](__screens__/modes-full-failure.txt)

```text
 kumo v0.0.1
 escape interrupt · ctrl+c clear · ctrl+d exit · / commands
────────────────────────────────────────────────────────────────────────────────────────────────────

────────────────────────────────────────────────────────────────────────────────────────────────────
0%/— (auto)                                                                  (local) e2e-model • off
```

### modes-failure

[Raw dump](__screens__/modes-failure.txt)

```text
 kumo v0.0.1
 escape interrupt · ctrl+c clear · ctrl+d exit · / commands
────────────────────────────────────────────────────────────────────────────────────────────────────

────────────────────────────────────────────────────────────────────────────────────────────────────
0%/— (auto)                                                                  (local) e2e-model • off
```

### keys-clear-failure

[Raw dump](__screens__/keys-clear-failure.txt)

```text
 kumo v0.0.1
 escape interrupt · ctrl+c clear · ctrl+d exit · / commands
────────────────────────────────────────────────────────────────────────────────────────────────────
PROMPT_TO_CLEAR
────────────────────────────────────────────────────────────────────────────────────────────────────
0%/— (auto)                                                                  (local) e2e-model • off
```

### keys-failure

[Raw dump](__screens__/keys-failure.txt)

```text
 kumo v0.0.1
 escape interrupt · ctrl+c clear · ctrl+d exit · / commands
────────────────────────────────────────────────────────────────────────────────────────────────────
PROMPT_TO_CLEAR
────────────────────────────────────────────────────────────────────────────────────────────────────
0%/— (auto)                                                                  (local) e2e-model • off
```

### resize

[Raw dump](__screens__/resize.txt)

```text
 kumo v0.0.1
 escape interrupt · ctrl+c clear · ctrl+d exit · / commands
 │ Think while the terminal resizes
💭 thought for 4.1s
 REASONING_DONE
────────────────────────────────────────────────────────────

────────────────────────────────────────────────────────────
0.0%/262k (auto)                     (local) e2e-model • off
```

### approval-select

[Raw dump](__screens__/approval-select.txt)

```text
 kumo v0.0.1
 escape interrupt · ctrl+c clear · ctrl+d exit · / commands
 │ Write rejected.txt
● write  …
────────────────────────────────────────────────────────────────────────────────────────────────────

────────────────────────────────────────────────────────────────────────────────────────────────────
0%/— (auto)                                                                  (local) e2e-model • off





           ? Allow write: …
          → Allow once
            Always for this session
            Reject
```

### approval

[Raw dump](__screens__/approval.txt)

```text
 kumo v0.0.1
 escape interrupt · ctrl+c clear · ctrl+d exit · / commands
 │ Write rejected.txt
✗ write  …  0.7s
    Error: the user rejected tool "write"
 WRITE_REJECTED
────────────────────────────────────────────────────────────────────────────────────────────────────

────────────────────────────────────────────────────────────────────────────────────────────────────
0.0%/262k (auto)                                                             (local) e2e-model • off
```
