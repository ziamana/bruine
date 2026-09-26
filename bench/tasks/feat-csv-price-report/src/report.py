"""The nightly price report.

`main` currently prints the raw rows; the summary it should print is missing.
"""

import csv
import sys


def read_rows(path):
    """Read the price file into a list of dicts."""
    with open(path, newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def main(argv=None):
    """Print the price report for the given CSV file."""
    args = list(sys.argv[1:] if argv is None else argv)
    if not args:
        print("usage: report.py <prices.csv>", file=sys.stderr)
        return 2
    rows = read_rows(args[0])
    for row in rows:
        print(f"{row['item']}: {row['price']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
