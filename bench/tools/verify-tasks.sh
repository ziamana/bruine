#!/usr/bin/env bash
# T36 — self-check of the task set. Two properties matter for a benchmark:
#   1. a pristine copy of every task FAILS its check (a task that passes with no
#      work measures nothing), and
#   2. after the scripted reference fix the same copy PASSES (the task is
#      solvable, and check.sh is right).
# The Go task is reported as "cannot check here" on a machine without a Go
# toolchain, never as a pass.
#
#   bench/tools/verify-tasks.sh
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS="$ROOT/bench/tools"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAILURES=0
SKIPPED=0

stage() {
  local dir="$WORK/$1"
  rm -rf "$dir"
  mkdir -p "$dir"
  cp -R "$ROOT/bench/tasks/$1/." "$dir/"
  printf '%s' "$dir"
}

# 0 = pass, 70 = cannot check here, anything else = fail.
run_check() {
  local dir="$1"
  BRUINE_BENCH_TOOLS="$TOOLS" sh "$dir/check.sh" >"$dir/out.txt" 2>&1
  printf '%s' "$?"
}

expect() {
  local id="$1" dir="$2" want="$3"
  local code
  code="$(run_check "$dir")"
  if [ "$code" = "70" ]; then
    printf '  %-28s %s (no toolchain here: %s)\n' "$id" "$want" "$(tail -1 "$dir/out.txt")"
    SKIPPED=$((SKIPPED + 1))
    return
  fi
  if { [ "$want" = pass ] && [ "$code" = 0 ]; } || { [ "$want" = fail ] && [ "$code" != 0 ]; }; then
    printf '  %-28s %s\n' "$id" "$want"
  else
    printf '  %-28s UNEXPECTED (wanted %s, check exit %s)\n' "$id" "$want" "$code"
    tail -4 "$dir/out.txt" | sed 's/^/      /'
    FAILURES=$((FAILURES + 1))
  fi
}

# shellcheck source=./reference-fixes.sh
. "$TOOLS/reference-fixes.sh"

echo "pristine copies must fail (a green task measures nothing):"
for dir in "$ROOT"/bench/tasks/*/; do
  id="$(basename "$dir")"
  expect "$id" "$(stage "$id")" fail
done

echo
echo "after the reference fix they must pass:"
for id in "${REFERENCE_FIX_TASKS[@]}"; do
  dir="$(stage "$id")"
  apply_reference_fix "$id" "$dir"
  expect "$id" "$dir" pass
done

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "task set OK ($SKIPPED check(s) skipped: no toolchain on this machine)."
else
  echo "$FAILURES task check(s) did not behave as documented."
fi
exit "$FAILURES"
