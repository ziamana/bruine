#!/usr/bin/env bash
# T36 — the reference solution of every task, used by verify-tasks.sh to prove a
# pristine copy is red and that check.sh turns green after real work. This is a
# bench self-check aid, NOT part of a measurement: nothing here runs during a
# benchmark run.
#
# Sourced by verify-tasks.sh, which provides `apply_reference_fix <id> <dir>`.
set -u

REFERENCE_FIX_TASKS=(
  bug-range-end
  bug-group-by-key
  bug-money-cents
  bug-cache-key
  bug-dedupe-mutates
  bug-clone-shares-array
  feat-slug-and-title
  feat-ini-config-read
  feat-debounce-window
  feat-csv-price-report
  refactor-early-return
  refactor-magic-numbers
  refactor-merge-helpers
  read-default-port
  read-startup-order
  read-import-cycle
  shell-find-todo
  shell-rename-draft
  trap-keep-decisions
  trap-no-clobber-defaults
)

apply_reference_fix() {
  local id="$1" dir="$2"
  case "$id" in
    bug-range-end)
      sed -i 's/i < end/i <= end/' "$dir/src/range.ts" ;;
    bug-group-by-key)
      cat > "$dir/src/group-by.ts" <<'EOF'
export interface User {
  name: string;
  role: string;
}

/** Users per role. */
export function groupBy(users: User[], key: (user: User) => string): Record<string, User[]> {
  const out: Record<string, User[]> = {};
  for (const user of users) {
    const role = key(user);
    out[role] ??= [];
    out[role].push(user);
  }
  return out;
}
EOF
      ;;
    bug-money-cents)
      cat > "$dir/src/money.ts" <<'EOF'
/** A price in cents, with a tax rate like 0.2 for 20%. */
export interface Invoice {
  cents: number;
  taxRate: number;
}

/** The invoice total in cents, tax included. */
export function totalWithTax(invoice: Invoice): number {
  return Math.round(invoice.cents + invoice.cents * invoice.taxRate);
}
EOF
      ;;
    bug-cache-key)
      sed -i 's/String(args\[0\])/JSON.stringify(args)/' "$dir/src/memoize.ts" ;;
    bug-dedupe-mutates)
      sed -i '/items\[:\] = kept/d' "$dir/src/dedupe.py" ;;
    bug-clone-shares-array)
      sed -i 's/copied.Items = b.Items;/copied.Items = append([]string(nil), b.Items...);/' "$dir/basket.go" ;;
    feat-slug-and-title)
      cat > "$dir/src/slug.ts" <<'EOF'
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
EOF
      cat > "$dir/src/format.ts" <<'EOF'
import { slugify } from "./slug.ts";

/** A published article. */
export interface Article {
  title: string;
  body: string;
}

export function formatTitle(article: Article): string {
  return `${article.title} (${slugify(article.title)})`;
}
EOF
      ;;
    feat-ini-config-read)
      cat > "$dir/src/ini.ts" <<'EOF'
export function readIni(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;
    const at = line.indexOf("=");
    if (at <= 0) continue;
    const value = line.slice(at + 1).trim();
    out[line.slice(0, at).trim()] = /^".*"$|^'.*'$/.test(value) ? value.slice(1, -1) : value;
  }
  return out;
}
EOF
      cat >> "$dir/src/config.ts" <<'EOF'

import { readIni } from "./ini.ts";

export function loadConfig(text: string): AppConfig {
  const values = readIni(text);
  return {
    host: values["host"] ?? DEFAULTS.host,
    port: values["port"] === undefined ? DEFAULTS.port : Number(values["port"]),
    verbose: values["verbose"] === undefined ? DEFAULTS.verbose : values["verbose"] === "true",
  };
}
EOF
      ;;
    feat-debounce-window)
      cat > "$dir/src/debounce.ts" <<'EOF'
export type Debounced<A extends unknown[]> = (...args: A) => void;

export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  waitMs: number,
): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: A): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      fn(...args);
    }, waitMs);
  };
}
EOF
      cat > "$dir/src/rate-limit.ts" <<'EOF'
import { debounce } from "./debounce.ts";

export interface RateLimiterOptions {
  waitMs: number;
}

export type Scheduled = () => void;

export class RateLimiter {
  readonly #run: () => void;
  #pending: Scheduled | undefined;

  constructor(options: RateLimiterOptions) {
    this.#run = debounce(() => {
      const task = this.#pending;
      this.#pending = undefined;
      task?.();
    }, options.waitMs);
  }

  schedule(task: Scheduled): void {
    this.#pending = task;
    this.#run();
  }
}
EOF
      ;;
    feat-csv-price-report)
      cat > "$dir/src/summary.py" <<'EOF'
"""Price-drop summary."""


def summarize(rows):
    """Count the rows, list the items whose price dropped, name the cheapest."""
    drops = sorted(row["item"] for row in rows if int(row["price"]) < int(row["previous"]))
    cheapest = min(rows, key=lambda row: int(row["price"]))["item"] if rows else None
    return {"count": len(rows), "drops": drops, "cheapest": cheapest}
EOF
      python3 - "$dir" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1]) / "src" / "report.py"
t = p.read_text()
t = t.replace("import csv\nimport sys\n", "import csv\nimport sys\n\nfrom src.summary import summarize\n")
t = t.replace(
    """    rows = read_rows(args[0])
    for row in rows:
        print(f"{row['item']}: {row['price']}")
    return 0""",
    """    summary = summarize(read_rows(args[0]))
    print(f"{summary['count']} items")
    for item in summary["drops"]:
        print(f"drop: {item}")
    if summary["cheapest"] is not None:
        print(f"cheapest: {summary['cheapest']}")
    return 0""",
)
p.write_text(t)
PY
      ;;
    refactor-early-return)
      python3 - "$dir" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1]) / "src" / "quote.ts"
t = p.read_text()
p.write_text(
    t[: t.index("export function quoteFor")]
    + """export function quoteFor(customer: Customer, net: number): Quote {
  if (!customer.member) {
    const rate = RATES[customer.country];
    if (rate === undefined) return { total: net, currency: "EUR", discount: 0 };
    return { total: net * rate, currency: "USD", discount: 0 };
  }
  if (customer.coupon !== "WELCOME") {
    if (net > 100) return { total: net * 0.95, currency: "EUR", discount: 5 };
    return { total: net, currency: "EUR", discount: 0 };
  }
  if (net > 100) return { total: net * 0.9, currency: "EUR", discount: 10 };
  return { total: net * 0.95, currency: "EUR", discount: 5 };
}
"""
)
PY
      ;;
    refactor-magic-numbers)
      cat > "$dir/src/shipping.py" <<'EOF'
"""Shipping costs for the little shop."""

BASE_PRICE = 2.5
PER_KILO = 0.1
EXPRESS_FACTOR = 1.5
HEAVY_LIMIT_KG = 50
FREE_OVER = 50.0


def shipping_cost(weight_kg, express=False):
    """What the customer pays for shipping one parcel."""
    base = BASE_PRICE + PER_KILO * weight_kg
    if express:
        return base * EXPRESS_FACTOR
    if weight_kg > HEAVY_LIMIT_KG:
        return 0.0
    return base


def free_over(order_total):
    """Shipping is free above this order total."""
    return order_total >= FREE_OVER
EOF
      ;;
    refactor-merge-helpers)
      cat > "$dir/src/text.ts" <<'EOF'
/** The one true normaliser. */
export function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Kept for the search index. */
export const searchKey = normalize;

/** Kept for the dedupe job. */
export const dedupeKey = normalize;
EOF
      ;;
    read-default-port)
      printf '8080\nthe PORT environment variable overrides it\n' > "$dir/answer.txt" ;;
    read-startup-order)
      printf 'load_config, connect, run, apply\nconnect opens the database\n' > "$dir/answer.txt" ;;
    read-import-cycle)
      printf 'report.ts imports dates.ts, which imports util.ts. No, there is no import cycle.\n' > "$dir/answer.txt" ;;
    shell-find-todo)
      ( cd "$dir" && grep -rl 'TODO(bruine)' src docs | sort > found.txt && wc -l < found.txt | tr -d ' ' > count.txt ) ;;
    shell-rename-draft)
      ( cd "$dir" && for f in docs/guides/draft-*.md; do
          mv "$f" "docs/guides/$(basename "$f" | sed 's/^draft-//')"
        done
        ( cd docs/guides && ls *.md | grep -v '^expected-' | sort | sed 's|^|docs/guides/|' ) > renamed.txt ) ;;
    trap-keep-decisions)
      python3 - "$dir" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1]) / "src" / "parser.py"
p.write_text(
    p.read_text()
    .replace('key, value = line.split("=", 1)', 'key, _, value = line.partition("=")')
    .replace(
        "        out[key.strip()] = value.strip()",
        "        if key.strip() not in out:\n            out[key.strip()] = value.strip()",
    )
)
log = pathlib.Path(sys.argv[1]) / "docs" / "decisions.md"
log.write_text(log.read_text() + "- 2026-09-26: duplicate keys keep the first value.\n")
PY
      ;;
    trap-no-clobber-defaults)
      cat > "$dir/src/args.ts" <<'EOF'
/** What the CLI understood from its arguments. */
export interface CliArgs {
  configPath?: string;
}

/** Parse the CLI arguments. */
export function parseArgs(argv: string[]): CliArgs {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== "--config") continue;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) return { configPath: next };
  }
  return {};
}
EOF
      ;;
    *)
      echo "no reference fix for task $id" >&2
      return 1 ;;
  esac
}
