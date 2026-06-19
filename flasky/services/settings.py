"""User settings service — timezone, sync toggle, AI settings, etc.
Owns writes to UserSettings rows.
"""
from zoneinfo import available_timezones

from flasky import db


def set_timezone(user, timezone):
    """Set the user's timezone. Falls back to UTC on invalid input."""
    if (
        timezone is None
        or timezone == ""
        or timezone not in available_timezones()
    ):
        timezone = "UTC"
    settings = user.return_settings()
    if settings is None:
        return False
    settings.timezone = timezone
    db.session.commit()
    return True