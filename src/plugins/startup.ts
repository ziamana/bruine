import { Command } from "commander";
import { parseCmdline } from "@deepseek-ai/dsh-cmdline";
import type { DshContext, KumoStartup } from "./ctx.js";

/** Stable Cordis plugin name. */
export const name = "kumo-startup";

/** Services required before argv can be parsed. */
export const inject = ["cmdlineArgs"];

/** The service provided by this plugin and injected by the REPL. */
export const KUMO_STARTUP_SERVICE = "kumoStartup";

function kumoCommand(): Command {
  const program = new Command()
    .name("kumo")
    .description(
      "Interactive terminal agent. Type a message and press Enter; /exit or Ctrl+D quits.",
    )
    .helpOption("-h, --help", "show this help")
    .argument("[prompt...]", "optional first prompt, sent before the loop starts")
    .addHelpText(
      "after",
      `
Examples:
  kumo                     start an interactive session
  kumo "fix the tests"     start and send a first prompt
`,
    );
  return program;
}

export function apply(ctx: DshContext): void {
  const program = kumoCommand();
  program.action(() => {
    const prompt = program.args.join(" ").trim();
    const startup: KumoStartup = prompt === "" ? {} : { initialPrompt: prompt };
    ctx.provide(KUMO_STARTUP_SERVICE, startup);
  });
  parseCmdline(ctx as any, program as any);
}
