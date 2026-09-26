# Decision log

- 2026-01-14: keep the parser hand written, no dependency.
- 2026-02-02: store dates as ISO strings, never as timestamps.
- 2026-03-30: the CLI owns the configuration file, the library never reads it.
