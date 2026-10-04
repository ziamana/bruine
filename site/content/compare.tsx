import type { ReactNode } from "react";
import type { Lang } from "@/lib/i18n";

export interface CompareContent {
  title: string;
  lead: string;
  head: string[];
  rows: [string, ...ReactNode[]][];
  behindTitle: string;
  behind: ReactNode;
  fitTitle: string;
  fit: { who: string; tool: string }[];
}

const TOOLS = ["bruine", "Claude Code", "OpenCode", "Aider", "Codex CLI"];

export const COMPARE: Record<Lang, CompareContent> = {
  en: {
    title: "How it compares",
    lead: "An honest table, checked against each project's documentation in October 2026. Every one of these is a good tool, and some do things bruine does not. If something moved, tell us.",
    head: ["", ...TOOLS],
    rows: [
      ["Source", "MIT", "Proprietary", "MIT", "Apache-2.0", "Apache-2.0"],
      ["Models", "Any: local llama.cpp, any /v1 server, ~30 cloud providers", "Claude (Anthropic API, Bedrock, Vertex)", "75+ providers, local included", "Most LLMs, local included", "OpenAI; local open-weight models with --oss"],
      ["Built for local models", "Yes: cache kept warm, single-slot aware, measured tok/s", "No", "Supported", "Supported", "gpt-oss through Ollama or LM Studio"],
      ["MCP", "Tools, stdio and HTTP", "Yes", "Yes", "Not built in", "Yes"],
      ["Permissions", "One rule table, Ask / Auto / Full, Plan mode", "Modes and rules, Plan mode", "Per-agent permissions, Plan agent", "Confirms commands; Git is the safety net", "Approval modes and an OS sandbox"],
      ["Undo a change", "No (use Git)", "Yes, checkpoints and /rewind", "Yes, /undo /redo", "Yes, every edit is a commit", "No (use Git)"],
      ["IDE integration", "No, terminal only", "Yes", "Yes (LSP, desktop app)", "Community editor plugins", "Yes"],
    ],
    behindTitle: "Where bruine is behind, today",
    behind: (
      <p>
        No checkpoints or rewind (Git is your undo), no IDE or ACP integration, MCP is tools only (no resources, prompts or OAuth login), no LSP, and it is young (0.1) on top of a
        harness that is itself a developer preview.
      </p>
    ),
    fitTitle: "Which one fits",
    fit: [
      { who: "You run a model on your own GPU and want it treated as first class", tool: "bruine" },
      { who: "You mostly use Claude models, in an IDE", tool: "Claude Code" },
      { who: "You want a Git commit per edit", tool: "Aider" },
      { who: "You want an OS-level sandbox around every command", tool: "Codex CLI" },
    ],
  },
  fr: {
    title: "Comparer",
    lead: "Un tableau honnête, vérifié dans la documentation de chaque projet en octobre 2026. Ce sont tous de bons outils, et certains font des choses que bruine ne fait pas. Si quelque chose a changé, dis-le nous.",
    head: ["", ...TOOLS],
    rows: [
      ["Licence", "MIT", "Propriétaire", "MIT", "Apache-2.0", "Apache-2.0"],
      ["Modèles", "Tous : llama.cpp local, tout serveur /v1, ~30 fournisseurs cloud", "Claude (API Anthropic, Bedrock, Vertex)", "75+ fournisseurs, local compris", "La plupart des LLM, local compris", "OpenAI ; modèles ouverts en local avec --oss"],
      ["Fait pour les modèles locaux", "Oui : cache gardé chaud, conscient du slot unique, tok/s mesurés", "Non", "Pris en charge", "Pris en charge", "gpt-oss via Ollama ou LM Studio"],
      ["MCP", "Outils, stdio et HTTP", "Oui", "Oui", "Pas intégré", "Oui"],
      ["Permissions", "Une table de règles, Ask / Auto / Full, mode Plan", "Modes et règles, mode Plan", "Permissions par agent, agent Plan", "Confirme les commandes ; Git sert de filet", "Modes d'approbation et bac à sable système"],
      ["Annuler un changement", "Non (utilise Git)", "Oui, points de reprise et /rewind", "Oui, /undo /redo", "Oui, chaque modification est un commit", "Non (utilise Git)"],
      ["Intégration IDE", "Non, terminal seulement", "Oui", "Oui (LSP, appli de bureau)", "Plugins d'éditeur de la communauté", "Oui"],
    ],
    behindTitle: "Là où bruine est en retard, aujourd'hui",
    behind: (
      <p>
        Pas de points de reprise ni de retour en arrière (Git est ton annulation), pas d'intégration IDE ni ACP, MCP limité aux outils (pas de ressources, de prompts ni de connexion
        OAuth), pas de LSP, et il est jeune (0.1), sur un moteur lui-même en préversion.
      </p>
    ),
    fitTitle: "Lequel te va",
    fit: [
      { who: "Tu fais tourner un modèle sur ton GPU et tu veux qu'il soit traité en premier", tool: "bruine" },
      { who: "Tu utilises surtout les modèles Claude, dans un IDE", tool: "Claude Code" },
      { who: "Tu veux un commit Git par modification", tool: "Aider" },
      { who: "Tu veux un bac à sable système autour de chaque commande", tool: "Codex CLI" },
    ],
  },
};
