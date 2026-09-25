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
  } : {
    exclude: [...configDefaults.exclude, "test/e2e/**"],
  },
});
