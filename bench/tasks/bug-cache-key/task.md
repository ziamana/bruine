`memoize` never hits: the cache key only uses the first argument, so
`add(1, 2)` and `add(1, 3)` share one entry. Make the key depend on every
argument.
