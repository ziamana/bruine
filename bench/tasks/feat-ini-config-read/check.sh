#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
TOOLS="${BRUINE_BENCH_TOOLS:-../../tools}"
exec "$TOOLS/node-tests.sh" test/config.tests.ts
