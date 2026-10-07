import type { ReactNode } from "react";
import type { Lang } from "@/lib/i18n";

export interface Release {
  version: string;
  latest?: boolean;
  groups: { title: string; items: ReactNode[] }[];
}

export const CHANGELOG: Record<Lang, { title: string; lead: string; latest: string; releases: Release[] }> = {
  en: {
    title: "Changelog",
    lead: "Every version, newest first. bruine checks for a new one once a day and offers /update in the session.",
    latest: "latest",
    releases: [
      {
        version: "0.1.3",
        latest: true,
        groups: [
          {
            title: "Security",
            items: [
              <>An audit of the permission gate, the file and web tools and MCP, published in <code>docs/SECURITY-AUDIT.md</code>.</>,
              <><strong><code>read</code>, <code>glob</code>, <code>grep</code> and <code>read_image</code> ask for a path outside the project, or for a secret.</strong> They used to read <code>~/.aws/credentials</code> or <code>/etc/passwd</code> without asking.</>,
              <><strong>“Always for this session” on <code>write</code> and <code>edit</code> stays inside the project.</strong> A path outside it asks every time.</>,
              <><strong><code>web_fetch</code> asks for this machine, the local network and cloud metadata addresses.</strong></>,
              <><strong>A project's <code>.mcp.json</code> can no longer widen an approved server:</strong> <code>alwaysAllow</code> and <code>readOnly</code> are part of what you approve.</>,
              <>More places count as secrets, <code>ps</code> with an environment flag is no longer read-only, and <code>sharp</code> is updated past CVE-2026-96889.</>,
            ],
          },
        ],
      },
      {
        version: "0.1.2",
        groups: [
          {
            title: "Skills",
            items: [<><strong>Every skill that ships with bruine starts on, except remotion.</strong> Uncheck one in <code>bruine setup</code> to turn it off; a saved choice is never touched.</>],
          },
        ],
      },
      {
        version: "0.1.1",
        groups: [
          {
            title: "First launch",
            items: [
              <><strong>Setting up the first time no longer needs pnpm.</strong> It links the copies that came with the install, with no network.</>,
              <><strong>The package is <code>@ziamana/bruine</code>.</strong> Install with <code>npm install -g @ziamana/bruine</code>; the command is still <code>bruine</code>.</>,
            ],
          },
          {
            title: "Websites",
            items: [<>Asked for a complete site, the agent plans every page first, builds them all, then polishes, and invents a brand name instead of taking the folder's.</>],
          },
        ],
      },
      {
        version: "0.1.0",
        groups: [
          {
            title: "When the model goes quiet",
            items: [
              <><strong>An adaptive silence budget.</strong> How long a model may stay silent before bruine retries depends on what it was doing, grows with the effort and the size of the file being written, and doubles on every retry.</>,
              <><strong>Retries you can see.</strong> “↻ The model has not answered for 3m. Retry 2/5 in 1.2s.” in the transcript, and retry 2/5 beside the working label. It used to be a clock that kept counting.</>,
            ],
          },
          {
            title: "Updates",
            items: [<>The update notice appears as soon as the launch's check answers, on the first launch too.</>, <><code>/update</code> installs the latest version from inside a session, after a yes.</>],
          },
          {
            title: "Approvals and safety",
            items: [
              <><strong>Security:</strong> an “Always” on one bash command allowed every later bash command for the session. Fixed, with a test.</>,
              <>The approval is a framed amber band with y / a / n; “Always” says what it covers; the turn's clock pauses and the rain stops while it waits.</>,
            ],
          },
          {
            title: "Look and feel",
            items: [<>Readable on light terminals: the colours follow the terminal's background, on every card.</>, <>An image the model reads is drawn right in the transcript, in any 24-bit or 256-colour terminal.</>, <>A diff's green and red bands cover the whole line, sign included.</>, <>256-colour terminals get gray surfaces instead of navy and black.</>],
          },
        ],
      },
      { version: "0.0.1", groups: [{ title: "The first version", items: [<>The agent, the rain, the permission gate, MCP, queued prompts.</>] }] },
    ],
  },
  fr: {
    title: "Nouveautés",
    lead: "Chaque version, de la plus récente à la plus ancienne. bruine en cherche une nouvelle une fois par jour et propose /update dans la session.",
    latest: "dernière",
    releases: [
      {
        version: "0.1.3",
        latest: true,
        groups: [
          {
            title: "Sécurité",
            items: [
              <>Un audit du contrôle des permissions, des outils fichiers et web et de MCP, publié dans <code>docs/SECURITY-AUDIT.md</code>.</>,
              <><strong><code>read</code>, <code>glob</code>, <code>grep</code> et <code>read_image</code> demandent pour un chemin hors du projet, ou pour un secret.</strong> Ils lisaient <code>~/.aws/credentials</code> ou <code>/etc/passwd</code> sans demander.</>,
              <><strong>« Toujours pour cette session » sur <code>write</code> et <code>edit</code> reste dans le projet.</strong> Un chemin hors du projet demande à chaque fois.</>,
              <><strong><code>web_fetch</code> demande pour cette machine, le réseau local et les adresses de métadonnées cloud.</strong></>,
              <><strong>Le <code>.mcp.json</code> d'un projet ne peut plus élargir un serveur approuvé :</strong> <code>alwaysAllow</code> et <code>readOnly</code> font partie de ce que tu approuves.</>,
              <>Plus d'emplacements comptent comme secrets, <code>ps</code> avec une option d'environnement n'est plus en lecture seule, et <code>sharp</code> passe au-delà de la CVE-2026-96889.</>,
            ],
          },
        ],
      },
      {
        version: "0.1.2",
        groups: [
          {
            title: "Skills",
            items: [<><strong>Tous les skills livrés avec bruine sont activés, sauf remotion.</strong> Décoche-en un dans <code>bruine setup</code> pour le couper ; un choix enregistré n'est jamais modifié.</>],
          },
        ],
      },
      {
        version: "0.1.1",
        groups: [
          {
            title: "Premier lancement",
            items: [
              <><strong>La première configuration n'a plus besoin de pnpm.</strong> Elle relie les copies livrées avec l'installation, sans réseau.</>,
              <><strong>Le paquet s'appelle <code>@ziamana/bruine</code>.</strong> Installe avec <code>npm install -g @ziamana/bruine</code> ; la commande reste <code>bruine</code>.</>,
            ],
          },
          {
            title: "Sites web",
            items: [<>Quand tu demandes un site complet, l'agent planifie toutes les pages, les construit toutes, puis les peaufine, et invente un nom de marque au lieu de prendre celui du dossier.</>],
          },
        ],
      },
      {
        version: "0.1.0",
        groups: [
          {
            title: "Quand le modèle se tait",
            items: [
              <><strong>Un budget de silence adaptatif.</strong> Le temps qu'un modèle peut rester muet avant que bruine relance dépend de ce qu'il faisait, grandit avec l'effort et la taille du fichier en cours d'écriture, et double à chaque essai.</>,
              <><strong>Des relances visibles.</strong> « ↻ The model has not answered for 3m. Retry 2/5 in 1.2s. » dans la conversation, et retry 2/5 à côté du libellé de travail. Avant, c'était une horloge qui tournait sans rien dire.</>,
            ],
          },
          {
            title: "Mises à jour",
            items: [<>L'avis de mise à jour s'affiche dès que la vérification répond, au premier lancement aussi.</>, <><code>/update</code> installe la dernière version depuis la session, après un oui.</>],
          },
          {
            title: "Autorisations et sécurité",
            items: [
              <><strong>Sécurité :</strong> un « Always » sur une commande bash autorisait toutes les commandes bash suivantes de la session. Corrigé, avec un test.</>,
              <>La demande est un bandeau ambre encadré avec y / a / n ; « Always » dit ce qu'il couvre ; l'horloge du tour se met en pause et la pluie s'arrête pendant l'attente.</>,
            ],
          },
          {
            title: "Apparence",
            items: [<>Lisible sur les terminaux clairs : les couleurs suivent le fond du terminal, sur chaque carte.</>, <>Une image lue par le modèle est dessinée dans la conversation, dans n'importe quel terminal 24 bits ou 256 couleurs.</>, <>Les bandes vertes et rouges d'un diff couvrent toute la ligne, signe compris.</>, <>Les terminaux 256 couleurs ont des surfaces grises au lieu de bleu marine et noir.</>],
          },
        ],
      },
      { version: "0.0.1", groups: [{ title: "La première version", items: [<>L'agent, la pluie, le contrôle des permissions, MCP, les messages en file.</>] }] },
    ],
  },
};
