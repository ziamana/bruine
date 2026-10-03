/**
 * T29 — does the model behind the default route actually see images?
 *
 * Two sources, in order: an explicit answer in `settings.yaml` (the user knows
 * their route better than any probe), then the server's own `/v1/models`
 * `capabilities`. When neither answers, the answer is "no": attaching an image
 * to a text-only model wastes a turn and shows the user a blank result, so the
 * honest move is to say the model cannot see images and attach nothing.
 */
import { isPrivateIPv4 } from "../setup/discover.js";

export type VisionAnswer = "yes" | "no" | "unknown";

/** settings.yaml model entry keys that declare vision, in any casing. */
const TRUE_WORDS = new Set(["true", "yes", "vision", "multimodal", "image", "images"]);

export interface ModelEntry {
  id?: unknown;
  /** llama.cpp style capability list, e.g. `["completion", "multimodal"]`. */
  capabilities?: unknown;
  [key: string]: unknown;
}

/** The keys that declare what a model can accept; absence is not a "no". */
const VISION_KEYS = ["capabilities", "vision", "multimodal", "image", "images"] as const;

/** Does this declaration mean "accepts images"? */
function declaresVision(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "string") {
    return value
      .split(/[\s,;|]+/)
      .some((word) => TRUE_WORDS.has(word.toLowerCase()));
  }
  if (Array.isArray(value)) {
    return value.some((v) => typeof v === "string" && TRUE_WORDS.has(v.toLowerCase()));
  }
  return false;
}

/**
 * What one model entry says about images. An entry that declares nothing is
 * "unknown", not "no": bruine's routes are local servers that answer
 * `/v1/models` with the truth, and refusing a screenshot because settings.yaml
 * was silent would be the wrong default.
 */
export function entryVisionAnswer(entry: unknown): VisionAnswer {
  if (entry === null || typeof entry !== "object") return "unknown";
  const record = entry as Record<string, unknown>;
  let declared = false;
  for (const key of VISION_KEYS) {
    const value = record[key];
    if (value === undefined || value === null) continue;
    declared = true;
    if (declaresVision(value)) return "yes";
  }
  return declared ? "no" : "unknown";
}

/** A model entry that declares multimodal input, however it spells it. */
export function entrySeesImages(entry: ModelEntry): boolean {
  return entryVisionAnswer(entry) === "yes";
}

/** The `/v1/models` payload shape bruine cares about; anything else is ignored. */
export function modelsPayloadSeesImages(payload: unknown, model: string): VisionAnswer {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { data?: unknown } | undefined)?.data)
      ? ((payload as { data: unknown[] }).data)
      : undefined;
  if (list === undefined) return "unknown";
  // No model id to match: the server answered, and every entry is text-only.
  if (model === "") return list.some((e) => entrySeesImages(e as ModelEntry)) ? "yes" : "no";
  const entry = list.find((e) => (e as ModelEntry)?.["id"] === model);
  if (entry === undefined) return "unknown";
  return entrySeesImages(entry as ModelEntry) ? "yes" : "no";
}

/** settings.yaml, read the same way bruine reads the rest of the route. */
export function settingsEntryAnswer(entry: unknown): VisionAnswer {
  return entryVisionAnswer(entry);
}

export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/**
 * Ask one OpenAI-compatible server what its models can do. Only private and
 * loopback hosts are probed: bruine's own routes are local, and a public base URL
 * is never a clipboard-sized request away from sending bytes somewhere else.
 */
export async function probeVision(
  baseUrl: string,
  model: string,
  doFetch: FetchLike = fetch as unknown as FetchLike,
  timeoutMs = 2000,
): Promise<VisionAnswer> {
  try {
    const url = new URL(baseUrl);
    if (!isLocalHost(url.hostname)) return "unknown";
    const res = await doFetch(`${url.origin}/v1/models`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return "unknown";
    return modelsPayloadSeesImages(await res.json(), model);
  } catch {
    return "unknown";
  }
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "::1" || isPrivateIPv4(hostname);
}

/** The line the user sees when the model cannot take an image. */
export const NO_VISION_NOTICE = "This model cannot see images";

/**
 * The single decision, in one place: settings first, then the server. A "no"
 * from either source is final; only "unknown" falls through to the probe.
 */
export async function resolveVision(args: {
  settingsEntry?: unknown;
  baseUrl?: string;
  model: string;
  doFetch?: FetchLike;
  timeoutMs?: number;
}): Promise<VisionAnswer> {
  const fromSettings = settingsEntryAnswer(args.settingsEntry);
  if (fromSettings !== "unknown") return fromSettings;
  if (args.baseUrl === undefined) return "unknown";
  return probeVision(args.baseUrl, args.model, args.doFetch, args.timeoutMs);
}
