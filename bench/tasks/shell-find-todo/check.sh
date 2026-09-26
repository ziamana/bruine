#!/usr/bin/env sh
# T36 shell task: the two report files must match the frozen ground truth, and
# the sources must be untouched (the prompt said "do not change any file").
set -eu
cd "$(dirname "$0")"
echo "kumo-bench-check-mode: file-report"
for f in found.txt count.txt; do
  if [ ! -f "$f" ]; then
    echo "$f was not written" >&2
    exit 1
  fi
done
if ! diff -u expected-files.txt found.txt >/dev/null 2>&1; then
  echo "found.txt does not match the expected list:" >&2
  diff -u expected-files.txt found.txt >&2 || true
  exit 1
fi
if [ "$(tr -d '[:space:]' < count.txt)" != "$(tr -d '[:space:]' < expected-count.txt)" ]; then
  echo "count.txt says $(cat count.txt), expected $(cat expected-count.txt)" >&2
  exit 1
fi
if [ "$(grep -rl 'TODO(kumo)' src docs | wc -l | tr -d '[:space:]')" != "$(tr -d '[:space:]' < expected-count.txt)" ]; then
  echo "the markers are gone: a source file was changed" >&2
  exit 1
fi
echo "the report matches and the sources are untouched"
