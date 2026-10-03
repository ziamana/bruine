/**
 * Everything the video says and every number it is timed by, in one place.
 *
 * Copy rule: no em dash (U+2014) in anything shown on screen. `npm run check:copy` enforces it.
 */

export const VIDEO = {
  id: "BruinePromo",
  width: 1920,
  height: 1080,
  fps: 45,
} as const;

/** Scene lengths in seconds, in playing order. Consecutive scenes overlap by `overlap`. */
export const TIMING = {
  overlap: 0.6,
  scenes: {
    intro: 6,
    models: 6.4,
    demo: 12.6,
    effort: 5.6,
    promises: 7.6,
    outro: 6.2,
  },
} as const;

export type SceneName = keyof typeof TIMING.scenes;
export const SCENE_ORDER: SceneName[] = ["intro", "models", "demo", "effort", "promises", "outro"];

/** Bruine's "Nuage" palette (src/ui/palette.ts), plus the video's own backdrop. */
export const COLORS = {
  night: "#0b0d14",
  nightGlow: "#1a1830",
  window: "#11141e",
  windowEdge: "#262c3f",
  surface: "#1c2030",
  chip: "#262c3f",
  sky: "#7dcfff",
  skyDeep: "#4aa8e0",
  lavender: "#b4a7ff",
  violetDeep: "#6f5fd6",
  violetLight: "#d9d0ff",
  pink: "#ff9ed2",
  mint: "#8fe3a3",
  amber: "#f2cf73",
  rose: "#ff7a90",
  text: "#e6e9f2",
  muted: "#8a90a6",
  faint: "#676e87",
  addBg: "#17361f",
  addFg: "#b8f0c6",
  delBg: "#3a1820",
  delFg: "#ffb3c0",
  toolOk: "#152b1e",
} as const;

/** The wordmark's gradient (LOGO_STOPS) and the `max` effort spectrum (border-glow.ts). */
export const LOGO_STOPS = ["#7dcfff", "#b4a7ff", "#ff9ed2", "#7dcfff"] as const;
export const SPECTRUM = ["#7dcfff", "#b4a7ff", "#ff9ed2", "#ffd27d", "#a6e3a1", "#7dcfff"] as const;

/** System stacks only: nothing is fetched. */
export const FONTS = {
  sans: '"Inter", "SF Pro Display", "Segoe UI", "Helvetica Neue", "Liberation Sans", "DejaVu Sans", Arial, sans-serif',
  mono: '"JetBrains Mono", "SF Mono", "Cascadia Code", "DejaVu Sans Mono", Menlo, Consolas, monospace',
} as const;

export type Lang = "en" | "fr";

export interface Copy {
  intro: {
    word: string;
    phonetic: string;
    kind: string;
    definition: string;
    tagline: string;
    sub: string;
  };
  models: {
    title: string;
    localLabel: string;
    localName: string;
    localAddress: string;
    localDetail: string;
    cloudLabel: string;
    providers: string[];
    more: string;
    compat: string;
    footnote: string;
  };
  demo: {
    project: string;
    hints: string;
    prompt: string;
    reasoning: string[];
    thinking: string;
    thought: string;
    read: { verb: string; target: string; time: string };
    edit: { verb: string; target: string; stat: string };
    diff: Array<{ kind: "add" | "del" | "ctx"; text: string }>;
    bash: { verb: string; target: string; time: string; output: string };
    approval: { question: string; options: string[] };
    answer: string[];
    footerLeft: string;
    footerRight: string;
    callouts: Array<{ title: string; body: string }>;
  };
  effort: {
    title: string;
    sub: string;
    prompt: string;
    label: string;
    levels: string[];
    weather: string;
  };
  promises: {
    title: string;
    cards: Array<{ title: string; body: string }>;
    speed: { quoted: string; measured: string; unit: string; quotedLabel: string; measuredLabel: string };
    rules: Array<{ command: string; verdict: "allow" | "ask" | "deny"; label: string }>;
    cache: { turn: string; system: string; tools: string; same: string };
  };
  outro: {
    install: string;
    run: string;
    line: string;
    meta: string;
    url: string;
  };
}

const en: Copy = {
  intro: {
    word: "bruine",
    phonetic: "/bʁɥin/",
    kind: "noun, French",
    definition: "A fine, steady rain.",
    tagline: "The coding agent for your terminal.",
    sub: "It runs your models, edits your files, and asks before anything risky.",
  },
  models: {
    title: "Point it at any model.",
    localLabel: "Local",
    localName: "llama.cpp",
    localAddress: "localhost:8080",
    localDetail: "found by the setup wizard",
    cloudLabel: "Cloud",
    providers: ["DeepSeek", "Anthropic", "OpenAI", "Google", "OpenRouter", "Groq", "Mistral", "xAI"],
    more: "and about twenty more",
    compat: "or anything that speaks the OpenAI compatible /v1 API",
    footnote: "No account. Nothing is sent anywhere you did not point it at.",
  },
  demo: {
    project: "~/code/api",
    hints: "escape interrupt · ctrl+c clear · ctrl+d exit · / commands",
    prompt: "Add a retry with backoff to fetchJson, then run the tests",
    reasoning: [
      "fetchJson gives up on the first 503. Wrap the call in a loop,",
      "wait 250 ms, then double it, and stop after three attempts.",
      "Keep the signature so no caller has to change.",
    ],
    thinking: "Thinking",
    thought: "Thought for 4.2s",
    read: { verb: "read", target: "src/http.ts", time: "0.2s" },
    edit: { verb: "edit", target: "src/http.ts", stat: "+5 -1" },
    diff: [
      { kind: "del", text: "  const res = await fetch(url, init);" },
      { kind: "add", text: "  for (let attempt = 0; ; attempt += 1) {" },
      { kind: "add", text: "    const res = await fetch(url, init);" },
      { kind: "add", text: "    if (res.ok || attempt === 2) return parse(res);" },
      { kind: "add", text: "    await sleep(250 * 2 ** attempt);" },
      { kind: "add", text: "  }" },
    ],
    bash: { verb: "bash", target: "npm test", time: "2.1s", output: "48 passed" },
    approval: {
      question: "Allow bash: npm test",
      options: ["Allow once", "Always for this session", "Reject"],
    },
    answer: [
      "fetchJson now retries twice more after a failure, 250 ms then 500 ms apart.",
      "The 48 tests pass.",
    ],
    footerLeft: "ask  12%/262k (auto)  (local) qwen3-coder · high",
    footerRight: "tok/s  ·  cache 94%",
    callouts: [
      { title: "Thinking, live", body: "The reasoning streams word by word, then folds into one line." },
      { title: "Tool calls you can read", body: "Each call reads as a sentence, with its duration and a coloured rail." },
      { title: "Every edit, as a diff", body: "Added and removed lines carry the same weight." },
      { title: "It asks first", body: "Ask, Auto or Full access, from a rule table you can read." },
      { title: "Measured, live", body: "Context, tok/s and cache hits, timed by Bruine itself." },
    ],
  },
  effort: {
    title: "The harder it thinks, the harder it rains.",
    sub: "ctrl+e cycles the reasoning effort. The rain and the prompt frame follow it.",
    prompt: "Refactor the session store",
    label: "effort",
    levels: ["low", "medium", "high", "xhigh", "max"],
    weather: "Or pick the weather yourself:  /effect bruine · pluie · foudre",
  },
  promises: {
    title: "Three promises.",
    cards: [
      { title: "Measured, not quoted.", body: "The speed in the footer comes from Bruine's own clock, not from the harness." },
      { title: "One permission gate.", body: "A rule table you can read and test. Nothing risky is guessed about." },
      { title: "Your cache survives.", body: "System prompt and tools stay byte-identical for the whole session. A test asserts it." },
    ],
    speed: { quoted: "79", measured: "60", unit: "tok/s", quotedLabel: "reported", measuredLabel: "measured" },
    rules: [
      { command: "npm test", verdict: "allow", label: "allow" },
      { command: "git push --force", verdict: "ask", label: "ask" },
      { command: "cat ../.env", verdict: "deny", label: "outside" },
    ],
    cache: { turn: "turn", system: "system", tools: "tools", same: "same bytes, every turn" },
  },
  outro: {
    install: "npm install -g bruine",
    run: "bruine",
    line: "Calm, precise, and running on your models.",
    meta: "MIT  ·  Node 22+  ·  Windows, macOS, Linux",
    url: "github.com/ziamana/bruine",
  },
};

const fr: Copy = {
  intro: {
    word: "bruine",
    phonetic: "/bʁɥin/",
    kind: "nom féminin",
    definition: "Pluie très fine et régulière.",
    tagline: "L'agent de code de votre terminal.",
    sub: "Il fait tourner vos modèles, modifie vos fichiers et demande avant tout ce qui est risqué.",
  },
  models: {
    title: "Branchez le modèle de votre choix.",
    localLabel: "Local",
    localName: "llama.cpp",
    localAddress: "localhost:8080",
    localDetail: "détecté par l'assistant d'installation",
    cloudLabel: "Cloud",
    providers: ["DeepSeek", "Anthropic", "OpenAI", "Google", "OpenRouter", "Groq", "Mistral", "xAI"],
    more: "et une vingtaine d'autres",
    compat: "ou toute API compatible OpenAI /v1",
    footnote: "Aucun compte. Rien ne part ailleurs que là où vous l'avez dirigé.",
  },
  demo: {
    project: "~/code/api",
    hints: "escape interrupt · ctrl+c clear · ctrl+d exit · / commands",
    prompt: "Ajoute un retry avec backoff à fetchJson, puis lance les tests",
    reasoning: [
      "fetchJson abandonne au premier 503. Mettre l'appel dans une boucle,",
      "attendre 250 ms, puis doubler, et s'arrêter après trois essais.",
      "Garder la signature pour qu'aucun appelant ne change.",
    ],
    thinking: "Thinking",
    thought: "Thought for 4.2s",
    read: { verb: "read", target: "src/http.ts", time: "0.2s" },
    edit: { verb: "edit", target: "src/http.ts", stat: "+5 -1" },
    diff: en.demo.diff,
    bash: { verb: "bash", target: "npm test", time: "2.1s", output: "48 passed" },
    approval: {
      question: "Allow bash: npm test",
      options: ["Allow once", "Always for this session", "Reject"],
    },
    answer: [
      "fetchJson réessaie deux fois après un échec, à 250 ms puis 500 ms d'écart.",
      "Les 48 tests passent.",
    ],
    footerLeft: "ask  12%/262k (auto)  (local) qwen3-coder · high",
    footerRight: "tok/s  ·  cache 94%",
    callouts: [
      { title: "La réflexion, en direct", body: "Le raisonnement s'écrit mot à mot, puis se replie en une ligne." },
      { title: "Des appels lisibles", body: "Chaque outil se lit comme une phrase, avec sa durée et un rail coloré." },
      { title: "Chaque modification en diff", body: "Lignes ajoutées et retirées, avec le même poids." },
      { title: "Il demande d'abord", body: "Ask, Auto ou Full access, selon une table de règles lisible." },
      { title: "Mesuré, en direct", body: "Contexte, tok/s et cache, chronométrés par Bruine lui-même." },
    ],
  },
  effort: {
    title: "Plus il réfléchit, plus il pleut.",
    sub: "ctrl+e change l'effort de réflexion. La pluie et le cadre du prompt suivent.",
    prompt: "Refactor the session store",
    label: "effort",
    levels: ["low", "medium", "high", "xhigh", "max"],
    weather: "Ou choisissez la météo :  /effect bruine · pluie · foudre",
  },
  promises: {
    title: "Trois promesses.",
    cards: [
      { title: "Mesuré, pas recopié.", body: "La vitesse affichée vient de l'horloge de Bruine, pas de celle du harness." },
      { title: "Une seule barrière.", body: "Une table de règles lisible et testée. Rien de risqué n'est deviné." },
      { title: "Votre cache survit.", body: "Prompt système et outils restent identiques à l'octet près. Un test le vérifie." },
    ],
    speed: { quoted: "79", measured: "60", unit: "tok/s", quotedLabel: "annoncé", measuredLabel: "mesuré" },
    rules: [
      { command: "npm test", verdict: "allow", label: "allow" },
      { command: "git push --force", verdict: "ask", label: "ask" },
      { command: "cat ../.env", verdict: "deny", label: "outside" },
    ],
    cache: { turn: "tour", system: "system", tools: "tools", same: "mêmes octets, à chaque tour" },
  },
  outro: {
    install: "npm install -g bruine",
    run: "bruine",
    line: "Calme, précis, et sur vos propres modèles.",
    meta: "MIT  ·  Node 22+  ·  Windows, macOS, Linux",
    url: "github.com/ziamana/bruine",
  },
};

export const COPY: Record<Lang, Copy> = { en, fr };

/** Where every scene starts and how long it lasts, in frames. */
export function sceneFrames(): Record<SceneName, { from: number; duration: number }> {
  const overlap = Math.round(TIMING.overlap * VIDEO.fps);
  const out = {} as Record<SceneName, { from: number; duration: number }>;
  let from = 0;
  for (const name of SCENE_ORDER) {
    const duration = Math.round(TIMING.scenes[name] * VIDEO.fps);
    out[name] = { from, duration };
    from += duration - overlap;
  }
  return out;
}

export function totalFrames(): number {
  const last = sceneFrames()[SCENE_ORDER[SCENE_ORDER.length - 1]!];
  return last.from + last.duration;
}

/** Overlap between scenes, in frames: the length of each crossfade. */
export const FADE = Math.round(TIMING.overlap * VIDEO.fps);
