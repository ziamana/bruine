import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { SPACE_BUNNY } from "./spacebunny.js";
import { writeAtomic, writeEnvVar } from "./simple.js";

/**
 * Adds Space Bunny Free to an existing home: its route in settings.yaml and its public key in
 * `.env`. Everything already there stays as it was, comments included; a route that is already
 * declared is left alone.
 */
export async function addSpaceBunnyToHome(home: string): Promise<"added" | "present"> {
  const file = join(home, "settings.yaml");
  const doc = parseDocument(existsSync(file) ? readFileSync(file, "utf8") : "");
  const path = ["llm-pi-ai", "providers", SPACE_BUNNY.routeName];
  let outcome: "added" | "present" = "present";
  if (!doc.hasIn(path)) {
    doc.setIn(path, {
      displayName: "OpenCode Zen",
      api: "openai-completions",
      baseURL: SPACE_BUNNY.baseUrl,
      apiKeyEnv: SPACE_BUNNY.keyEnv,
      models: [
        {
          id: SPACE_BUNNY.model,
          name: SPACE_BUNNY.model,
          contextWindow: SPACE_BUNNY.contextWindow,
          reasoningEfforts: { off: null, low: "low" },
        },
      ],
    });
    await writeAtomic(file, String(doc), 0o600);
    outcome = "added";
  }
  await writeEnvVar(join(home, ".env"), SPACE_BUNNY.keyEnv, SPACE_BUNNY.keyValue);
  return outcome;
}
