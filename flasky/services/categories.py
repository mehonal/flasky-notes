"""Category CRUD service. With mandatory E2EE, category names are opaque
ciphertext — the server cannot look them up by name or compute child path
prefixes. Rename/move operations receive pre-computed encrypted names for the
affected categories from the client.
"""
from flasky import db
from flasky.models import UserNoteCategory, UserNote


class CategoryNotFound(LookupError):
    pass


def get_or_create_main_category(user):
    """Return the user's main category (first by id), creating an empty one
    if the user has none. Used as the fallback when note/category operations
    receive no explicit category.
    """
    cat = user.get_main_category()
    if cat is None:
        cat = UserNoteCategory(user_id=user.id, name="")
        db.session.add(cat)
        db.session.commit()
    return cat


def _get_category(user, category_id):
    cat = UserNoteCategory.query.filter_by(id=category_id, user_id=user.id).first()
    if cat is None:
        raise CategoryNotFound(category_id)
    return cat


def create_category(user, name):
    cat = UserNoteCategory(user_id=user.id, name=name)
    db.session.add(cat)
    db.session.commit()
    return cat


def rename_category(user, category_id, renames):
    _get_category(user, category_id)
    if not renames:
        raise ValueError("renames is required (encrypted folder names)")
    for r in renames:
        cat = UserNoteCategory.query.filter_by(id=r["id"], user_id=user.id).first()
        if cat:
            cat.name = r["name"]
    db.session.commit()


def move_category(user, category_id, renames):
    cat = UserNoteCategory.query.filter_by(id=category_id).first()
    if not cat or cat.user != user:
        raise CategoryNotFound(category_id)
    if not renames:
        raise ValueError("renames is required (encrypted folder names)")
    for r in renames:
        c = UserNoteCategory.query.filter_by(id=r["id"], user_id=user.id).first()
        if c:
            c.name = r["name"]
    db.session.commit()


def delete_category(user, category_id):
    cat = _get_category(user, category_id)
    main = get_or_create_main_category(user)
    if cat.id == main.id:
        raise ValueError("Cannot delete the Main folder")
    for note in UserNote.query.filter_by(category_id=category_id):
        note.category_id = main.id
    db.session.commit()
    db.session.delete(cat)
    db.session.commit()


def set_category_icon(user, category_id, icon, icon_color):
    cat = _get_category(user, category_id)
    cat.icon = icon
    cat.icon_color = icon_color
    db.session.commit()
    return cat


def set_default_note_icon(user, category_id, icon, icon_color):
    cat = _get_category(user, category_id)
    cat.default_note_icon = icon
    cat.default_note_icon_color = icon_color
    db.session.commit()
    return cat


def set_folder_template(user, category_id, template_id):
    cat = _get_category(user, category_id)
    cat.default_template_id = template_id
    db.session.commit()
    return cat


def sidebar_tree_data(user):
    categories = [
        {
            "id": cat.id,
            "name": cat.name,
            "icon": cat.icon,
            "icon_color": cat.icon_color,
            "default_note_icon": cat.default_note_icon,
            "default_note_icon_color": cat.default_note_icon_color,
        }
        for cat in sorted(user.categories, key=lambda c: c.id)
    ]
    notes = [
        {
            "id": n.id,
            "title": n.title,
            "category_id": n.category_id,
            "icon": n.icon,
            "icon_color": n.icon_color,
            "date_last_changed": n.date_last_changed.isoformat()
            if n.date_last_changed
            else None,
        }
        for n in UserNote.query.filter_by(userid=user.id)
        .order_by(UserNote.date_last_changed.desc())
        .all()
    ]
    return categories, notes


def note_map(user):
    from flasky.models import Attachment

    notes = UserNote.query.filter_by(userid=user.id).all()
    attachments = Attachment.query.filter_by(user_id=user.id).all()
    return (
        [{"id": n.id, "title": n.title} for n in notes],
        [{"id": a.id, "filename": a.filename} for a in attachments],
    )