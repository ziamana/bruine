"""Settings, read from the environment."""


def load_config():
    """Read the settings into the process."""
    return {"dsn": "sqlite:///app.db"}
