# Bruine rename verification

Verified locally on 2026-10-03. No push, tag, global install, or user-home migration was performed.

| Stage | Commit | Result |
| --- | --- | --- |
| Compatibility | `0960e18` | Shared home/env lookup, config and skills-manifest fallbacks, both command names, preserved legacy profile; 1,257 unit tests passed. |
| Mechanical rename | `f720035` | Package, plugins, services, identifiers, source filenames, bundle, launcher and benchmark renamed; 1,258 unit tests passed. |
| Prose and branding | `0843b91` | Documentation and visible CLI/UI naming updated; 1,258 unit tests passed. |
| Final verification | This commit | Results below. |

Final commands ran sequentially:

- `pnpm typecheck`: passed.
- `pnpm test`: 1,258 tests passed across 81 files.
- `pnpm test:e2e`: 65 tests passed across 2 files, including terminal rendering and setup; 258.64 seconds. Its build passed.
- `node dist/bin.js --version`: `bruine 0.0.1`.
- `node dist/bin.js --help`: commands and usage name Bruine.
- Fresh throwaway `BRUINE_HOME`, `node dist/bin.js -p "say ok"`: exit 2 with the setup-required message, with no crash.
- Legacy throwaway `KUMO_HOME`, containing `settings.yaml`, `.env` and `kumo.json`, without `bruine.json`: setup recognized the existing installation, opened the edit menu after Review your setup, and left the old config untouched on cancellation.

`test/rename-compat.test.ts` covers seven home-selection cases, env precedence (including an empty canonical value), config read/write behavior, manifest fallback, both bins, the persona detection phrase, legacy profile preservation and legacy env forwarding.

The name audit leaves old spelling only for compatibility or explicitly preserved material:

- The command alias, legacy benchmark flag, old home/config/manifest names, env aliases, managed-persona marker and old npm install-path detection.
- Compatibility tests and documentation, both-prefix isolation in test/benchmark environments, and the old scratch-directory ignore pattern.
- Ticket history, the dated comparison, third-party notices and skills, and the lockfile, all unchanged as requested.
- The three package metadata URLs below were left on the old repository name until the owner renamed the repository; they now name `ziamana/bruine`.

```text
git+https://github.com/ziamana/bruine.git
https://github.com/ziamana/bruine#readme
https://github.com/ziamana/bruine/issues
```

`npm view bruine name version` returned E404 during the availability check. This does not reserve the name or publish the package. Global command installation and publishing were deliberately not exercised; the two bin entries both target `dist/bin.js`.

Update, 2026-10-04: the plain name was free but npm refused to publish it ("Package name too similar to existing package byline"), so bruine is published as `@ziamana/bruine`. The installed command is still `bruine`.
