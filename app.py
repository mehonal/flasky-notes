"""Backward-compatibility shim.

Imports from this module (e.g. ``from app import app, db, User``) continue to
work exactly as before.  The real implementation now lives in the ``flasky``
package.
"""

from flasky import create_app, db
from flasky.models import (
    Theme, UserTheme, UserSettings, ApiToken, SyncConflict, Attachment,
    User, UserNote, UserNoteCategory, UserTodo, UserEvent, UserAgendaNotes,
)

app = create_app()
