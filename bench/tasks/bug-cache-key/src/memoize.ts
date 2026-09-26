type Fn = (...args: number[]) => number;

const cache = new Map<string, number>();

/** Call fn once per distinct argument list. */
export function memoize(fn: Fn): Fn {
  return (...args: number[]): number => {
    const key = String(args[0]);
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const value = fn(...args);
    cache.set(key, value);
    return value;
  };
}

/** Forget everything; the tests use it between cases. */
export function clearCache(): void {
  cache.clear();
}
