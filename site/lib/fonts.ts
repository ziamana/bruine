import localFont from "next/font/local";

/** JetBrains Mono (the terminal, and every display line) and Inter (prose), the faces of the film. Self-hosted, OFL. */
export const mono = localFont({
  src: [
    { path: "../fonts/JetBrainsMonoNL-Regular.woff2", weight: "400", style: "normal" },
    { path: "../fonts/JetBrainsMonoNL-Bold.woff2", weight: "700", style: "normal" },
    { path: "../fonts/JetBrainsMonoNL-Italic.woff2", weight: "400", style: "italic" },
  ],
  variable: "--font-mono",
  display: "swap",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
});

export const sans = localFont({
  src: [
    { path: "../fonts/inter-latin-wght-normal.woff2", weight: "100 900", style: "normal" },
  ],
  variable: "--font-sans",
  display: "swap",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
});
