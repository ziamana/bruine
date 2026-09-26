#!/usr/bin/env sh
# T36 — one stable digest for "this file (or this text) must not change"
# checks. Uses the first hash tool the machine has; the value is compared
# inside the same run, so the tool choice never has to agree across machines.
#
# Usage: file-digest.sh <file>   |   … | file-digest.sh -
set -eu

TARGET="${1:--}"

digest() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 | cut -d' ' -f1
  elif command -v cksum >/dev/null 2>&1; then
    cksum | cut -d' ' -f1
  else
    echo "file-digest.sh: no hash tool on this machine" >&2
    exit 70
  fi
}

if [ "$TARGET" = "-" ]; then
  digest
else
  digest < "$TARGET"
fi
