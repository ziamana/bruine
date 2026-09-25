---
name: code-review
description: Review diffs like the next reader matters — intent, correctness, edge cases, tests, and long-term cost.
---

# Code review

Use this skill when asked to review a diff, a pull request, or your own change before shipping.

## Read in this order
1. **Intent** — what is this change for? Is it the smallest honest way to do that?
2. **Correctness** — trace the happy path once, then the boundaries: empty, single, max, wrong-type, concurrent, canceled, partially-failed.
3. **Contracts** — callers and callees: did any signature, ordering, error type, or default change silently?
4. **Tests** — does a test fail if the bug returns? Tests that only assert the code compiles are cost, not safety.
5. **Longevity** — will the next person understand this in six months? Is there now a second way to do the same thing?

## Severity when reporting
- **[block]** wrong, unsafe, or silently breaking a contract — must fix.
- **[should]** real weakness with a concrete better shape — fix unless out of scope.
- **[nit]** taste-level — say it, then move on; never gate on a nit.

## Rules
- Comment on the code, not the person; every "why not X?" beats every "this is bad".
- One concrete suggestion per finding: show the shape of the fix, not just the flaw.
- Check the diff for things that must never appear: secrets, tokens, personal paths, debug prints, dead flags, commented-out code.
- Verify, don't trust: run the tests the diff claims are green; run the repro for a claimed fix.
- If the change is yours: re-read it as a stranger once, top to bottom, before presenting it.

## Sign off
Say what you actually checked and what you did not. "Tests pass on Linux, Windows CI pending" is a review; "looks good" is not.
