"""The database connection, opened once at startup."""


def connect():
    """Open the database and keep the handle."""
    return {"open": True}
