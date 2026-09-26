import { Text } from "@earendil-works/pi-tui";
import { dim } from "../render/reasoning.js";
import { echoLine } from "../ui/questions.js";
import type { DshContext, KumoRepl } from "./ctx.js";
import type { KumoModesService } from "./modes.js";
import type { RenderService } from "./render.js";

/** Stable Cordis plugin name. */
export const name = "kumo-approval";

export interface ApprovalRequestLike {
  agent: unknown;
  toolName: string;
  callId?: string;
  reason?: string;
  signal?: { aborted: boolean };
}

export type ApprovalOutcome = "allowed-once" | "rejected" | "cancelled" | "unavailable";

/** `? Allow bash: rm -rf dist` — shared by the y/n prompt and the select. */
export function approvalTitle(
  request: ApprovalRequestLike,
  describe?: (callId: string) => { tool: string; summary: string } | undefined,
): string {
  let detail = "";
  if (request.callId !== undefined) {
    const info = describe?.(request.callId);
    if (info !== undefined && info.summary !== "") detail = info.summary;
  }
  if (detail === "" && request.reason !== undefined && request.reason !== "") {
    detail = request.reason;
  }
  const target = detail === "" ? request.toolName : `${request.toolName}: ${detail}`;
  return `? Allow ${target}`;
}

/** `? Allow bash: rm -rf dist ? [y/N] ` */
export function buildQuestion(
  request: ApprovalRequestLike,
  describe?: (callId: string) => { tool: string; summary: string } | undefined,
): string {
  return `${approvalTitle(request, describe)} ? [y/N] `;
}

/** Only an explicit y/yes allows; everything else (including empty) rejects. */
export function parseAnswer(line: string): boolean {
  return /^y(es)?$/i.test(line.trim());
}

export function apply(ctx: DshContext): void {
  let repl: KumoRepl | undefined;
  let render: RenderService | undefined;
  let modes: Pick<KumoModesService, "rememberFor" | "decisionFor" | "governs"> | undefined;
  ctx.inject(["kumoRepl"], (c: any) => {
    repl = c.kumoRepl;
  });
  ctx.inject(["kumoRender"], (c: any) => {
    render = c.kumoRender;
  });
  ctx.inject(["kumoModes"], (c: any) => {
    modes = c.kumoModes;
  });

  ctx.on(
    "user-questions/request",
    (request: {
      agent?: unknown;
      questions: Array<{
        id: string;
        question: string;
        header?: string;
        options?: Array<{ label: string; description?: string }>;
        multiSelect?: boolean;
      }>;
      signal?: { aborted: boolean };
    }, next: () => Promise<{ answers: Array<{ id: string; selected: string[]; custom?: string }> }>) => {
      if (repl === undefined || !(modes?.governs(request.agent) ?? request.agent === repl.agent)) return next();
      if (request.signal?.aborted) {
        return { answers: request.questions.map((q) => ({ id: q.id, selected: [], custom: "skipped by the user" })) };
      }
      const ui = repl.ui;
      if (ui !== undefined && typeof ui.askQuestions === "function") {
        return ui.askQuestions(request.questions).then((answers) => {
          const resolved =
            answers ??
            request.questions.map((q) => ({ id: q.id, selected: [], custom: "skipped by the user" }));
          for (const a of resolved) {
            const q = request.questions.find((qq) => qq.id === a.id);
            if (q === undefined) continue;
            const label = a.selected[0] ?? a.custom ?? "skipped";
            ui.addChat(new Text(dim(echoLine(q.question, label)), 1, 0));
            ui.requestRender();
          }
          return { answers: resolved };
        });
      }
      const ask = repl.ask;
      if (ask === undefined) return next();
      return (async () => {
        const answers: Array<{ id: string; selected: string[]; custom?: string }> = [];
        for (const q of request.questions) {
          const opts = [...(q.options ?? []), { label: "Other…" }];
          const lines = [
            q.header !== undefined ? `${q.header}: ${q.question}` : q.question,
            ...opts.map((o, i) => `${String(i + 1)}) ${o.label}${o.description !== undefined ? ` (${o.description})` : ""}`),
          ].join("\n");
          const raw = (await ask(`${lines}\n  [1]`)).trim();
          const n = Number.parseInt(raw, 10);
          if (Number.isInteger(n) && n >= 1 && n <= opts.length) {
            const chosen = opts[n - 1]!;
            if (chosen.label === "Other…") {
              const custom = (await ask("Other answer: ")).trim();
              answers.push({ id: q.id, selected: [], ...(custom !== "" ? { custom } : {}) });
            } else {
              answers.push({ id: q.id, selected: [chosen.label] });
            }
          } else if (raw !== "") {
            answers.push({ id: q.id, selected: [], custom: raw });
          } else {
            answers.push({ id: q.id, selected: opts[0] !== undefined && opts[0].label !== "Other…" ? [opts[0].label] : [], custom: undefined });
          }
        }
        return { answers };
      })();
    },
  );

  ctx.on(
    "approval/request",
    (request: ApprovalRequestLike, next: () => Promise<ApprovalOutcome>) => {
      if (!(modes?.governs(request.agent) ?? request.agent === repl?.agent)) return next();
      if (request.signal?.aborted) return "cancelled";

      if (modes !== undefined) {
        const decision = modes.decisionFor(request.callId);
        if (decision === "allow") return "allowed-once";
        if (decision === "deny") return "rejected";
        if (decision !== "ask") return repl === undefined ? "rejected" : next();
      }

      if (repl === undefined) return "rejected";

      const ui = repl.ui;
      if (ui !== undefined) {
        // TUI mode (T13d/T16): pi-tui select. Escape/cancel = reject.
        const title = approvalTitle(request, (id) => render?.describe?.(id));
        return ui
          .askChoice(title, [
            { value: "allow", label: "Allow once" },
            { value: "always", label: "Always for this session" },
            { value: "reject", label: "Reject" },
          ])
          .then((choice) => {
            if (choice === 0) return "allowed-once" as const;
            if (choice === 1) {
              modes?.rememberFor(request.callId);
              return "allowed-once" as const;
            }
            return "rejected" as const;
          });
      }

      // Non-TTY mode: the y/n readline prompt ("a" allows for the session).
      const screen = render?.screen;
      const question = buildQuestion(request, (id) => screen?.tools.describe(id));
      // Close the transient display before asking.
      screen?.reasoning.end();

      const ask = repl.ask;
      if (ask === undefined) return next();
      return ask(question).then((answer) => {
        const always = /^a(lways?)?$/i.test(answer.trim());
        const ok = always || parseAnswer(answer);
        if (always) modes?.rememberFor(request.callId);
        if (screen !== undefined) {
          const mark = ok ? screen.icons.ok : screen.icons.fail;
          screen.screen.write(`${mark} ${ok ? (always ? "allowed for session" : "allowed") : "rejected"}\n`);
        }
        return ok ? ("allowed-once" as const) : ("rejected" as const);
      });
    },
  );
}
