"""Categories blueprint — category CRUD endpoints (split from notes_api.py)."""
from flask import g, jsonify
from flask_smorest import Blueprint as SmorestBlueprint

from flasky.utils import login_required
from flasky.services import categories as cat_service
from flasky.services.categories import CategoryNotFound
from flasky.schemas.notes import (
    AddCategorySchema,
    EditNoteCategorySchema,
    RenameCategorySchema,
    MoveCategorySchema,
    DeleteCategorySchema,
    RenameNoteSchema,
    SetIconSchema,
    SetFolderIconSchema,
    SetDefaultNoteIconSchema,
)


categories_bp = SmorestBlueprint("categories", __name__, url_prefix="/api")


@categories_bp.route("/add_category", methods=["POST"])
@login_required
@categories_bp.arguments(AddCategorySchema)
def add_category(data):
    cat = cat_service.create_category(g.user, data["categoryName"])
    return jsonify(success=True, category=cat.id)


@categories_bp.route("/edit_note_category", methods=["POST"])
@login_required
@categories_bp.arguments(EditNoteCategorySchema)
def edit_note_category(data):
    from flasky.services.notes import update_note, NoteNotFound, NotOwner
    try:
        update_note(g.user, data["noteId"], category=data.get("category"))
    except NoteNotFound:
        return jsonify(success=False, reason="Note does not exist.")
    except NotOwner:
        return jsonify(success=False, reason="Note does not exist.")
    return jsonify(success=True)


@categories_bp.route("/rename_note", methods=["POST"])
@login_required
@categories_bp.arguments(RenameNoteSchema)
def rename_note(data):
    from flasky.services.notes import update_note, NoteNotFound, NotOwner
    try:
        update_note(g.user, data["noteId"], title=data["title"])
    except NoteNotFound:
        return jsonify(success=False, reason="Note does not exist.")
    except NotOwner:
        return jsonify(success=False, reason="Note does not exist.")
    return jsonify(success=True)


@categories_bp.route("/rename_category", methods=["POST"])
@login_required
@categories_bp.arguments(RenameCategorySchema)
def rename_category(data):
    try:
        cat_service.rename_category(g.user, data["categoryId"], data.get("renames"))
    except CategoryNotFound:
        return jsonify(success=False, reason="Category does not exist.")
    except ValueError as e:
        return jsonify(success=False, reason=str(e)), 400
    return jsonify(success=True)


@categories_bp.route("/set_note_icon", methods=["POST"])
@login_required
@categories_bp.arguments(SetIconSchema)
def set_note_icon(data):
    from flasky.services.notes import set_note_icon as _set_icon, NoteNotFound, NotOwner
    try:
        note = _set_icon(g.user, data["noteId"], data.get("icon"), data.get("iconColor"))
    except NoteNotFound:
        return jsonify(success=False, reason="Note does not exist.")
    except NotOwner:
        return jsonify(success=False, reason="Note does not exist.")
    return jsonify(
        success=True,
        icon=note.icon,
        icon_color=note.icon_color,
        resolved_icon=note.get_resolved_icon(),
        resolved_icon_color=note.get_resolved_icon_color(),
    )


@categories_bp.route("/set_folder_icon", methods=["POST"])
@login_required
@categories_bp.arguments(SetFolderIconSchema)
def set_folder_icon(data):
    cat = cat_service.set_category_icon(
        g.user, data["categoryId"], data.get("icon"), data.get("iconColor")
    )
    return jsonify(success=True, icon=cat.icon, icon_color=cat.icon_color)


@categories_bp.route("/set_default_note_icon", methods=["POST"])
@login_required
@categories_bp.arguments(SetFolderIconSchema)
def set_default_note_icon(data):
    cat = cat_service.set_default_note_icon(
        g.user, data["categoryId"], data.get("icon"), data.get("iconColor")
    )
    return jsonify(
        success=True,
        default_note_icon=cat.default_note_icon,
        default_note_icon_color=cat.default_note_icon_color,
    )


@categories_bp.route("/move_category", methods=["POST"])
@login_required
@categories_bp.arguments(MoveCategorySchema)
def move_category(data):
    try:
        cat_service.move_category(g.user, data["categoryId"], data["renames"])
    except CategoryNotFound:
        return jsonify(success=False, reason="Category does not exist.")
    except ValueError as e:
        return jsonify(success=False, reason=str(e)), 400
    return jsonify(success=True)


@categories_bp.route("/delete_category", methods=["POST"])
@login_required
@categories_bp.arguments(DeleteCategorySchema)
def delete_category(data):
    try:
        cat_service.delete_category(g.user, data["categoryId"])
    except CategoryNotFound:
        return jsonify(success=False, reason="Category does not exist.")
    except ValueError as e:
        return jsonify(success=False, reason=str(e)), 400
    return jsonify(success=True)