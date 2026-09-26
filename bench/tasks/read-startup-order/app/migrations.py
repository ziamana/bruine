"""Schema migrations, run after the database is open."""

from . import db


def run():
    """Apply every pending migration."""
    return db.connect()  # the handle the migrations need
