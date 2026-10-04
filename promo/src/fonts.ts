import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

/**
 * The film's two faces, shipped in public/fonts (both SIL OFL 1.1, licences beside them) and
 * loaded before the first frame is drawn, so the render never falls back to whatever sans the
 * machine happens to have. Nothing is fetched from the network.
 *
 * Inter for the words; JetBrains Mono (the no-ligature cut, as a terminal draws it) for every
 * character a terminal would show. Glyphs it lacks (⏎ ↯ ∴ ⎿ ↳, the braille spinner) fall back
 * to the system mono, as they would in a real terminal.
 */
const LATIN = "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";
const LATIN_EXT = "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF";

export const fontsLoaded = Promise.all([
  loadFont({ family: "Inter", url: staticFile("fonts/inter-latin-wght-normal.woff2"), weight: "100 900", unicodeRange: LATIN }),
  loadFont({ family: "Inter", url: staticFile("fonts/inter-latin-ext-wght-normal.woff2"), weight: "100 900", unicodeRange: LATIN_EXT }),
  loadFont({ family: "JetBrains Mono", url: staticFile("fonts/JetBrainsMonoNL-Regular.woff2"), weight: "400" }),
  loadFont({ family: "JetBrains Mono", url: staticFile("fonts/JetBrainsMonoNL-Bold.woff2"), weight: "700" }),
  loadFont({ family: "JetBrains Mono", url: staticFile("fonts/JetBrainsMonoNL-Italic.woff2"), weight: "400", style: "italic" }),
]);
