#!/usr/bin/env sh
# T36 bug fix: the repo's own tests must pass.
set -eu
cd "$(dirname "$0")"
TOOLS="${KUMO_BENCH_TOOLS:-../../tools}"
exec "$TOOLS/node-tests.sh" test/range.tests.ts
