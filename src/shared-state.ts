/**
 * State that must be one value per process, whatever copy of a module reads it.
 *
 * The build bundles every plugin on its own (tsup, no splitting), so a module that two plugins
 * import exists twice at run time: `repl.js` and `render.js` each carry their own palette. A plain
 * module-level variable then splits in two. The terminal's background, learned by the shell in
 * one copy, never reached the tool cards painted by the other, and the effort set in one was not
 * the effort another read. Such state lives here instead, under a global symbol.
 */
export function sharedState<T extends object>(key: string, init: () => T): T {
  const store = globalThis as Record<symbol, unknown>;
  const id = Symbol.for(`bruine.${key}`);
  return (store[id] ??= init()) as T;
}
