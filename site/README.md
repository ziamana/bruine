# bruine.site

The bruine website: a Next.js app exported as static files, in English (`/en/`) and French (`/fr/`).
The bare address picks the visitor's language.

```
npm install
npm run dev        # http://localhost:3000/en/
npm run build      # static site in out/
```

`BASE_PATH=/bruine npm run build` builds it for a sub-path (GitHub Pages under `ziamana.github.io/bruine`).
`out/` can go on any static host as it is.

## What is real

Every terminal screen on the site comes from the running app, nothing is drawn by hand:

- `data/recording.ts` is the session the home page plays as you scroll. It was recorded by
  `test/e2e/video-recording.test.ts` and is the same file as `promo/src/data/terminal.ts` on the
  `promo-video` branch.
- `data/shots.json` and `data/shots-light.json` are the retry, image and light-theme stills, recorded by
  `test/e2e/screenshots.test.ts` (`RECORD_SHOTS=1`).
- `data/narrow/` is the same session and stills recorded at 56 columns for phones (`RECORD_COLS=56`).
- `scripts/import-tape.mjs` turns them into `public/tape/session.json` and `session-narrow.json` (run by `npm run build`).
- `public/media/` holds the film and the stills from `docs/media/`. `film-poster.jpg` is the film's frame at 3.2 s.

To refresh after a UI change: record again with those tests, copy the files into `data/`, then build.

## Where things are

- `lib/i18n.ts`: every word of the home page, in both languages.
- `content/`: the guide, the comparison and the changelog, in both languages.
- `components/Session.tsx`: the pinned terminal, scrubbed by the scroll.
- `components/InstallBand.tsx`: the install command, asked as bruine asks (`y` copies, `a` switches installer, `n` opens the guide).
- `components/Rain.tsx`: the rain behind the page. It follows the weather chapter and holds still while the recorded session waits for an approval.
- Fonts: JetBrains Mono and Inter, self-hosted from `fonts/` (OFL, licences beside them).
