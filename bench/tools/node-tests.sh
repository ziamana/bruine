#!/usr/bin/env sh
# T36 — run node:test suites written in TypeScript, with whatever this machine
# actually supports. Node strips erasable types from 22.6 on (on by default
# from 22.18); older Node needs tsc. When neither is there the bench reports
# "cannot check here" (exit 70) instead of scoring the task 0: a missing
# toolchain is not a model failure.
#
# The suite runs on a throwaway copy whose `./x.js` import specifiers are
# pointed back at the `.ts` files, so an agent that tidied the extensions (or
# never touched them) is graded on the code, not on the import style.
#
# Usage: node-tests.sh test/foo.tests.ts [more.tests.ts ...]
set -eu

FILES="$*"
if [ -z "$FILES" ]; then
  echo "node-tests.sh: no test file given" >&2
  exit 70
fi

TASK_DIR="${BRUINE_BENCH_TASK_DIR:-.}"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
REPO="$WORK/repo"
mkdir -p "$REPO"
cp -R "$TASK_DIR/." "$REPO/"
rm -rf "$REPO/.git"

# ESM, always: a task copy lands in a temp directory that may sit under an
# unrelated package.json, and a `.ts` file with import statements is then
# loaded as CommonJS and dies with "Cannot use import statement outside a
# module". A task that ships its own package.json keeps it.
if [ ! -f "$REPO/package.json" ]; then
  printf '{\n  "name": "bruine-bench-task",\n  "private": true,\n  "type": "module"\n}\n' > "$REPO/package.json"
fi

# `./foo.js` → `./foo.ts` in import positions only.
find "$REPO" -name '*.ts' -type f -exec sed -i -E 's/(from|import\()[[:space:]]*"([^"]*)\.js"/\1 "\2.ts"/g' {} +

# The test files, now inside the copy.
COPIED=""
for f in $FILES; do
  COPIED="$COPIED $REPO/$f"
done

PROBE="$WORK/probe.ts"
printf 'const answer: number = 42;\n' > "$PROBE"

if node --experimental-strip-types --test "$PROBE" >/dev/null 2>&1; then
  echo "bruine-bench-check-mode: node-test"
  # shellcheck disable=SC2086
  exec node --experimental-strip-types --test $COPIED
fi

if node --test "$PROBE" >/dev/null 2>&1; then
  echo "bruine-bench-check-mode: node-test"
  # shellcheck disable=SC2086
  exec node --test $COPIED
fi

if command -v tsc >/dev/null 2>&1; then
  echo "bruine-bench-check-mode: node-test+tsc"
  # sed already turned the specifiers into the .js form tsc wants.
  find "$REPO" -name '*.ts' -type f -exec sed -i -E 's/(from|import\()[[:space:]]*"([^"]*)\.ts"/\1 "\2.js"/g' {} +
  tsc --outDir "$WORK/out" --module nodenext --moduleResolution nodenext \
    --target es2022 --skipLibCheck --allowImportingTsExtensions false $(find "$REPO" -name '*.ts' | tr '\n' ' ')
  exec node --test "$WORK"/out/test/*.tests.js
fi

echo "node-tests.sh: no TypeScript-capable node (needs node >= 22.6) and no tsc" >&2
exit 70
