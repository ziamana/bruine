import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/bin.ts"],
  format: ["esm"],
  clean: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
