#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
TOOLS="${KUMO_BENCH_TOOLS:-../../tools}"
exec "$TOOLS/py-tests.sh"
