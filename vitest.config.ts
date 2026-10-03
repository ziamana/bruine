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
    // Real kumo processes: basic colors keep screen assertions stable.
    env: { KUMO_COLOR: "basic" },
  } : {
    exclude: [...configDefaults.exclude, "test/e2e/**"],
    // Unit tests assert the 16-color codes; palette.test.ts covers 256 and 24-bit. The ring a
    // finished turn leaves keeps repainting for a second, so it is off unless a test asks.
    env: { KUMO_COLOR: "basic", KUMO_NO_RIPPLE: "1" },
  },
});
