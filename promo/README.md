# Bruine presentation video

A Remotion project that renders Bruine's presentation video for YouTube: 1920x1080, 45 fps,
about 41 seconds. Everything on screen is drawn in code (React, SVG, CSS): no image, font, audio
or other asset is loaded, and fonts come from the system stack.

```
cd promo
npm install
npm run studio        # preview and scrub in Remotion Studio
npm run render        # out/bruine-promo.mp4 (H.264, CRF 16, yuv420p)
npm run check         # typecheck, and no em dash in any text shown on screen
```

A single frame: `npx remotion still BruinePromo out/frame.png --frame=600`.
The French cut: add `--props='{"lang":"fr"}'` to `render` or `still`.

## Where things are

| | |
|---|---|
| `src/config.ts` | Every text (English and French), scene lengths, palette and fonts |
| `src/BruinePromo.tsx` | The film: one rain under six scenes |
| `src/scenes/` | `Intro`, `Models`, `Demo`, `Effort`, `Promises`, `Outro` |
| `src/components/Rain.tsx` | The weather, a pure function of the frame (after `src/ui/rain.ts`) |
| `src/components/Wordmark.tsx` | The BRUINE mark drawn from its box-drawing cells, filling in under the rain (after `src/ui/logo-motion.ts`) |
| `src/components/Glow.tsx` | The prompt frame's effort glow (after `src/ui/border-glow.ts`) |
| `src/lib/motion.ts` | Easing helpers, the seeded hash, and the rain level over the whole film |

## The script

1. **Intro** (6 s). *bruine*, as a dictionary gives it: a fine, steady rain. The rain collects into the mark.
2. **Models** (6.4 s). Local llama.cpp, the cloud providers, or any OpenAI compatible `/v1` API. Each lands like a drop.
3. **Demo** (12.6 s). A session in the real interface: live reasoning that folds to `Thought for 4.2s`, tool calls, a diff, the permission prompt, the tests, the answer, the measured tok/s.
4. **Effort** (5.6 s). The harder it thinks, the harder it rains: the effort steps from `low` to `max`, the frame glows as in the terminal, and the film's rain follows.
5. **Promises** (7.6 s). Measured not quoted, one permission gate, a prompt cache that survives.
6. **Outro** (6.2 s). The mark, `npm install -g bruine`, `bruine`, and the rain stops.

Scenes overlap by 0.6 s: the old one fades out, the rain is alone for a breath, the new one fades in.
Change a length in `TIMING` and every scene, the rain and the total follow.
