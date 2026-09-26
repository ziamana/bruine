"""The service entry point."""

from . import config as config_module
from . import db
from . import migrations
from . import seed


def main():
    config_module.load_config()
    db.connect()
    migrations.run()
    seed.apply()
    return 0
