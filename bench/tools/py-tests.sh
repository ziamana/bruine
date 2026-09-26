#!/usr/bin/env sh
# T36 — run a Python task's unittest suite, or report that this machine has no
# python3 (exit 70: a missing interpreter is not a model failure).
#
# Usage: py-tests.sh [unittest args…]  (default: discover tests/)
set -eu

if ! command -v python3 >/dev/null 2>&1; then
  echo "py-tests.sh: no python3 on this machine" >&2
  exit 70
fi

TASK_DIR="${KUMO_BENCH_TASK_DIR:-.}"

echo "kumo-bench-check-mode: unittest"
if [ "$#" -gt 0 ]; then
  exec python3 -m unittest "$@"
fi
exec python3 -m unittest discover -s "$TASK_DIR/tests" -t "$TASK_DIR" -q
