import { Command } from "commander";
import { parseCmdline } from "@deepseek-ai/dsh-cmdline";
import type { DshContext, BruineStartup } from "./ctx.js";

/** Stable Cordis plugin name. */
export const name = "bruine-startup";

/** Services required before argv can be parsed. */
export const inject = ["cmdlineArgs"];

/** The service provided by this plugin and injected by the REPL. */
export const BRUINE_STARTUP_SERVICE = "bruineStartup";

function bruineCommand(): Command {
  const program = new Command()
    .name("bruine")
    .description(
      "Interactive terminal agent. Type a message and press Enter; /exit or Ctrl+D quits.",
    )
    .helpOption("-h, --help", "show this help")
    .option("-p, --print <task>", "run a task and exit", (value: string, previous: string[]) => [...previous, value], [] as string[])
    .option("-f, --output-format <format>", "headless output: text, json, or stream-json", "text")
    .argument("[prompt...]", "optional first prompt, sent before the loop starts")
    .addHelpText(
      "after",
      `
Examples:
  bruine                     start an interactive session
  bruine "fix the tests"     start and send a first prompt
`,
    );
  return program;
}

export function apply(ctx: DshContext): void {
  const program = bruineCommand();
  program.action(() => {
    const options = program.opts<{ print: string[]; outputFormat: string }>();
    if (options.print.length > 0) {
      if (!["text", "json", "stream-json"].includes(options.outputFormat)) {
        throw new Error("--output-format must be one of: text, json, stream-json");
      }
      ctx.provide(BRUINE_STARTUP_SERVICE, { headless: { prompts: options.print, format: options.outputFormat } });
      return;
    }
    const prompt = program.args.join(" ").trim();
    const startup: BruineStartup = prompt === "" ? {} : { initialPrompt: prompt };
    ctx.provide(BRUINE_STARTUP_SERVICE, startup);
  });
  parseCmdline(ctx as any, program as any);
}
