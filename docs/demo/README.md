# The README demo

`bruine.svg` is the real bruine in a real terminal (node-pty, 100×30) on a little project, with a
scripted model so it is the same every time. To record it again after a UI change:

```
RECORD_DEMO=1 pnpm vitest run test/e2e -t "record the README demo"   # writes bruine.cast
npx svg-term-cli@2.1.1 --in docs/demo/bruine.cast --out docs/demo/bruine.svg --window --width 100 --height 30 --padding 18
```

The script is [`test/e2e/demo-recording.test.ts`](../../test/e2e/demo-recording.test.ts): what is typed,
what the model answers, and when the permission prompts are accepted. It is skipped unless
`RECORD_DEMO=1`, so the e2e suite never runs it.
