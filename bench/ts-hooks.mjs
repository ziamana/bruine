/**
 * T36 — the bench runs from source (`node --experimental-strip-types
 * bench/run.ts`), with no build step. Node's type stripping does not rewrite a
 * `.js` specifier to the `.ts` file it came from, so the bench's own modules
 * are loaded through this one hook: a relative `.js` specifier with no file
 * beside it is retried as `.ts`.
 *
 * Keeping the repo's `.js` import convention is the point: `pnpm typecheck`
 * (tsc, NodeNext) understands it and vitest understands it, so the bench
 * modules are type-checked by both. Loaded via `--import ./bench/ts-hooks.mjs`.
 */
import { existsSync } from "node:fs";
import { register, registerHooks } from "node:module";
import { isMainThread } from "node:worker_threads";
import { fileURLToPath } from "node:url";

/** The `.ts` URL for a relative `.js` specifier, when that file exists. */
function asTypeScript(specifier, parentURL) {
  if (parentURL === undefined || !/^\.{1,2}\//.test(specifier) || !specifier.endsWith(".js")) {
    return undefined;
  }
  const candidate = `${specifier.slice(0, -3)}.ts`;
  try {
    const url = new URL(candidate, parentURL);
    return existsSync(fileURLToPath(url)) ? url : undefined;
  } catch {
    return undefined; // an unusable parent URL: let Node report the real error
  }
}

/** Worker-thread hook (Node < 22.15). */
export async function resolve(specifier, context, nextResolve) {
  const asTs = asTypeScript(specifier, context.parentURL);
  return await nextResolve(asTs === undefined ? specifier : asTs.href, context);
}

/** In-thread hook (Node 22.15+), which is synchronous. */
function resolveSync(specifier, context, nextResolve) {
  const asTs = asTypeScript(specifier, context.parentURL);
  if (asTs === undefined) return nextResolve(specifier, context);
  return { url: asTs.href, shortCircuit: true };
}

if (isMainThread) {
  if (typeof registerHooks === "function") registerHooks({ resolve: resolveSync });
  else register(import.meta.url);
}
