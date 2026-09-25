import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    bin: "src/bin.ts",
    "plugins/startup": "src/plugins/startup.ts",
    "plugins/repl": "src/plugins/repl.ts",
    "plugins/render": "src/plugins/render.ts",
    "plugins/approval": "src/plugins/approval.ts",
  },
  format: ["esm"],
  clean: true,
  splitting: false,
});
