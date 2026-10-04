import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { SPACE_BUNNY, SPACE_BUNNY_EFFORTS, SPACE_BUNNY_HEADERS, SPACE_BUNNY_INPUT, SPACE_BUNNY_LEGACY_IDLE_TIMEOUT_MS, spaceBunnyRoute } from "./spacebunny.js";
import { writeAtomic } from "./simple.js";

const ROUTE_PATH = ["llm-pi-ai", "providers", SPACE_BUNNY.routeName] as const;

/**
 * Adds Space Bunny Free to an existing home: its route in settings.yaml. Everything already there
 * stays as it was, comments included; a route that is already declared is left alone, except that
 * a route written the first way (a key variable the runtime cannot see mid-session, and a single
 * thinking level) is brought up to date.
 */
export async function addSpaceBunnyToHome(home: string): Promise<"added" | "present"> {
  const file = join(home, "settings.yaml");
  const doc = parseDocument(existsSync(file) ? readFileSync(file, "utf8") : "");
  if (doc.hasIn([...ROUTE_PATH])) {
    await repairSpaceBunnyRoute(home);
    return "present";
  }
  doc.setIn([...ROUTE_PATH], spaceBunnyRoute());
  await writeAtomic(file, String(doc), 0o600);
  return "added";
}

/**
 * The first version of the route asked for a key in `BRUINE_ZEN_API_KEY`, which a session started
 * before the route was added never has ("no credential for provider route opencode-zen"), and
 * declared only `off` and `low`; neither version said the model takes images, so the harness refused
 * them. A route in that shape becomes the header form with the endpoint's real levels its inputs, and without the two-minute stream timeout an earlier version wrote; any other shape, and any route the user changed on purpose, is left exactly as it is.
 * Returns whether the file was changed.
 */
export async function repairSpaceBunnyRoute(home: string): Promise<boolean> {
  const file = join(home, "settings.yaml");
  if (!existsSync(file)) return false;
  let doc;
  try {
    doc = parseDocument(readFileSync(file, "utf8"));
  } catch {
    return false;
  }
  if (!doc.hasIn([...ROUTE_PATH])) return false;
  let changed = false;
  const keyVar = doc.getIn([...ROUTE_PATH, "apiKeyEnv"]);
  if (typeof keyVar === "string" && /^(BRUINE|KUMO)_ZEN_API_KEY$/.test(keyVar) && !doc.hasIn([...ROUTE_PATH, "headers"])) {
    doc.deleteIn([...ROUTE_PATH, "apiKeyEnv"]);
    doc.setIn([...ROUTE_PATH, "headers"], { ...SPACE_BUNNY_HEADERS });
    changed = true;
  }
  if (doc.getIn([...ROUTE_PATH, "streamIdleTimeoutMs"]) === SPACE_BUNNY_LEGACY_IDLE_TIMEOUT_MS) {
    doc.deleteIn([...ROUTE_PATH, "streamIdleTimeoutMs"]);
    changed = true;
  }
  const models = doc.getIn([...ROUTE_PATH, "models"]) as { toJSON?: () => unknown } | undefined;
  const list = (models?.toJSON?.() ?? []) as Array<Record<string, unknown>>;
  list.forEach((model, index) => {
    if (model.id !== SPACE_BUNNY.model) return;
    const efforts = model.reasoningEfforts as Record<string, unknown> | undefined;
    const old = efforts !== undefined && Object.keys(efforts).length === 2 && "off" in efforts && "low" in efforts && efforts.off === null;
    if (efforts === undefined || old) {
      doc.setIn([...ROUTE_PATH, "models", index, "reasoningEfforts"], { ...SPACE_BUNNY_EFFORTS });
      changed = true;
    }
    // A model that says nothing about what it takes in is read as text only: images are refused.
    const input = model.input as unknown[] | undefined;
    if (input === undefined || input.length === 0) {
      doc.setIn([...ROUTE_PATH, "models", index, "input"], [...SPACE_BUNNY_INPUT]);
      changed = true;
    }
  });
  if (changed) await writeAtomic(file, String(doc), 0o600);
  return changed;
}
