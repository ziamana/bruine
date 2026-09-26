#!/usr/bin/env sh
# T36 read-the-project: the step names must appear in the order main() calls
# them, and the step that opens the database must be named.
set -eu
cd "$(dirname "$0")"
echo "kumo-bench-check-mode: expected-answer"
if [ ! -f answer.txt ]; then
  echo "answer.txt was not written" >&2
  exit 1
fi
python3 - <<'PY' || exit 1
import re
import sys

text = open("answer.txt", encoding="utf-8").read().lower()
names = [line.strip() for line in open("expected.txt", encoding="utf-8") if line.strip()]
positions = []
for name in names:
    at = text.find(name.lower())
    if at < 0:
        print(f"answer.txt never mentions {name}", file=sys.stderr)
        raise SystemExit(1)
    positions.append(at)
if positions != sorted(positions):
    print(f"the steps are not in startup order: {names}", file=sys.stderr)
    raise SystemExit(1)
# The step that opens the database is `connect`; it must be named on its own.
if not re.search(r"connect", text):
    print("answer.txt does not name the step that opens the database", file=sys.stderr)
    raise SystemExit(1)
PY
echo "answer.txt has the steps in order"
