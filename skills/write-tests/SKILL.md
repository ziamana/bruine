---
name: write-tests
description: Write tests that catch regressions, not implementations — fast, deterministic, named after behavior.
---

# Writing tests

Use this skill whenever you add or change behavior, and whenever you fix a bug.

## First question
What did the old code get wrong that a test can now forbid? Write that test first — it must fail before the fix and pass after it. A bug fix without a failing-first test is a rumor.

## Shape
- Name the behavior, not the method: "plan mode denies mutations in every access mode", not "testDecide3".
- Arrange-Act-Assert, one behavior per test. If a test needs "and" in its name, split it.
- Test through the public seam; reach into internals only for pure logic.
- Table-drive when the same shape repeats (command → verdict, input → output): pairs read better than copy-pasted blocks.

## Determinism
- No sleeps waiting for async — await the state, or inject the clock/timer.
- No shared mutable files, ports, or env between tests; use a fresh temp dir and random ports per test.
- Clean up what you create (servers, temp homes); a green suite must leave `git status` clean.

## Coverage that matters
- Boundaries and failure paths (empty input, refused connection, canceled signal), not just the happy line count.
- For security gates: every bypass example you can think of becomes a row in the table. If it is provable with a pure function, it is unit-testable — do that before any e2e.

## Anti-patterns
- Asserting a snapshot of strings that change every release.
- Testing the mock instead of the system (the test passes because the fake said so).
- Turning off a flaky test instead of finding its race.
- 100% coverage of getters and 0% of the timeout path.

## Before finishing
Run the whole suite, not just your file — and never commit with a test you skipped or edited because it "should not apply". If a test that should fail passes, you have two bugs.
