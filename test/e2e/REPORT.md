# T22 terminal test report

Local run: Linux, branch t22-e2e. No src/ or test/cache/ changes.

## Results

| Scenario | Result | Evidence |
| --- | --- | --- |
| Reasoning | PASS | 40 mixed reasoning lines; sampled every 50 ms; at most one visible thought marker; final thought duration present. |
| Escape | PASS | Server observed disconnect, screen stabilized within the one-second deadline, second prompt completed. |
| Tool call | PASS | Streaming read header, successful read result, second model request contained the real note.txt sentinel and matching tool_call_id. |
| Modes | FAIL | The initial Ask permission mode is not displayed. Test stopped before sending Tab. |
| Keys | NOT RUN | Stopped after the modes failure, as required by T22. No screen dump. |
| Resize | NOT RUN | Stopped after the modes failure, as required by T22. No screen dump. |
| Approval | NOT RUN | Stopped after the modes failure, as required by T22. No screen dump. |

No OS-specific skips were introduced. Windows and macOS are unverified locally; the added CI job covers all three OS on Node 22 and 24 and uploads screen dumps even on failure. CI has not been run here.

## Kumo bug found

The fresh Ask-mode session shows no Ask permission label. The modes scenario times out waiting for it. The footer only shows context usage, model and effort. The source agrees with the terminal evidence: Modes.describe() supplies badges for PLAN and FULL ACCESS only, and FooterComponent renders those badges. The subsequent Plan/Build, Auto, confirmation and red-badge checks were not reached. No product fix attempted.

## Tool stream and historical EMPTY_RESPONSE

The new fake sends an assistant role chunk, then tool_calls with index 0, a stable id and function name; subsequent chunks carry arguments fragments under the same index. It terminates with finish_reason: tool_calls, then [DONE]. The real launcher executed read and submitted its result in the next request, without EMPTY_RESPONSE.

The exact cause of Qwen's historical EMPTY_RESPONSE is **not established**: the historical failing stream and llama.cpp capture are not supplied in this checkout. The existing test/cache fake already includes index, id and a tool_calls finish; lack of argument fragmentation alone is not evidence of a protocol defect. Claiming one particular difference caused the old failure would be guessing. A captured failing response and the real llama.cpp stream are needed for that comparison. Further investigation stopped at the confirmed modes bug.

## Commands

- pnpm build: PASS (also run automatically by the e2e suite).
- pnpm typecheck: PASS.
- pnpm test: PASS, 18 files / 202 tests, 9.43 s. Full output: [unit-output.txt](unit-output.txt).
- pnpm test:e2e: FAIL, 3 passed / 1 failed / 3 not run, 28.66 s. Full output: [e2e-output.txt](e2e-output.txt).

Initial sandbox runs could not open loopback listeners (EPERM), affecting the e2e setup and existing suite. They were rerun with execution permission; results above are those completed runs. No install or pull was performed during this continuation.

## Screen dumps

Each dump below is the visible 100×30 xterm screen. Trailing whitespace is omitted here for readability; raw dumps retain the complete visible rows.

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
    <path>/tmp/kumo-e2e-project-FaMCyI/note.txt</path>
    <type>file</type>
    <content>
    1: E2E_READ_SENTINEL

    … 2 more lines
 READ_FINISHED
────────────────────────────────────────────────────────────────────────────────────────────────────

────────────────────────────────────────────────────────────────────────────────────────────────────
0.0%/262k (auto)                                                             (local) e2e-model • off
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
