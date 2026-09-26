The CLI has no way to point at another settings file: add a `--config <path>`
flag that reads settings from that file, and keep the built-in defaults for
the case where the flag is absent. The values in `config/defaults.json` are the
published contract — do not change them to make something pass.
