import { dim } from "../render/reasoning.js";
import type { DshContext, KumoRepl } from "./ctx.js";
import type { KumoUi } from "./render.js";

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

/** `? Allow bash: rm -rf dist ? [y/N] ` */
export function buildQuestion(
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
  return `? Allow ${target} ? [y/N] `;
}

/** Only an explicit y/yes allows; everything else (including empty) rejects. */
export function parseAnswer(line: string): boolean {
  return /^y(es)?$/i.test(line.trim());
}

export function apply(ctx: DshContext): void {
  let repl: KumoRepl | undefined;
  let ui: KumoUi | undefined;
  ctx.inject(["kumoRepl"], (c: any) => {
    repl = c.kumoRepl;
  });
  ctx.inject(["kumoRender"], (c: any) => {
    ui = c.kumoRender;
  });

  ctx.on(
    "approval/request",
    (request: ApprovalRequestLike, next: () => Promise<ApprovalOutcome>) => {
      if (repl === undefined || request.agent !== repl.agent) return next();
      if (request.signal?.aborted) return "cancelled";

      const question = buildQuestion(request, (id) => ui?.tools.describe(id));
      // Close the transient display before asking.
      ui?.reasoning.end();
      ui?.screen.write("\r\x1b[2K");

      const ask = repl.ask;
      return ask(question).then((answer) => {
        const ok = parseAnswer(answer);
        ui?.screen.write(`\r\x1b[2K${dim(ok ? "✓ allowed" : "✗ rejected")}\n`);
        return ok ? ("allowed-once" as const) : ("rejected" as const);
      });
    },
  );
}
