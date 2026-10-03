/**
 * T42 — the launcher's own flags, parsed before anything else.
 *
 * Pure, and it **claims nothing it does not own**: the first token it does not
 * recognize ends bruine's parsing, because everything after it belongs to dsh or
 * to the booted tree. A `-p` that is the value of another flag (`--model -p`)
 * is not a print request.
 */

/** What the caller asked for, beyond "boot the interactive REPL". */
export type OutputFormat = "text" | "json" | "stream-json";

export interface HeadlessRequest {
  /** One task per element, in argv order. A `-p -` element is read from stdin. */
  prompts: string[];
  format: OutputFormat;
}

export interface ParsedFlags {
  headless: HeadlessRequest | undefined;
  permission?: "ask" | "auto" | "full";
  /** Strip bruine's own flags; the rest goes to dsh verbatim. */
  passthrough: string[];
  /** `--output-format` named a format that does not exist. */
  error?: string;
}

const FORMATS: readonly string[] = ["text", "json", "stream-json"];

/** `-p=task`, `-p task`, `--print=task`, `--print task`. */
function valueOf(inline: string | undefined): string | undefined {
  if (inline !== undefined) return inline;
  return undefined;
}

export function parseFlags(argv: readonly string[]): ParsedFlags {
  const prompts: string[] = [];
  let format: OutputFormat = "text";
  let permission: "ask" | "auto" | "full" | undefined;
  const passthrough: string[] = [];


  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;

    // Everything after a bare `--` is the user's, verbatim.
    if (arg === "--") {
      passthrough.push(...argv.slice(i + 1));
      break;
    }

    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);

    if (name === "-p" || name === "--print") {
      const value = valueOf(inline);
      if (value === undefined) {
        // The next token is the prompt, unless it is another flag: `-p -p` is
        // not a prompt of "-p".
        const next = argv[i + 1];
        if (next === undefined || (next.startsWith("-") && next !== "-")) {
          return { headless: undefined, passthrough, error: `${name} needs a task` };
        }
        prompts.push(next);
        i += 1;
      } else {
        prompts.push(value);
      }
      continue;
    }

    if (name === "--output-format" || name === "-f") {
      const value = inline ?? argv[i + 1];
      if (inline === undefined) i += 1;
      if (value === undefined || !FORMATS.includes(value)) {
        return {
          headless: undefined,
          passthrough,
          error: `--output-format must be one of: ${FORMATS.join(", ")}`,
        };
      }
      format = value as OutputFormat;

      continue;
    }

    if (name === "--permission-mode") {
      const value = inline ?? argv[i + 1];
      if (inline === undefined) i += 1;
      if (value !== "ask" && value !== "auto" && value !== "full") {
        return { headless: undefined, passthrough, error: "--permission-mode must be ask, auto, or full" };
      }
      permission = value;
      continue;
    }
    if (name === "--dangerously-skip-permissions") {
      permission = "full";
      continue;
    }

    // dsh owns the first unknown option and all following tokens, including
    // a possible -p value. Never claim one of its argument values as ours.
    passthrough.push(...argv.slice(i));
    break;
  }

  if (prompts.length === 0) {
    // No task: bruine boots the REPL. `--output-format` on its own is not ours to
    // interpret, so it stays in the passthrough for dsh.
    return { headless: undefined, passthrough, ...(permission !== undefined ? { permission } : {}) };
  }
  return { headless: { prompts, format }, passthrough, ...(permission !== undefined ? { permission } : {}) };
}
