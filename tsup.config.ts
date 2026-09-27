import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    bin: "src/bin.ts",
    "plugins/startup": "src/plugins/startup.ts",
    "plugins/repl": "src/plugins/repl.ts",
    "plugins/headless": "src/plugins/headless.ts",
    "plugins/render": "src/plugins/render.ts",
    "plugins/approval": "src/plugins/approval.ts",
    "plugins/herdr": "src/plugins/herdr.ts",
    "plugins/modes": "src/plugins/modes.ts",
    "plugins/web-search": "src/plugins/web-search.ts",
  },
  format: ["esm"],
  clean: true,
  splitting: false,
});
