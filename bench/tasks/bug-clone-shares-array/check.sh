#!/usr/bin/env sh
# T36 bug fix (Go). A machine without a Go toolchain cannot check this task:
# exit 70 says "not checkable here", it is never scored as a failure.
set -eu
cd "$(dirname "$0")"
if ! command -v go >/dev/null 2>&1; then
  echo "no go toolchain on this machine" >&2
  exit 70
fi
echo "kumo-bench-check-mode: go-test"
export GOCACHE="${GOCACHE:-/tmp/kumo-bench-gocache}"
exec go test ./...
