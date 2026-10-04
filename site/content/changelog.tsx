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
        version: "Next",
        groups: [
          {
            title: "Not released yet",
            items: [<>An image the model reads is drawn right in the transcript, in any 24-bit or 256-colour terminal.</>, <>A diff's green and red bands cover the whole line, sign included.</>, <>On a light terminal, every card gets the light theme's ink.</>],
          },
        ],
      },
      {
        version: "0.1.0",
        latest: true,
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
            items: [<>Readable on light terminals: the colours follow the terminal's background.</>, <>256-colour terminals get gray surfaces instead of navy and black.</>],
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
        version: "Prochaine",
        groups: [
          {
            title: "Pas encore publié",
            items: [<>Une image lue par le modèle est dessinée dans la conversation, dans n'importe quel terminal 24 bits ou 256 couleurs.</>, <>Les bandes vertes et rouges d'un diff couvrent toute la ligne, signe compris.</>, <>Sur un terminal clair, chaque carte reçoit l'encre du thème clair.</>],
          },
        ],
      },
      {
        version: "0.1.0",
        latest: true,
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
            items: [<>Lisible sur les terminaux clairs : les couleurs suivent le fond du terminal.</>, <>Les terminaux 256 couleurs ont des surfaces grises au lieu de bleu marine et noir.</>],
          },
        ],
      },
      { version: "0.0.1", groups: [{ title: "La première version", items: [<>L'agent, la pluie, le contrôle des permissions, MCP, les messages en file.</>] }] },
    ],
  },
};
