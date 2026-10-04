# Bruine presentation video

A Remotion project that renders Bruine's presentation video for YouTube: 1920x1080, 45 fps,
about 42 seconds, and a 15-second cut for Shorts and feeds, both with a synthesized soundtrack.
The picture is React, SVG and CSS; the sound is `scripts/soundtrack.ts`; the demo is the real
bruine, recorded cell by cell. No image, sample or audio recording is loaded, and nothing is
fetched: the two faces (Inter, JetBrains Mono, SIL OFL 1.1) ship in `public/fonts`.

```
cd promo
npm install
npm run studio        # preview and scrub in Remotion Studio
npm run render        # out/bruine-promo.mp4 (H.264 CRF 16 + AAC 320k)
npm run render:fr     # out/bruine-promo-fr.mp4
npm run render:short  # out/bruine-short.mp4, the 15-second cut
npm run check         # typecheck, and no em dash in any text shown on screen
```

`studio`, `still` and `render` first run `npm run audio`, which writes `public/soundtrack-en.wav`,
`-fr.wav` and the short cut's `soundtrack-short-en.wav`, `-fr.wav` (Node 22.18+ runs the
TypeScript directly). A single frame:
`npm run still -- out/frame.png --frame=600`.

## Where things are

| | |
|---|---|
| `src/config.ts` | Every text (English and French), scene lengths, the two cuts, ripple origins, palette, fonts, loudness |
| `src/fonts.ts` | Loads the fonts in `public/fonts` before the first frame |
| `src/data/terminal.ts` | The demo: the real terminal, 104x26, one frame every 1/45 s. Recorded on the product branch by `RECORD_VIDEO=1 RECORD_OUT=<file> pnpm vitest run test/e2e -t "record the video terminal"`, imported by `node scripts/import-terminal.mjs <file>` |
| `src/timeline.ts` | Every cue in frames, the rain curve and the logo's fill law: shared by the picture and the sound |
| `src/BruinePromo.tsx` | The film: backdrop, mist, rain, six scenes, transitions, grain, soundtrack |
| `src/scenes/` | `Intro`, `Models`, `Demo`, `Effort`, `Promises`, `Outro` |
| `src/components/Rain.tsx` | The rain (after `src/ui/rain.ts`), with rings where drops land, and blurred drops in front of the lens |
| `src/components/Wordmark.tsx` | The BRUINE mark drawn from its box-drawing cells, filling in under the rain (after `src/ui/logo-motion.ts`), with a light sweep |
| `src/components/Atmosphere.tsx` | Mist, distant lightning, grain, vignette, and the ripple that carries one scene into the next |
| `src/components/Glow.tsx` | The prompt frame's effort glow (after `src/ui/border-glow.ts`) |
| `scripts/soundtrack.ts` | The synthesizer and the score |

## The script

1. **Intro** (6.6 s). One drop falls in the dark and rings out; *bruine*, as a dictionary gives it. The word swells into the mark as the rain collects into it, light crosses it.
2. **Models** (6.2 s). Your own server first, large: llama.cpp on localhost, and your MCP servers; the cloud providers in a quieter grid. No account, nothing sent anywhere you did not point it at.
3. **Demo** (14.6 s). The real bruine, recorded in a terminal and drawn large enough for a phone, a caption at a time: reasoning, a second prompt queued while it works, the edit as a diff behind the approval band (`y`, then `a` for `npm test`), the tests, the measured readings, the queued prompt going out.
4. **Effort** (5.8 s). The harder it thinks, the harder it rains: `ctrl+e` from `low` to `max`, the frame glows as in the terminal, the storm comes.
5. **Promises** (5.6 s). One: the prompt cache survives, the same bytes every turn.
6. **Outro** (6.8 s). The mark, `npm install -g bruine`, `bruine`; then only the commands and the address are left, in a drizzle.

The short cut is the intro, the effort and the outro (6.0 + 5.2 + 5.2 s, 15 s with the overlaps).

A drop opens every scene: the next one spreads out from where it lands.

## The sound

Rain whose density follows the rain on screen, droplets, a chord pad that changes with each
scene, a falling drop for every scene change, a tick for every letter of the logo as it fills,
keystrokes on the frames the characters appear, tool and test chimes, the permission bell, the
`ctrl+e` steps, thunder at `max`, and a resolving chord at the end. The master is compressed and
levelled to about -16 LUFS with peaks under -1 dBFS, which suits YouTube.
