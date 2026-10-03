# Bruine presentation video

A Remotion project that renders Bruine's presentation video for YouTube: 1920x1080, 45 fps,
about 42 seconds, with a synthesized soundtrack. Everything is made in code: the picture in
React, SVG and CSS, the sound in `scripts/soundtrack.ts`. No image, font, sample or recording is
loaded; fonts come from the system stack.

```
cd promo
npm install
npm run studio        # preview and scrub in Remotion Studio
npm run render        # out/bruine-promo.mp4 (H.264 CRF 16 + AAC 320k)
npm run render:fr     # out/bruine-promo-fr.mp4
npm run check         # typecheck, and no em dash in any text shown on screen
```

`studio`, `still` and `render` first run `npm run audio`, which writes `public/soundtrack-en.wav`
and `public/soundtrack-fr.wav` (Node 22.18+ runs the TypeScript directly). A single frame:
`npm run still -- out/frame.png --frame=600`.

## Where things are

| | |
|---|---|
| `src/config.ts` | Every text (English and French), scene lengths, ripple origins, palette, fonts, loudness |
| `src/timeline.ts` | Every cue in frames, the rain curve and the logo's fill law: shared by the picture and the sound |
| `src/BruinePromo.tsx` | The film: backdrop, mist, rain, six scenes, transitions, grain, soundtrack |
| `src/scenes/` | `Intro`, `Models`, `Demo`, `Effort`, `Promises`, `Outro` |
| `src/components/Rain.tsx` | The rain (after `src/ui/rain.ts`), with rings where drops land, and blurred drops in front of the lens |
| `src/components/Wordmark.tsx` | The BRUINE mark drawn from its box-drawing cells, filling in under the rain (after `src/ui/logo-motion.ts`), with a light sweep and a reflection on wet ground |
| `src/components/Atmosphere.tsx` | Mist, distant lightning, grain, vignette, and the ripple that carries one scene into the next |
| `src/components/Glow.tsx` | The prompt frame's effort glow (after `src/ui/border-glow.ts`) |
| `scripts/soundtrack.ts` | The synthesizer and the score |

## The script

1. **Intro** (6.6 s). One drop falls in the dark and rings out; *bruine*, as a dictionary gives it. The rain collects into the mark, light crosses it.
2. **Models** (6.2 s). Bruine in the middle, llama.cpp and your MCP servers on one side, the cloud providers around it, each landing like a drop.
3. **Demo** (13.2 s). A session in the real interface, filmed by a camera that follows it: reasoning, a second prompt queued while it works, tools, diff, the permission prompt, the tests, the measured speed, then the queued prompt going out.
4. **Effort** (5.8 s). The harder it thinks, the harder it rains: `ctrl+e` from `low` to `max`, the frame glows as in the terminal, the storm comes.
5. **Promises** (7.2 s). Measured not quoted, one permission gate, a prompt cache that survives.
6. **Outro** (6.8 s). The mark on wet ground, `npm install -g bruine`, `bruine`, and the rain stops.

A drop opens every scene: the next one spreads out from where it lands.

## The sound

Rain whose density follows the rain on screen, droplets, a chord pad that changes with each
scene, a falling drop for every scene change, a tick for every letter of the logo as it fills,
keystrokes on the frames the characters appear, tool and test chimes, the permission bell, the
`ctrl+e` steps, thunder at `max`, and a resolving chord at the end. The master is compressed and
levelled to about -16 LUFS with peaks under -1 dBFS, which suits YouTube.
