#!/usr/bin/env sh
# T36 read-the-project: report.ts reaches dates.ts and util.ts, and nothing
# comes back to report.ts — so the answer must say there is no cycle.
set -eu
cd "$(dirname "$0")"
echo "kumo-bench-check-mode: expected-answer"
if [ ! -f answer.txt ]; then
  echo "answer.txt was not written" >&2
  exit 1
fi
python3 - <<'PY' || exit 1
import sys

text = open("answer.txt", encoding="utf-8").read().lower()
missing = [name for name in ("dates", "util") if name not in text]
if missing:
    print(f"answer.txt does not mention {', '.join(missing)}", file=sys.stderr)
    raise SystemExit(1)
if " no " not in f" {text} " and not any(
    word in text for word in ("no cycle", "not a cycle", "no import cycle", "acyclic", "there is no")
):
    print("answer.txt never says there is no cycle", file=sys.stderr)
    raise SystemExit(1)
if any(phrase in text for phrase in ("yes, there is a cycle", "yes there is a cycle", "forms a cycle", "there is a cycle")):
    print("answer.txt claims a cycle; there is none", file=sys.stderr)
    raise SystemExit(1)
PY
echo "answer.txt is right about the cycle"
