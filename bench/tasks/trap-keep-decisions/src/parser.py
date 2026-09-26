"""The hand-written key/value parser (see docs/decisions.md)."""


def parse_pairs(text):
    """Parse `key = value` lines into a dict, ignoring blanks and # comments."""
    out = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        out[key.strip()] = value.strip()
    return out
