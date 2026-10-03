import { configDefaults, defineConfig } from "vitest/config";

const e2e = process.argv.some((arg) => arg.replaceAll("\\", "/").replace(/\/$/, "") === "test/e2e");
export default defineConfig({
  test: e2e ? {
    include: ["test/e2e/**/*.test.ts"],
    fileParallelism: false,
    sequence: { concurrent: false },
    bail: 0,
    testTimeout: 45_000,
    hookTimeout: 60_000,
    // Real bruine processes: basic colors keep screen assertions stable.
    env: { BRUINE_COLOR: "basic" },
  } : {
    exclude: [...configDefaults.exclude, "test/e2e/**"],
    // Unit tests assert the 16-color codes; palette.test.ts covers 256 and 24-bit. The ring a
    // finished turn leaves keeps repainting for a second, so it is off unless a test asks.
    // A UTF-8 locale, so the glyphs under test are the same on every runner (a container or a
    // Windows runner with no locale would otherwise get the ASCII fallback everywhere).
    env: { BRUINE_COLOR: "basic", BRUINE_NO_RIPPLE: "1", BRUINE_INTRO: "off", BRUINE_NO_GLOW: "1", LANG: "C.UTF-8" },
  },
});
