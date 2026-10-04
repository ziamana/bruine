export type SceneName = "intro" | "models" | "demo" | "effort" | "promises" | "outro";

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
  overlap: 0.7,
  scenes: {
    intro: 6.6,
    models: 6.2,
    demo: 14.6,
    effort: 5.8,
    promises: 5.6,
    outro: 6.8,
  },
} as const;

/**
 * Where the drop lands that opens each scene: the next scene spreads out from that point in a
 * ripple. In pixels on the 1920x1080 frame.
 */
export const RIPPLE_ORIGIN: Record<SceneName, [number, number]> = {
  intro: [960, 540],
  models: [960, 540],
  demo: [1180, 300],
  effort: [960, 560],
  promises: [960, 470],
  outro: [960, 400],
};

/** The soundtrack: synthesized by scripts/soundtrack.ts from the same timeline as the picture. */
export const AUDIO = {
  sampleRate: 48000,
  /** Peak of the final mix, in dBFS. */
  peakDb: -2,
  /** Where the loud end of the film sits (400 ms RMS, 90th percentile), in dBFS. */
  loudDb: -15,
} as const;

export const SCENE_ORDER: SceneName[] = ["intro", "models", "demo", "effort", "promises", "outro"];

/**
 * The two films made from the same scenes: the full presentation, and a fifteen-second cut for
 * Shorts and feeds (the name, the rain that follows the effort, the command that starts it).
 * A scene keeps its own cues in either; a shorter scene only ends sooner.
 */
export type CutName = "full" | "short";
export const CUTS: Record<CutName, { id: string; order: SceneName[]; seconds: Partial<Record<SceneName, number>> }> = {
  full: { id: VIDEO.id, order: SCENE_ORDER, seconds: TIMING.scenes },
  short: { id: "BruineShort", order: ["intro", "effort", "outro"], seconds: { intro: 6.0, effort: 5.2, outro: 5.2 } },
};

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

/** Inter and JetBrains Mono, shipped in public/fonts and loaded by src/fonts.ts; nothing is fetched. */
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
    mcpLabel: string;
    mcpName: string;
    mcpDetail: string;
    cloudLabel: string;
    providers: string[];
    more: string;
    compat: string;
    footnote: string;
  };
  demo: {
    title: string;
    titleBody: string;
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
    queued: string;
    queuedLabel: string;
    queuedHint: string;
    queuedAnswer: string;
    footerLeft: string;
    footerRight: string;
    enterKey: string;
    callouts: Array<{ title: string; body: string }>;
  };
  effort: {
    title: string;
    sub: string;
    prompt: string;
    label: string;
    levels: string[];
    keys: string[];
    weather: string;
  };
  promises: {
    title: string;
    body: string;
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
    mcpLabel: "MCP",
    mcpName: "your MCP servers",
    mcpDetail: "tools behind the same permission gate",
    cloudLabel: "Cloud",
    providers: ["DeepSeek", "Anthropic", "OpenAI", "Google", "OpenRouter", "Groq", "Mistral", "xAI"],
    more: "about 30 providers in all",
    compat: "or anything that speaks the OpenAI-compatible /v1 API",
    footnote: "No account. Nothing is sent anywhere you did not point it at.",
  },
  demo: {
    title: "A real session.",
    titleBody: "Recorded in a terminal, cell by cell. Nothing here is mocked up.",
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
    queued: "then document it in the README",
    queuedLabel: "next",
    queuedHint: "↑ edit the last  ·  esc stop, and take them back",
    queuedAnswer: "Added a Retries section to the README: three attempts, 250 ms then 500 ms.",
    footerLeft: "ask  12%/262k (auto)  (local) qwen3-coder · high",
    footerRight: "tok/s  ·  cache 94%",
    enterKey: "Enter",
    callouts: [
      { title: "Thinking, live", body: "The reasoning streams word by word, then folds into one line." },
      { title: "Keep typing", body: "A prompt sent while it works waits, then goes out when the turn ends." },
      { title: "Every edit, as a diff", body: "Shown before it is written, so you approve what you read." },
      { title: "It asks first", body: "y allows it once. a remembers that one command. Esc says no." },
      { title: "Measured, live", body: "Context, speed and cache, timed by bruine itself." },
    ],
  },
  effort: {
    title: "The harder it thinks, the harder it rains.",
    sub: "ctrl+e cycles the reasoning effort. The prompt frame follows it, and with /effect auto the rain does too.",
    prompt: "Refactor the session store",
    label: "effort",
    levels: ["low", "medium", "high", "xhigh", "max"],
    keys: ["ctrl", "e"],
    weather: "Or pick the weather yourself:  /effect bruine · pluie · foudre",
  },
  promises: {
    title: "Your cache survives.",
    body: "The system prompt and the tools stay byte-identical for the whole session, so every turn starts from the cache. A test asserts it.",
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
    mcpLabel: "MCP",
    mcpName: "vos serveurs MCP",
    mcpDetail: "des outils derrière la même barrière",
    cloudLabel: "Cloud",
    providers: ["DeepSeek", "Anthropic", "OpenAI", "Google", "OpenRouter", "Groq", "Mistral", "xAI"],
    more: "une trentaine de fournisseurs en tout",
    compat: "ou toute API compatible OpenAI /v1",
    footnote: "Aucun compte. Rien ne part ailleurs que là où vous l'avez dirigé.",
  },
  demo: {
    title: "Une vraie session.",
    titleBody: "Enregistrée dans un terminal, cellule par cellule. Rien n'est maquetté.",
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
    queued: "puis documente-le dans le README",
    queuedLabel: "next",
    queuedHint: "↑ edit the last  ·  esc stop, and take them back",
    queuedAnswer: "Section Retries ajoutée au README : trois essais, 250 ms puis 500 ms.",
    footerLeft: "ask  12%/262k (auto)  (local) qwen3-coder · high",
    footerRight: "tok/s  ·  cache 94%",
    enterKey: "Entrée",
    callouts: [
      { title: "La réflexion, en direct", body: "Le raisonnement s'écrit mot à mot, puis se replie en une ligne." },
      { title: "Continuez à écrire", body: "Un prompt envoyé pendant le travail attend, puis part à la fin du tour." },
      { title: "Chaque modification en diff", body: "Montrée avant d'être écrite : vous approuvez ce que vous lisez." },
      { title: "Il demande d'abord", body: "y autorise une fois. a retient cette commande-là. Échap refuse." },
      { title: "Mesuré, en direct", body: "Contexte, vitesse et cache, chronométrés par bruine lui-même." },
    ],
  },
  effort: {
    title: "Plus il réfléchit, plus il pleut.",
    sub: "ctrl+e change l'effort de réflexion. Le cadre du prompt suit, et avec /effect auto la pluie aussi.",
    prompt: "Refactor the session store",
    label: "effort",
    levels: ["low", "medium", "high", "xhigh", "max"],
    keys: ["ctrl", "e"],
    weather: "Ou choisissez la météo :  /effect bruine · pluie · foudre",
  },
  promises: {
    title: "Votre cache survit.",
    body: "Le prompt système et les outils restent identiques à l'octet près toute la session : chaque tour repart du cache. Un test le vérifie.",
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

/**
 * Where every scene of a cut starts and how long it lasts, in frames. A scene the cut leaves out
 * is absent; the full film has them all.
 */
export function sceneFrames(cut: CutName = "full"): Record<SceneName, { from: number; duration: number }> {
  const overlap = Math.round(TIMING.overlap * VIDEO.fps);
  const out = {} as Record<SceneName, { from: number; duration: number }>;
  let from = 0;
  for (const name of CUTS[cut].order) {
    const duration = Math.round(CUTS[cut].seconds[name]! * VIDEO.fps);
    out[name] = { from, duration };
    from += duration - overlap;
  }
  return out;
}

export function totalFrames(cut: CutName = "full"): number {
  const order = CUTS[cut].order;
  const last = sceneFrames(cut)[order[order.length - 1]!];
  return last.from + last.duration;
}

/** Overlap between scenes, in frames: the length of each crossfade. */
export const FADE = Math.round(TIMING.overlap * VIDEO.fps);
