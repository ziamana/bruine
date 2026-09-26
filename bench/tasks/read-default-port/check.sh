#!/usr/bin/env sh
# T36 read-the-project: every line of expected.txt must show up in answer.txt.
# The README lies about the port on purpose: the answer is only right if the
# code was read.
set -eu
cd "$(dirname "$0")"
echo "kumo-bench-check-mode: expected-answer"
if [ ! -f answer.txt ]; then
  echo "answer.txt was not written" >&2
  exit 1
fi
answer=$(tr 'A-Z' 'a-z' < answer.txt)
missing=0
while IFS= read -r want; do
  [ -n "$want" ] || continue
  if ! printf '%s' "$answer" | grep -q -- "$(printf '%s' "$want" | tr 'A-Z' 'a-z')"; then
    echo "answer.txt does not mention $want" >&2
    missing=1
  fi
done < expected.txt
[ "$missing" -eq 0 ] || exit 1
echo "answer.txt mentions everything expected"
