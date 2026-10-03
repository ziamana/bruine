# Third-party notices

Bruine ships a few skills written by other people, copied unchanged from their public
repositories with their license files. Each one keeps its own `LICENSE` (and `NOTICE.md`
where its author provides one) inside `skills/<name>/`. They are offered in the setup, and
a user can leave any of them out.

| Skill | Author and source | License | Taken from |
|---|---|---|---|
| `impeccable` | Paul Bakaus, https://github.com/pbakaus/impeccable | Apache-2.0 | commit e103efe, `plugin/skills/impeccable` |
| `make-interfaces-feel-better` | Jakub Krehel, https://github.com/jakubkrehel/make-interfaces-feel-better | MIT | commit 35545ea, `skills/make-interfaces-feel-better` |
| `thermo-nuclear-code-quality-review` | Cursor, https://github.com/cursor/plugins | MIT | commit 23e4138, `cursor-team-kit/skills/thermo-nuclear-code-quality-review` |
| `youtube-transcript` | Mario Zechner, https://github.com/badlogic/pi-skills | MIT | commit 90bb51c, `youtube-transcript` |
| `playwright-cli` | Microsoft, https://github.com/microsoft/playwright-cli | Apache-2.0 | commit b85c7a7, `skills/playwright-cli` |

`impeccable` itself carries a notice (`skills/impeccable/NOTICE.md`) for reference files it
derives from `ehmo/platform-design-skills` (MIT).

The Bruine skills in the same folder (`code-review`, `git-workflow`, `systematic-debugging`,
`write-tests`, `remotion`) are Bruine's own and fall under Bruine's license.

`youtube-transcript` installs its npm dependency (`youtube-transcript-plus`, MIT) the first
time it is used; nothing of it is shipped. `impeccable`'s launcher may download its helper
binary on first use.
