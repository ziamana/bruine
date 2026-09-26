"""Order-preserving de-duplication, used by the import pipeline."""


def dedupe(items):
    """Return `items` without duplicates, first occurrence wins.

    The function currently empties and rebuilds the list it was handed, which
    the importer noticed: after importing, its own working list was a mess.
    """
    seen = set()
    kept = []
    for item in items:
        if item in seen:
            continue
        seen.add(item)
        kept.append(item)
    items[:] = kept
    return kept
