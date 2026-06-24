"""Note CRUD service. Owns create/update/delete/revert logic for notes."""
from datetime import datetime

from flasky import db
from flasky.models import UserNote, UserNoteCategory


class NoteNotFound(LookupError):
    pass


class NotOwner(Exception):
    def __init__(self, note_id):
        super().__init__(f"User does not own note {note_id}")
        self.note_id = note_id


def get_owned_note(user, note_id):
    note = UserNote.query.filter_by(id=note_id).first()
    if note is None:
        raise NoteNotFound(note_id)
    if note.user != user:
        raise NotOwner(note_id)
    return note


def resolve_default_category(user):
    """Return the category id to use when no explicit category is given.

    Honors the user's `default_category_id` UI setting if it points at an
    existing category the user still owns; otherwise falls back to the
    user's first category (creating one if none exists). Centralised so
    the editor, external API, and sync API all honour the same default.
    """
    from flasky.ui_settings import get_setting
    from flasky.services.categories import get_or_create_default_category

    cat_id = get_setting(user, "default_category_id")
    if cat_id and UserNoteCategory.query.filter_by(
        id=cat_id, user_id=user.id
    ).first():
        return cat_id
    return get_or_create_default_category(user).id


def create_note(user, title, content, category, properties=None, icon=None, icon_color=None):
    """Create a note owned by `user`. category is an int id (or a string that
    parses to one), or None/empty to use the user's default category
    (their configured default folder, falling back to the first category).
    Returns the new UserNote (committed).
    """
    if category is None or category == "":
        category = resolve_default_category(user)
    elif not isinstance(category, int):
        try:
            category = int(category)
        except (ValueError, TypeError):
            raise ValueError("Invalid category id")
    now = datetime.utcnow()
    note = UserNote(
        userid=user.id,
        title=title,
        content=content,
        category_id=category,
        date_added=now,
        date_last_changed=now,
    )
    if properties:
        note.properties = properties
    if icon is not None:
        note.icon = icon
        note.icon_color = icon_color
    db.session.add(note)
    db.session.commit()
    return note


def update_note(user, note_id, title=None, content=None, category=None,
                properties=None, icon=None, icon_color=None):
    note = get_owned_note(user, note_id)
    now = datetime.utcnow()
    if title is not None:
        note.title = title
        note.date_last_changed = now
    if content is not None:
        note.previous_content = note.content
        note.content = content
        note.date_last_changed = now
    if category is not None:
        if isinstance(category, int):
            note.category_id = category
        elif isinstance(category, str):
            try:
                note.category_id = int(category)
            except (ValueError, TypeError):
                pass
    if properties is not None:
        note.properties = properties
    if icon is not None:
        note.icon = icon
        note.icon_color = icon_color
    db.session.commit()
    return note


def delete_note(user, note_id):
    note = UserNote.query.filter_by(id=note_id, userid=user.id).first()
    if not note:
        return False
    db.session.delete(note)
    db.session.commit()
    return True


def revert_note(user, note_id):
    note = get_owned_note(user, note_id)
    if note.previous_content is None:
        return None
    old = note.content
    note.content = note.previous_content
    note.previous_content = old
    note.date_last_changed = datetime.utcnow()
    db.session.commit()
    return note


def list_notes(user, page=None, per_page=5):
    q = (
        UserNote.query.filter_by(userid=user.id)
        .order_by(UserNote.date_last_changed.desc())
    )
    if page is not None:
        return q.paginate(page=page, per_page=per_page).items
    return q.all()


def get_note_content(user, note_id):
    note = get_owned_note(user, note_id)
    return note.content or "", note.get_properties()


def set_note_icon(user, note_id, icon, icon_color):
    """Set or clear the icon on a note. Pass icon=None to clear."""
    note = get_owned_note(user, note_id)
    note.icon = icon
    note.icon_color = icon_color
    db.session.commit()
    return note