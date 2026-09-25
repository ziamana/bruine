---
name: git-workflow
description: Keep git history clean and reviewable — focused branches, atomic commits, honest messages, safe pushes.
---

# Git workflow

Use this skill whenever you are asked to commit, branch, rebase, or push work.

## Branches
- Work on a focused branch named `type/scope-short-title` (e.g. `feat/login`, `fix/cache-prefix`).
- Never commit directly to the default branch unless the user explicitly asked for it.
- Start from an up-to-date base: check the current branch and how far ahead/behind it is before making changes.

## Commits
- One logical change per commit. Stage deliberately (`git add <paths>`), never `git add -A` when unrelated files are dirty.
- Message format: a command-style subject under ~70 characters ("Fix cache prefix on mode flip"), then a blank line and a body explaining *why*, not *what*.
- No "WIP", no emoji, no "as requested". The diff says what; the message says why.
- If a commit would need "and also" in its subject, split it.

## Working with the user's state
- Check `git status --short` before touching files; never revert, stash, or overwrite changes you did not make.
- When rebasing or amending, prefer `--force-with-lease` over `--force` for pushes, and say plainly what rewrote history in your final message.
- Never push, tag, or open a PR unless the user asked.

## Recovery
- Losing work: check `git reflog` before declaring anything destroyed.
- Merge conflicts: resolve hunk by hunk, keep both intents when they are compatible, and run the tests before declaring the conflict solved.

## Verification
- Before the final commit of a task, run the project's checks (typecheck, build, tests) and report anything you could not run instead of silently skipping it.
