#!/usr/bin/env sh
# T36 refactor: the tests must stay green AND the nesting must be gone.
set -eu
cd "$(dirname "$0")"
TOOLS="${KUMO_BENCH_TOOLS:-../../tools}"
"$TOOLS/node-tests.sh" test/quote.tests.ts
# The if/else pyramid is what we are removing: no line may be indented by 6
# spaces or more inside the function body.
if grep -qE '^ {6,}' src/quote.ts; then
  echo "src/quote.ts still nests: a line is indented six spaces or more" >&2
  exit 1
fi
echo "no deep nesting left"
