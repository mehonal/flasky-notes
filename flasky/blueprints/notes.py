"""Notes blueprint — note CRUD endpoints (split from notes_api.py)."""
from flask import request, g, jsonify
from flask_smorest import Blueprint as SmorestBlueprint

from flasky.utils import login_required
from flasky.services import notes as notes_service
from flasky.services.notes import NoteNotFound, NotOwner
from flasky.schemas.notes import SaveNoteSchema, NoteIdSchema


notes_bp = SmorestBlueprint("notes", __name__, url_prefix="/api")


@notes_bp.route("/get_all_notes")
@login_required
def get_all_notes_api():
    notes = [n.return_json() for n in notes_service.list_notes(g.user)]
    return jsonify(notes)


@notes_bp.route("/note/check_last_edited/<int:note_id>")
@login_required
def check_last_edited_note_api(note_id):
    try:
        note = notes_service.get_owned_note(g.user, note_id)
    except NoteNotFound:
        return jsonify(success=False, reason="Note does not exist.")
    except NotOwner:
        return jsonify(success=False, reason="Note does not exist.")
    return jsonify(
        success=True,
        last_updated=f"Note last updated {note.return_time_ago()} ago.",
    )


@notes_bp.route("/save_note", methods=["POST"])
@login_required
@notes_bp.arguments(SaveNoteSchema)
def save_note(data):
    note_id = data["noteId"]
    title = data.get("title")
    content = data.get("content")
    category = data.get("category")
    properties = data.get("properties")
    icon = data.get("icon")
    icon_color = data.get("iconColor")
    # Coerce category to int if it's a string that parses to one
    try:
        category = int(category)
    except (ValueError, TypeError):
        pass
    if note_id == 0:
        note = notes_service.create_note(
            g.user, title, content, category,
            properties=properties, icon=icon, icon_color=icon_color,
        )
        return jsonify(success=True, note=note.return_json())
    try:
        note = notes_service.update_note(
            g.user, note_id, title=title, content=content, category=category,
            properties=properties, icon=icon, icon_color=icon_color,
        )
    except NoteNotFound:
        return jsonify(success=False, reason="Note does not exist.")
    except NotOwner:
        return jsonify(success=False, reason="Note does not exist.")
    return jsonify(success=True, note=note.return_json())


@notes_bp.route("/revert_note", methods=["POST"])
@login_required
@notes_bp.arguments(NoteIdSchema)
def revert_note(data):
    try:
        note = notes_service.revert_note(g.user, data["noteId"])
    except NoteNotFound:
        return jsonify(success=False, reason="Note does not exist.")
    except NotOwner:
        return jsonify(success=False, reason="Note does not exist.")
    if note is None:
        return jsonify(success=False, reason="No previous version available.")
    return jsonify(success=True, note=note.return_json())


@notes_bp.route("/note/<int:note_id>")
@login_required
def get_note(note_id):
    try:
        note = notes_service.get_owned_note(g.user, note_id)
    except NoteNotFound:
        return jsonify(success=False, reason="Note does not exist.")
    except NotOwner:
        return jsonify(success=False, reason="Note does not exist.")
    data = note.return_json()
    data["category_id"] = note.category_id
    return jsonify(success=True, note=data)


@notes_bp.route("/delete_note", methods=["POST"])
@login_required
@notes_bp.arguments(NoteIdSchema)
def delete_note(data):
    ok = notes_service.delete_note(g.user, data["noteId"])
    if not ok:
        return jsonify(success=False, reason="Note does not exist.")
    return jsonify(success=True)


@notes_bp.route("/note-map")
@login_required
def note_map():
    from flasky.services.categories import note_map as _nm
    note_list, att_list = _nm(g.user)
    return jsonify({"notes": note_list, "attachments": att_list, "encrypted": True})


@notes_bp.route("/sidebar_tree")
@login_required
def sidebar_tree():
    """Return raw JSON data for client-side sidebar rendering. With mandatory
    E2EE the sidebar is always built client-side.
    """
    from flasky.services.categories import sidebar_tree_data

    categories, notes = sidebar_tree_data(g.user)
    return jsonify(success=True, encrypted=True, categories=categories, notes=notes)


@notes_bp.route("/sidebar_tree_data")
@login_required
def sidebar_tree_data_endpoint():
    """JSON-only sidebar data (back-compat alias for /sidebar_tree)."""
    from flasky.services.categories import sidebar_tree_data

    categories, notes = sidebar_tree_data(g.user)
    return jsonify(success=True, categories=categories, notes=notes)