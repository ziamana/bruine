---
name: systematic-debugging
description: Debug by evidence, not vibes: reproduce, shrink, isolate, fix the cause, prove it stayed fixed.
---

# Systematic debugging

Use this skill whenever something is broken: a failing test, wrong output, crash, hang, or behavior that "should work".

## Rules
1. **Reproduce first.** Do not theorize about a bug you cannot make happen. A minimal, deterministic reproduction is half the fix.
2. **Read the actual error.** Stack traces, exit codes, log lines, the exact request bytes. Guessing while the error message is unread is wasted time.
3. **Shrink it.** Remove inputs, files, flags until the bug disappears. The last removed piece is your suspect.
4. **One variable at a time.** Change exactly one thing, run the reproduction, record the result. Batched changes prove nothing.
5. **Fix the cause, not the symptom.** A retry that hides a race, or a null-check that hides a missing wire-up, is a bug with a job.
6. **Prove it.** The failing reproduction must now pass, and the project's tests must stay green. Add the regression test near the seam where the bug lived.

## When stuck
- State out loud what you have ruled out and what still explains the evidence.
- Look at the boundary, not the middle: what entered the function? What changed since it last worked?
- Re-read the docs/source of the component you suspect. Half of "weird behavior" is a misread contract.

## Never
- No speculative refactors while a reproduction is failing.
- No "it works on my machine". The reproduction either passes here or you keep digging.
- No closing a debug session without saying: root cause, the change that fixes it, and the test that pins it.
