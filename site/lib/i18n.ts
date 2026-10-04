export const LANGS = ["en", "fr"] as const;
export type Lang = (typeof LANGS)[number];
export const isLang = (value: string): value is Lang => (LANGS as readonly string[]).includes(value);

export const REPO = "https://github.com/ziamana/bruine";
export const VERSION = "0.1.0";

/** A path inside the site, under the base path the export was built for. */
export const asset = (path: string): string => `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`;

export type Installer = "npm" | "pnpm" | "bun";
export const INSTALL: Record<Installer, string> = {
  npm: "npm install -g bruine",
  pnpm: "pnpm add -g bruine",
  bun: "bun add -g bruine",
};

export interface Chapter {
  id: string;
  title: string;
  body: string;
  /** What the terminal shows: a stretch of the recording (seconds), a still, or the weather film. */
  screen: { tape: [number, number] } | { still: "retry" | "image" | "light" } | { weather: true };
}

export interface Dict {
  meta: { title: string; description: string };
  nav: { guide: string; compare: string; changelog: string; github: string; skip: string; language: string; other: string };
  hero: { title: string; lead: string; said: string; facts: string[] };
  band: {
    title: string;
    copy: string;
    other: (next: Installer) => string;
    later: string;
    keys: string;
    copied: string;
    failed: string;
    label: string;
  };
  session: { title: string; lead: string; chapters: Chapter[]; still: string; noscript: string };
  film: { title: string; lead: string; caption: string };
  models: {
    title: string;
    lead: string;
    providers: string;
    promises: { reading: string; title: string; body: string }[];
  };
  behind: { title: string; lead: string; items: string[]; fit: string; compare: string };
  faq: { title: string; items: { q: string; a: string }[] };
  close: { title: string; lead: string };
  footer: { line: string; built: string; license: string };
}

const en: Dict = {
  meta: {
    title: "bruine: a coding agent for your terminal that runs your own models",
    description:
      "bruine reads and edits your code, runs your commands and asks before anything risky, on llama.cpp, any /v1 server or about thirty cloud providers. MIT, no account.",
  },
  nav: { guide: "Guide", compare: "Compare", changelog: "Changelog", github: "GitHub", skip: "Skip to the content", language: "Language", other: "Français" },
  hero: {
    title: "A coding agent for your terminal that runs your own models.",
    lead:
      "Point it at llama.cpp on your machine, at about thirty cloud providers, or at anything that speaks the OpenAI-compatible /v1 API. It reads and edits your code, runs your commands, and asks before anything risky. There is no account, and nothing goes anywhere you did not point it at.",
    said: "bruine (French, /bʁɥin/): a fine, steady rain.",
    facts: ["MIT", "Node 22+", "Windows · macOS · Linux", `v${VERSION}`],
  },
  band: {
    title: "Allow bash",
    copy: "Copy the command",
    other: (next) => `Use ${next} instead`,
    later: "Not yet: read the guide",
    keys: "y · a · n",
    copied: "Copied. Paste it in a terminal, then type bruine: the first launch finds your model.",
    failed: "Your browser kept the clipboard to itself. Select the command and copy it by hand.",
    label: "Install bruine",
  },
  session: {
    title: "One session, as it ran.",
    lead: "This is the real bruine in a real terminal on a real project, recorded cell by cell. Scroll, and it plays.",
    still: "still",
    noscript: "The session plays with JavaScript on. Here it is at the end of the turn.",
    chapters: [
      {
        id: "ask",
        title: "You ask in plain words.",
        body: "Type what you want and press Enter. Here the model is a local Qwen3 Coder on one GPU; it could as well be DeepSeek, Claude or anything behind /v1.",
        screen: { tape: [0.2, 3.1] },
      },
      {
        id: "think",
        title: "It thinks out loud, then gets out of the way.",
        body: "Reasoning streams word by word while it happens, then folds into one line: Thought for 1s. The transcript stays readable after an hour.",
        screen: { tape: [3.1, 4.75] },
      },
      {
        id: "queue",
        title: "Keep typing while it works.",
        body: "A prompt sent during a turn waits above the box and goes out as its own turn when this one ends. ↑ takes it back to edit; Escape stops the turn and hands the queue back, unsent.",
        screen: { tape: [4.75, 6.4] },
      },
      {
        id: "approve",
        title: "Every edit is a diff, and it asks first.",
        body: "The request is the one framed thing on screen: y once, a always, n or Escape no. The turn's clock stops and the rain holds still while it waits for you.",
        screen: { tape: [6.4, 8.9] },
      },
      {
        id: "always",
        title: "“Always” says what it covers.",
        body: "For a shell command, always means that exact command for this session, never every command. The gate is a rule table in plain TypeScript, with tests: you can read why it asked.",
        screen: { tape: [8.9, 11.4] },
      },
      {
        id: "done",
        title: "Then the next prompt goes out.",
        body: "Each turn ends with what changed and what it cost: tools, time, tokens, cache hits. Then the prompt you queued runs, and the box is yours again.",
        screen: { tape: [11.4, 14] },
      },
      {
        id: "retry",
        title: "A quiet model is retried, out loud.",
        body: "How long bruine waits depends on what the model was doing, how hard it was asked to think and how many tries it has had. When it gives up, the transcript says why, which attempt, and when.",
        screen: { still: "retry" },
      },
      {
        id: "image",
        title: "It shows you what it looks at.",
        body: "An image the model reads is drawn right in the transcript, in any 24-bit or 256-colour terminal. No graphics protocol, no window: just colour. ctrl+v sends yours the other way.",
        screen: { still: "image" },
      },
      {
        id: "light",
        title: "Light or dark, it reads.",
        body: "bruine asks the terminal for its background and fits every colour to it. On 256-colour terminals the surfaces stay gray instead of turning navy.",
        screen: { still: "light" },
      },
      {
        id: "weather",
        title: "It rains as hard as it thinks.",
        body: "ctrl+e climbs the reasoning effort from low to max: the prompt's border glows, then runs every colour, and the drizzle turns into a storm. The weather is drawn locally, costs no tokens, and /effect off stops it.",
        screen: { weather: true },
      },
    ],
  },
  film: {
    title: "Forty-two seconds of it.",
    lead: "Made in code with Remotion. The demo inside the film is the same recording you just scrolled through.",
    caption: "Play the film, with sound",
  },
  models: {
    title: "Your model is not a degraded cloud.",
    lead:
      "Most agents are tuned for one provider and tolerate the rest. bruine is built for the model on your own GPU, and treats a cloud route the same way.",
    providers: "llama.cpp · any /v1 server · DeepSeek · Anthropic · OpenAI · Google · OpenRouter · Groq · Mistral · xAI · and about twenty more",
    promises: [
      {
        reading: "↯ 53.6 tok/s",
        title: "The numbers are measured.",
        body: "Speed, prefill and cache hits come from bruine's own clock. The harness underneath once reported 79 tok/s where the truth was 60; bruine does not copy it.",
      },
      {
        reading: "cache 95.9%",
        title: "Your prompt cache survives.",
        body: "The system prompt and the tool list stay byte-identical for the whole session, and side requests stay off a single-slot server. A test spawns the real harness and checks the prefix never moves.",
      },
      {
        reading: "ask",
        title: "One gate, and you can read it.",
        body: "Ask, Auto or Full access, decided by one rule table: a plain read runs, a path outside the project asks, a dangerous command always asks, Plan mode refuses changes. MCP tools go through the same gate.",
      },
    ],
  },
  behind: {
    title: "What it does not do, yet.",
    lead: "bruine is 0.1, on top of a harness that is itself a developer preview. Better you hear it here.",
    items: [
      "No checkpoints or rewind: Git is your undo.",
      "No IDE or ACP integration: it lives in the terminal.",
      "MCP is tools only: no resources, prompts or OAuth login.",
      "No LSP.",
    ],
    fit: "If you mostly use Claude models in an IDE, Claude Code is the better fit; if you want a Git commit per edit, Aider is.",
    compare: "See the full comparison",
  },
  faq: {
    title: "Questions people ask",
    items: [
      { q: "Is it free?", a: "Yes, MIT, and everything that runs locally stays MIT. You pay your model provider, or nothing at all with a local model." },
      {
        q: "Does it send my code anywhere?",
        a: "Only to the model route you configured. Telemetry is off unless you turn it on in the setup, and looking for model servers on your network is opt-in and only touches private ranges.",
      },
      {
        q: "Which local model should I use?",
        a: "One trained for tool calls, served by llama.cpp or any OpenAI-compatible server, with a context of 32k or more. The setup detects what the server's chat template supports.",
      },
      { q: "Does it work on Windows?", a: "Yes: Windows Terminal, PowerShell and the classic console. Commands run in PowerShell there." },
      {
        q: "Can I reuse my Claude Code setup?",
        a: "Your skills, yes, and MCP servers in the same format, including a project's .mcp.json. Claude Code hooks are not run.",
      },
      {
        q: "What is dsh?",
        a: "DeepSeek Harness, the agent runtime underneath. bruine is a profile and a bundle of plugins on top of it, not a fork, so harness updates arrive without a merge.",
      },
      { q: "Why does it rain?", a: "Because it is called bruine. /effect off, or BRUINE_NO_ANIMATION=1, and the sky clears." },
    ],
  },
  close: { title: "Let it rain.", lead: "One command, then bruine. The setup finds a model server if you run one, or asks for a key." },
  footer: { line: "A fine, steady rain in your terminal.", built: "Built on DeepSeek Harness.", license: "MIT licensed" },
};

const fr: Dict = {
  meta: {
    title: "bruine : un agent de code pour ton terminal, avec tes propres modèles",
    description:
      "bruine lit et modifie ton code, lance tes commandes et demande avant tout ce qui est risqué, sur llama.cpp, n'importe quel serveur /v1 ou une trentaine de fournisseurs cloud. MIT, sans compte.",
  },
  nav: { guide: "Guide", compare: "Comparer", changelog: "Nouveautés", github: "GitHub", skip: "Aller au contenu", language: "Langue", other: "English" },
  hero: {
    title: "Un agent de code pour ton terminal, avec tes propres modèles.",
    lead:
      "Branche-le sur llama.cpp sur ta machine, sur une trentaine de fournisseurs cloud, ou sur tout ce qui parle l'API /v1 compatible OpenAI. Il lit et modifie ton code, lance tes commandes, et demande avant tout ce qui est risqué. Pas de compte, et rien ne part ailleurs que là où tu l'as dirigé.",
    said: "bruine (nom féminin) : une pluie fine et régulière.",
    facts: ["MIT", "Node 22+", "Windows · macOS · Linux", `v${VERSION}`],
  },
  band: {
    title: "Allow bash",
    copy: "Copier la commande",
    other: (next) => `Utiliser ${next} à la place`,
    later: "Pas encore : lire le guide",
    keys: "y · a · n",
    copied: "Copié. Colle-la dans un terminal, puis tape bruine : le premier lancement trouve ton modèle.",
    failed: "Ton navigateur garde le presse-papiers pour lui. Sélectionne la commande et copie-la à la main.",
    label: "Installer bruine",
  },
  session: {
    title: "Une session, telle qu'elle s'est passée.",
    lead: "Voici le vrai bruine, dans un vrai terminal, sur un vrai projet, enregistré cellule par cellule. Fais défiler : il se joue.",
    still: "capture",
    noscript: "La session se joue avec JavaScript activé. La voici à la fin du tour.",
    chapters: [
      {
        id: "ask",
        title: "Tu demandes, avec tes mots.",
        body: "Tape ce que tu veux et appuie sur Entrée. Ici le modèle est un Qwen3 Coder local sur un seul GPU ; ce pourrait être DeepSeek, Claude ou n'importe quoi derrière /v1.",
        screen: { tape: [0.2, 3.1] },
      },
      {
        id: "think",
        title: "Il réfléchit à voix haute, puis s'efface.",
        body: "Le raisonnement s'affiche mot à mot pendant qu'il se fait, puis se replie en une ligne : Thought for 1s. La conversation reste lisible au bout d'une heure.",
        screen: { tape: [3.1, 4.75] },
      },
      {
        id: "queue",
        title: "Continue de taper pendant qu'il travaille.",
        body: "Un message envoyé pendant un tour attend au-dessus de la boîte et part comme un tour à lui quand celui-ci finit. ↑ le reprend pour le modifier ; Échap arrête le tour et te rend la file, sans l'envoyer.",
        screen: { tape: [4.75, 6.4] },
      },
      {
        id: "approve",
        title: "Chaque modification est un diff, et il demande d'abord.",
        body: "La demande est la seule chose encadrée à l'écran : y une fois, a toujours, n ou Échap non. L'horloge du tour s'arrête et la pluie se fige pendant qu'il t'attend.",
        screen: { tape: [6.4, 8.9] },
      },
      {
        id: "always",
        title: "« Toujours » dit ce qu'il couvre.",
        body: "Pour une commande shell, toujours veut dire cette commande exacte pour cette session, jamais toutes les commandes. Le contrôle est une table de règles en TypeScript, avec des tests : tu peux lire pourquoi il a demandé.",
        screen: { tape: [8.9, 11.4] },
      },
      {
        id: "done",
        title: "Puis le message suivant part.",
        body: "Chaque tour se termine par ce qui a changé et ce que ça a coûté : outils, temps, tokens, cache. Puis le message mis en attente part, et la boîte est de nouveau à toi.",
        screen: { tape: [11.4, 14] },
      },
      {
        id: "retry",
        title: "Un modèle muet est relancé, à voix haute.",
        body: "Le temps que bruine attend dépend de ce que faisait le modèle, de l'effort de réflexion demandé et du nombre d'essais déjà faits. Quand il abandonne, la conversation dit pourquoi, quel essai, et quand.",
        screen: { still: "retry" },
      },
      {
        id: "image",
        title: "Il te montre ce qu'il regarde.",
        body: "Une image lue par le modèle est dessinée dans la conversation, dans n'importe quel terminal 24 bits ou 256 couleurs. Pas de protocole graphique, pas de fenêtre : juste de la couleur. ctrl+v envoie la tienne dans l'autre sens.",
        screen: { still: "image" },
      },
      {
        id: "light",
        title: "Clair ou sombre, il reste lisible.",
        body: "bruine demande au terminal sa couleur de fond et y ajuste chaque couleur. Sur les terminaux 256 couleurs, les surfaces restent grises au lieu de virer au bleu marine.",
        screen: { still: "light" },
      },
      {
        id: "weather",
        title: "Il pleut aussi fort qu'il réfléchit.",
        body: "ctrl+e fait monter l'effort de raisonnement de low à max : le cadre de la boîte s'illumine, puis passe par toutes les couleurs, et la bruine devient orage. La météo est dessinée en local, ne coûte aucun token, et /effect off l'arrête.",
        screen: { weather: true },
      },
    ],
  },
  film: {
    title: "Quarante-deux secondes.",
    lead: "Fait en code avec Remotion. La démo du film est le même enregistrement que celui que tu viens de faire défiler.",
    caption: "Lancer le film, avec le son",
  },
  models: {
    title: "Ton modèle n'est pas un cloud au rabais.",
    lead:
      "La plupart des agents sont réglés pour un fournisseur et tolèrent les autres. bruine est fait pour le modèle qui tourne sur ton GPU, et traite une route cloud de la même façon.",
    providers: "llama.cpp · tout serveur /v1 · DeepSeek · Anthropic · OpenAI · Google · OpenRouter · Groq · Mistral · xAI · et une vingtaine d'autres",
    promises: [
      {
        reading: "↯ 53.6 tok/s",
        title: "Les chiffres sont mesurés.",
        body: "Vitesse, pré-remplissage et cache viennent de la propre horloge de bruine. Le moteur en dessous annonçait un jour 79 tok/s quand la vérité était 60 ; bruine ne le recopie pas.",
      },
      {
        reading: "cache 95.9%",
        title: "Ton cache de prompt survit.",
        body: "Le prompt système et la liste d'outils restent identiques à l'octet près pendant toute la session, et les requêtes annexes ne passent pas par un serveur à un seul slot. Un test lance le vrai moteur et vérifie que le préfixe ne bouge jamais.",
      },
      {
        reading: "ask",
        title: "Un seul contrôle, et tu peux le lire.",
        body: "Ask, Auto ou Full access, décidé par une seule table de règles : une simple lecture passe, un chemin hors du projet demande, une commande dangereuse demande toujours, le mode Plan refuse les changements. Les outils MCP passent par le même contrôle.",
      },
    ],
  },
  behind: {
    title: "Ce qu'il ne fait pas, pas encore.",
    lead: "bruine est en 0.1, sur un moteur lui-même en préversion. Autant que tu l'apprennes ici.",
    items: [
      "Pas de points de reprise ni de retour en arrière : Git est ton annulation.",
      "Pas d'intégration IDE ni ACP : il vit dans le terminal.",
      "MCP, c'est les outils seulement : pas de ressources, de prompts ni de connexion OAuth.",
      "Pas de LSP.",
    ],
    fit: "Si tu utilises surtout les modèles Claude dans un IDE, Claude Code te conviendra mieux ; si tu veux un commit Git par modification, Aider.",
    compare: "Voir la comparaison complète",
  },
  faq: {
    title: "Les questions qu'on pose",
    items: [
      { q: "C'est gratuit ?", a: "Oui, MIT, et tout ce qui tourne en local reste MIT. Tu paies ton fournisseur de modèle, ou rien du tout avec un modèle local." },
      {
        q: "Est-ce qu'il envoie mon code quelque part ?",
        a: "Seulement à la route de modèle que tu as configurée. La télémétrie est coupée sauf si tu l'actives dans la configuration, et la recherche de serveurs sur ton réseau est facultative et ne touche que les plages privées.",
      },
      {
        q: "Quel modèle local utiliser ?",
        a: "Un modèle entraîné pour les appels d'outils, servi par llama.cpp ou un serveur compatible OpenAI, avec un contexte de 32k ou plus. La configuration détecte ce que le gabarit de chat du serveur supporte.",
      },
      { q: "Ça marche sous Windows ?", a: "Oui : Windows Terminal, PowerShell et la console classique. Les commandes y tournent dans PowerShell." },
      {
        q: "Je peux réutiliser ma config Claude Code ?",
        a: "Tes skills, oui, et les serveurs MCP au même format, y compris le .mcp.json d'un projet. Les hooks de Claude Code ne sont pas exécutés.",
      },
      {
        q: "C'est quoi, dsh ?",
        a: "DeepSeek Harness, le moteur d'agent en dessous. bruine est un profil et un ensemble de plugins par-dessus, pas un fork : les mises à jour du moteur arrivent sans fusion.",
      },
      { q: "Pourquoi il pleut ?", a: "Parce qu'il s'appelle bruine. /effect off, ou BRUINE_NO_ANIMATION=1, et le ciel se dégage." },
    ],
  },
  close: { title: "Laisse pleuvoir.", lead: "Une commande, puis bruine. La configuration trouve un serveur de modèle si tu en fais tourner un, ou te demande une clé." },
  footer: { line: "Une pluie fine et régulière dans ton terminal.", built: "Construit sur DeepSeek Harness.", license: "Licence MIT" },
};

export const DICTS: Record<Lang, Dict> = { en, fr };
