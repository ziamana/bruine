#!/usr/bin/env sh
# T36 shell task: the drafts are gone, the final names exist with their content,
# and the file that was never a draft has not moved.
set -eu
cd "$(dirname "$0")"
echo "kumo-bench-check-mode: file-report"
if ls docs/guides/draft-*.md >/dev/null 2>&1; then
  echo "a draft-*.md file is still there" >&2
  exit 1
fi
for f in getting-started.md deploy.md; do
  if [ ! -f "docs/guides/$f" ]; then
    echo "docs/guides/$f is missing" >&2
    exit 1
  fi
done
if [ ! -f docs/style.md ]; then
  echo "docs/style.md disappeared" >&2
  exit 1
fi
if ! diff -u expected-renamed.txt renamed.txt >/dev/null 2>&1; then
  echo "renamed.txt does not match the expected list:" >&2
  diff -u expected-renamed.txt renamed.txt >&2 || true
  exit 1
fi
echo "the renames and the report are right"
