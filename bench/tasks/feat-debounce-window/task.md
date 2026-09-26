The search box fires a request on every keystroke. Add a reusable `debounce`
helper, then use it to build a `RateLimiter` that runs at most one call per
`waitMs`. Both files and their tests are missing.
