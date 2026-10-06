# Security

## Reporting a problem

Please do not open a public issue for a vulnerability. Use GitHub's private report instead:
**Security tab → Report a vulnerability** on <https://github.com/ziamana/bruine>. Say what you ran, what
you expected and what happened. You will get an answer within a few days.

Only the latest version is supported: `bruine update` installs it.

## What bruine protects, and what it does not

bruine runs tools on your machine on behalf of a model. The permission gate (`src/gate/`) is what stands
between a model's request and your files and shell. What it does and does not do is written down in
[docs/SECURITY-AUDIT.md](docs/SECURITY-AUDIT.md), with the findings of the last audit and what is still open.

In short: in Ask and Auto mode, reading outside the project, touching a secret (`.env`, `~/.ssh`, `~/.aws`…),
a destructive command or a write outside the project asks first. In Full access nothing asks, by design.
Telemetry is off unless you turn it on. API keys are stored in `.env` in bruine's home with mode 0600.
