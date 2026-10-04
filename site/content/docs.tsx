import type { ReactNode } from "react";
import { Table, type DocSection } from "@/components/Doc";
import { asset, type Lang } from "@/lib/i18n";

const Fig = ({ src, alt, caption }: { src: string; alt: string; caption: ReactNode }) => (
  <figure>
    <img src={asset(src)} alt={alt} width="1181" height="784" loading="lazy" decoding="async" />
    <figcaption>{caption}</figcaption>
  </figure>
);

const MCP_JSON = `{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "\${GITHUB_TOKEN}" }
    },
    "docs": { "type": "http", "url": "https://example.com/mcp", "readOnly": true }
  }
}`;

const CLI = {
  en: `bruine                Start bruine. Extra args are passed through to dsh.
bruine --continue     Resume the latest conversation in this project.
bruine -p "task"      Run a task without the terminal UI and print its answer.
bruine -p -           Read a task from stdin.
bruine setup          (Re)run the setup wizard, pre-filled with your current values.
bruine skills         List the skills bruine has enabled.
bruine update         Update bruine through its installer.
bruine --version      Print the version.`,
  fr: `bruine                Lance bruine. Les autres arguments vont à dsh.
bruine --continue     Reprend la dernière conversation de ce projet.
bruine -p "tâche"     Exécute une tâche sans l'interface et affiche la réponse.
bruine -p -           Lit la tâche sur l'entrée standard.
bruine setup          (Re)lance l'assistant de configuration, prérempli.
bruine skills         Liste les skills activés.
bruine update         Met bruine à jour avec son installateur.
bruine --version      Affiche la version.`,
};

const ENV: [string, { en: string; fr: string }][] = [
  ["BRUINE_HOME", { en: "Where bruine keeps its config (default ~/.bruine)", fr: "Où bruine garde sa configuration (par défaut ~/.bruine)" }],
  ["BRUINE_ASCII=1", { en: "Plain-ASCII glyphs instead of symbols", fr: "Des caractères ASCII simples au lieu des symboles" }],
  ["BRUINE_NO_ANIMATION=1", { en: "No rain, header or spinner animation", fr: "Ni pluie, ni animation d'en-tête ou de chargement" }],
  ["BRUINE_NO_GLOW=1", { en: "The prompt frame stays one colour whatever the effort", fr: "Le cadre de la boîte reste d'une couleur, quel que soit l'effort" }],
  ["BRUINE_INTRO", { en: "The logo's entrance: random, off, or one effect (rain, decrypt, storm…)", fr: "L'entrée du logo : random, off, ou un effet (rain, decrypt, storm…)" }],
  ["BRUINE_BG=0", { en: "Never paint a background, whatever the terminal reports", fr: "Ne jamais peindre de fond, quoi que dise le terminal" }],
  ["BRUINE_NO_UPDATE_CHECK=1", { en: "Never contact the npm registry to check for a version", fr: "Ne jamais interroger npm pour une nouvelle version" }],
  ["BRUINE_SILENCE=off", { en: "Keep the fixed stream timeout instead of the adaptive silence budget", fr: "Garder le délai fixe au lieu du budget de silence adaptatif" }],
];

const en: DocSection[] = [
  {
    id: "install",
    title: "Install",
    body: (
      <>
        <p>bruine needs Node 22 or newer, on Windows, macOS or Linux.</p>
        <pre>
          <code>{"npm install -g @ziamana/bruine\nbruine"}</code>
        </pre>
        <p>
          <code>pnpm add -g bruine</code> and <code>bun add -g bruine</code> work too; bruine remembers which one installed it and updates through the same.
        </p>
      </>
    ),
  },
  {
    id: "first-run",
    title: "The first run",
    body: (
      <>
        <p>
          The first launch opens a setup wizard. It finds a model server on your machine if you run one (llama.cpp, or anything that speaks <code>/v1</code>), asks for API keys
          if you want a cloud route, lets you pick skills, and writes <code>~/.bruine/</code>. <code>bruine setup</code> runs it again, pre-filled.
        </p>
        <p>
          It also asks, as a plain yes or no, whether to use Space Bunny Free: a model OpenCode serves at no charge for a limited time, with no account and no key. The answer starts
          on No. Saying yes sends your prompts and files to OpenCode's provider, and the offer can end without notice, so keep another model in reach.
        </p>
      </>
    ),
  },
  {
    id: "keys",
    title: "The gist in a minute",
    body: (
      <Table
        head={["You want to", "In bruine"]}
        rows={[
          ["Plan before it builds", <><code>Shift+Tab</code> toggles Plan and Build</>],
          ["Choose how much it asks", <><code>/permissions</code>, or <code>/ask</code>, <code>/auto</code>, <code>/full</code></>],
          ["Think harder or faster", <><code>ctrl+e</code> cycles the effort, <code>/effort</code> picks one</>],
          ["Switch model mid-session", <><code>/model</code>; <code>f2</code> walks the ones you used recently</>],
          ["Queue the next task", "Just type and press Enter while it works"],
          ["Run a command yourself", <><code>!npm test</code> (the output is not sent to the model)</>],
          ["Show it a screenshot", <><code>ctrl+v</code> (<code>alt+v</code> in Windows Terminal)</>],
          ["Expand a tool's output", <code>ctrl+o</code>],
          ["Script it", <code>bruine -p "task" --output-format json</code>],
        ]}
      />
    ),
  },
  {
    id: "permissions",
    title: "Permissions",
    body: (
      <>
        <p>
          One rule table decides, in plain TypeScript with tests. <strong>Ask</strong> asks before anything that changes something. <strong>Auto</strong> lets a fast model judge the
          routine actions, and risky ones still ask. <strong>Full access</strong> asks nothing, and says so loudly. <strong>Plan mode</strong> refuses changes until you switch back
          to Build.
        </p>
        <Fig
          src="/media/approval.png"
          alt="An approval in bruine: a framed amber band, Allow write src/summary.ts, with y Allow once, a Always allow every write this session, n Reject"
          caption="y allows once, a always, n or Escape rejects. The turn's clock stops while it waits."
        />
        <p>
          <code>a</code> (Always) remembers what it says: for a shell command, that exact command for this session, never every command. For an MCP server you trust,
          <code>"readOnly": true</code> or <code>"alwaysAllow": [...]</code> lets it through.
        </p>
      </>
    ),
  },
  {
    id: "models",
    title: "Models",
    body: (
      <>
        <p>
          Any OpenAI-compatible <code>/v1</code> server, a local llama.cpp, or about thirty cloud providers (DeepSeek, Anthropic, OpenAI, Google, OpenRouter, Groq, Mistral, xAI…).
          <code>/model</code> and <code>/provider</code> switch mid-session from the server's own catalogue.
        </p>
        <p>
          For a local model, pick one trained for tool calls with a context of 32k or more. Small models can chat but tend to lose the thread in long agent loops. bruine keeps the
          system prompt and the tool list identical for the whole session, so the prompt cache survives, and keeps side requests off a single-slot server.
        </p>
        <Fig
          src="/media/image.png"
          alt="read_image design/mockup.png, the image drawn in the terminal with coloured half blocks"
          caption="A vision model's image, drawn in the transcript."
        />
      </>
    ),
  },
  {
    id: "mcp",
    title: "MCP servers",
    body: (
      <>
        <p>
          bruine runs the tools of any MCP server, in the format Claude Code and Cursor use. Put yours under <code>mcpServers</code> in <code>~/.bruine/bruine.json</code>; a project
          can share its own in <code>.mcp.json</code>.
        </p>
        <pre>
          <code>{MCP_JSON}</code>
        </pre>
        <ul>
          <li>Tools show up as <code>mcp__server__tool</code> and go through the same permission gate as every other tool.</li>
          <li>A project's <code>.mcp.json</code> starts programs on your machine, so its servers only run once you have seen what they run and said yes.</li>
          <li>
            <code>/mcp</code> lists servers, their state and tools. Tools are bridged; resources and prompts are not, yet. Streamable HTTP is supported, the old SSE transport is not.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "quiet",
    title: "When the model goes quiet",
    body: (
      <>
        <p>
          A model can be silent for a long time and still be working, or it can have stopped. bruine gives each silence a budget that depends on what the model was doing: more time
          before its first token, after its reasoning, or while it writes a large file; less in the middle of a sentence. It is scaled by the effort and doubled on every retry.
        </p>
        <Fig
          src="/media/retry.png"
          alt="The transcript reads: The model has not answered for 1s. Retry 1/5 in 0.5s"
          caption="Past the budget, the request is retried, and the transcript says so."
        />
        <p>
          The route's <code>streamIdleTimeoutMs</code> in <code>settings.yaml</code> stays the hard ceiling. <code>BRUINE_SILENCE=off</code> keeps the fixed timeout.
        </p>
      </>
    ),
  },
  {
    id: "weather",
    title: "The weather",
    body: (
      <>
        <p>
          <code>/effect</code> opens a live preview picker. <code>/effect bruine</code> is a quiet drizzle, <code>pluie</code> a steady rain, <code>foudre</code> heavy rain with
          distant lavender lightning, and <code>auto</code> drizzles at rest and rains as hard as the reasoning effort while working. <code>/effect off</code> clears the sky.
        </p>
        <p>The weather is drawn locally and uses no tokens. It stays clear of the box, the controls and the cards, and pauses while you select text.</p>
      </>
    ),
  },
  {
    id: "updates",
    title: "Updates",
    body: (
      <p>
        Once a day bruine asks npm for the latest version (one plain GET, nothing about you). When there is a newer one, the session says so above the box: <code>/update</code>{" "}
        installs it after a yes, and <code>bruine update</code> does the same from a shell. <code>"updateCheck": false</code> in <code>bruine.json</code> turns the check off.
      </p>
    ),
  },
  {
    id: "commands",
    title: "Commands",
    body: (
      <>
        <pre>
          <code>{CLI.en}</code>
        </pre>
        <p>
          Inside a session, <code>/</code> opens the command palette: <code>/new</code>, <code>/resume</code>, <code>/compact</code>, <code>/plan</code>, <code>/permissions</code>,{" "}
          <code>/model</code>, <code>/effort</code>, <code>/skills</code>, <code>/mcp</code>, <code>/update</code>, <code>/help</code>…
        </p>
      </>
    ),
  },
  {
    id: "environment",
    title: "Environment",
    body: <Table head={["Variable", "Effect"]} rows={ENV.map(([name, d]) => [<code key={name}>{name}</code>, d.en])} />,
  },
];

const fr: DocSection[] = [
  {
    id: "install",
    title: "Installer",
    body: (
      <>
        <p>bruine demande Node 22 ou plus récent, sous Windows, macOS ou Linux.</p>
        <pre>
          <code>{"npm install -g @ziamana/bruine\nbruine"}</code>
        </pre>
        <p>
          <code>pnpm add -g bruine</code> et <code>bun add -g bruine</code> marchent aussi ; bruine se souvient de l'installateur utilisé et se met à jour avec lui.
        </p>
      </>
    ),
  },
  {
    id: "first-run",
    title: "Le premier lancement",
    body: (
      <>
        <p>
          Le premier lancement ouvre un assistant. Il trouve un serveur de modèle sur ta machine si tu en fais tourner un (llama.cpp, ou tout ce qui parle <code>/v1</code>), demande
          des clés d'API si tu veux une route cloud, te laisse choisir des skills, et écrit <code>~/.bruine/</code>. <code>bruine setup</code> le relance, prérempli.
        </p>
        <p>
          Il demande aussi, par un simple oui ou non, si tu veux utiliser Space Bunny Free : un modèle qu'OpenCode sert gratuitement pour un temps limité, sans compte ni clé. La
          réponse par défaut est Non. Dire oui envoie tes prompts et tes fichiers au fournisseur d'OpenCode, et l'offre peut s'arrêter sans préavis : garde un autre modèle sous la
          main.
        </p>
      </>
    ),
  },
  {
    id: "keys",
    title: "L'essentiel en une minute",
    body: (
      <Table
        head={["Tu veux", "Dans bruine"]}
        rows={[
          ["Planifier avant de construire", <><code>Shift+Tab</code> bascule entre Plan et Build</>],
          ["Choisir combien il demande", <><code>/permissions</code>, ou <code>/ask</code>, <code>/auto</code>, <code>/full</code></>],
          ["Réfléchir plus ou plus vite", <><code>ctrl+e</code> fait tourner l'effort, <code>/effort</code> en choisit un</>],
          ["Changer de modèle en route", <><code>/model</code> ; <code>f2</code> parcourt les derniers utilisés</>],
          ["Mettre la tâche suivante en file", "Tape et appuie sur Entrée pendant qu'il travaille"],
          ["Lancer une commande toi-même", <><code>!npm test</code> (la sortie n'est pas envoyée au modèle)</>],
          ["Lui montrer une capture", <><code>ctrl+v</code> (<code>alt+v</code> dans Windows Terminal)</>],
          ["Déplier la sortie d'un outil", <code>ctrl+o</code>],
          ["Le scripter", <code>bruine -p "tâche" --output-format json</code>],
        ]}
      />
    ),
  },
  {
    id: "permissions",
    title: "Permissions",
    body: (
      <>
        <p>
          Une seule table de règles décide, en TypeScript avec des tests. <strong>Ask</strong> demande avant tout ce qui change quelque chose. <strong>Auto</strong> laisse un modèle
          rapide juger les actions de routine, et les risquées demandent toujours. <strong>Full access</strong> ne demande rien, et le dit bien haut. Le <strong>mode Plan</strong>{" "}
          refuse les changements jusqu'à ce que tu repasses en Build.
        </p>
        <Fig
          src="/media/approval.png"
          alt="Une demande dans bruine : un bandeau ambre encadré, Allow write src/summary.ts, avec y Allow once, a Always allow every write this session, n Reject"
          caption="y autorise une fois, a toujours, n ou Échap refuse. L'horloge du tour s'arrête pendant l'attente."
        />
        <p>
          <code>a</code> (Always) retient ce qu'il annonce : pour une commande shell, cette commande exacte pour la session, jamais toutes les commandes. Pour un serveur MCP de
          confiance, <code>"readOnly": true</code> ou <code>"alwaysAllow": [...]</code> le laisse passer.
        </p>
      </>
    ),
  },
  {
    id: "models",
    title: "Modèles",
    body: (
      <>
        <p>
          N'importe quel serveur <code>/v1</code> compatible OpenAI, un llama.cpp local, ou une trentaine de fournisseurs cloud (DeepSeek, Anthropic, OpenAI, Google, OpenRouter,
          Groq, Mistral, xAI…). <code>/model</code> et <code>/provider</code> changent de modèle en cours de session, depuis le catalogue du serveur.
        </p>
        <p>
          Pour un modèle local, prends-en un entraîné aux appels d'outils, avec un contexte de 32k ou plus. Les petits modèles savent discuter mais perdent le fil dans les longues
          boucles d'agent. bruine garde le prompt système et la liste d'outils identiques pendant toute la session, pour que le cache survive, et n'envoie pas de requêtes annexes à
          un serveur à un seul slot.
        </p>
        <Fig
          src="/media/image.png"
          alt="read_image design/mockup.png, l'image dessinée dans le terminal en demi-blocs colorés"
          caption="L'image d'un modèle de vision, dessinée dans la conversation."
        />
      </>
    ),
  },
  {
    id: "mcp",
    title: "Serveurs MCP",
    body: (
      <>
        <p>
          bruine exécute les outils de n'importe quel serveur MCP, au format de Claude Code et Cursor. Mets les tiens sous <code>mcpServers</code> dans{" "}
          <code>~/.bruine/bruine.json</code> ; un projet peut partager les siens dans <code>.mcp.json</code>.
        </p>
        <pre>
          <code>{MCP_JSON}</code>
        </pre>
        <ul>
          <li>Les outils apparaissent comme <code>mcp__serveur__outil</code> et passent par le même contrôle que tous les autres.</li>
          <li>Le <code>.mcp.json</code> d'un projet lance des programmes sur ta machine : ses serveurs ne tournent qu'une fois que tu as vu ce qu'ils lancent et dit oui.</li>
          <li>
            <code>/mcp</code> liste les serveurs, leur état et leurs outils. Les outils sont branchés ; les ressources et les prompts pas encore. HTTP streamable est pris en charge,
            l'ancien transport SSE non.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "quiet",
    title: "Quand le modèle se tait",
    body: (
      <>
        <p>
          Un modèle peut rester longtemps silencieux et travailler quand même, ou s'être arrêté. bruine donne à chaque silence un budget qui dépend de ce que faisait le modèle :
          plus de temps avant son premier token, après sa réflexion ou pendant l'écriture d'un gros fichier ; moins au milieu d'une phrase. Il grandit avec l'effort et double à
          chaque nouvel essai.
        </p>
        <Fig
          src="/media/retry.png"
          alt="La conversation indique : The model has not answered for 1s. Retry 1/5 in 0.5s"
          caption="Passé le budget, la requête est relancée, et la conversation le dit."
        />
        <p>
          Le <code>streamIdleTimeoutMs</code> de la route dans <code>settings.yaml</code> reste le plafond. <code>BRUINE_SILENCE=off</code> garde le délai fixe.
        </p>
      </>
    ),
  },
  {
    id: "weather",
    title: "La météo",
    body: (
      <>
        <p>
          <code>/effect</code> ouvre un choix avec aperçu en direct. <code>/effect bruine</code> est une bruine discrète, <code>pluie</code> une pluie régulière, <code>foudre</code>{" "}
          une grosse pluie avec des éclairs lavande au loin, et <code>auto</code> bruine au repos et pleut aussi fort que l'effort de raisonnement pendant le travail.{" "}
          <code>/effect off</code> dégage le ciel.
        </p>
        <p>La météo est dessinée en local et ne coûte aucun token. Elle évite la boîte, les commandes et les cartes, et se met en pause pendant que tu sélectionnes du texte.</p>
      </>
    ),
  },
  {
    id: "updates",
    title: "Mises à jour",
    body: (
      <p>
        Une fois par jour, bruine demande à npm la dernière version (un simple GET, rien sur toi). S'il y en a une plus récente, la session le dit au-dessus de la boîte :{" "}
        <code>/update</code> l'installe après un oui, et <code>bruine update</code> fait pareil depuis un shell. <code>"updateCheck": false</code> dans <code>bruine.json</code>{" "}
        coupe la vérification.
      </p>
    ),
  },
  {
    id: "commands",
    title: "Commandes",
    body: (
      <>
        <pre>
          <code>{CLI.fr}</code>
        </pre>
        <p>
          Dans une session, <code>/</code> ouvre la palette : <code>/new</code>, <code>/resume</code>, <code>/compact</code>, <code>/plan</code>, <code>/permissions</code>,{" "}
          <code>/model</code>, <code>/effort</code>, <code>/skills</code>, <code>/mcp</code>, <code>/update</code>, <code>/help</code>…
        </p>
      </>
    ),
  },
  {
    id: "environment",
    title: "Environnement",
    body: <Table head={["Variable", "Effet"]} rows={ENV.map(([name, d]) => [<code key={name}>{name}</code>, d.fr])} />,
  },
];

export const DOCS: Record<Lang, { title: string; lead: string; toc: string; sections: DocSection[] }> = {
  en: { title: "Guide", lead: "From npm install to a session that asks the way you want. Everything here is also in the README.", toc: "On this page", sections: en },
  fr: { title: "Guide", lead: "De l'installation à une session qui demande comme tu veux. Tout est aussi dans le README.", toc: "Sur cette page", sections: fr },
};
