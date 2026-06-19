"""UI state blueprint — per-user UI preference endpoints.

All settings are stored as JSON in user_settings.ui_settings via the dynamic
registry in flasky/ui_settings.py. Adding a new UI setting requires no
migration — only a new SettingDef entry in REGISTRY. These endpoints persist
single keys.
"""
from flask import Blueprint, request, g, jsonify

from flasky import db
from flasky.utils import login_required
from flasky.ui_settings import set_setting, set_panel_widgets


ui_state_bp = Blueprint("ui_state", __name__, url_prefix="/api")


@ui_state_bp.route("/save_font_size/<int:font_size>")
@login_required
def save_font_size(font_size):
    set_setting(g.user, "font_size", font_size)
    db.session.commit()
    return jsonify(success=True, font_size=font_size)


@ui_state_bp.route("/save_mobile_font_size/<int:font_size>")
@login_required
def save_mobile_font_size(font_size):
    set_setting(g.user, "mobile_font_size", font_size)
    db.session.commit()
    return jsonify(success=True, font_size=font_size)


@ui_state_bp.route("/save_auto_save", methods=["POST"])
@login_required
def save_auto_save():
    auto_save = request.get_json().get("autoSave")
    auto_save = auto_save == 1 or auto_save is True
    set_setting(g.user, "auto_save", auto_save)
    db.session.commit()
    return jsonify(success=True, new_auto_save_setting=auto_save)


@ui_state_bp.route("/save_notes_row_count/<int:row_count>")
@login_required
def save_notes_row_count(row_count):
    set_setting(g.user, "notes_row_count", row_count)
    db.session.commit()
    return jsonify(success=True, new_row_count=row_count)


@ui_state_bp.route("/save_notes_height/<int:height>")
@login_required
def save_notes_height(height):
    set_setting(g.user, "notes_height", height)
    db.session.commit()
    return jsonify(success=True, new_height=height)


@ui_state_bp.route("/save_dark_mode/<int:dark_mode>")
@login_required
def save_dark_mode(dark_mode):
    dark_mode = dark_mode == 1
    set_setting(g.user, "dark_mode", dark_mode)
    db.session.commit()
    return jsonify(success=True, new_dark_mode_setting=dark_mode)


@ui_state_bp.route("/save_ui_state", methods=["POST"])
@login_required
def save_ui_state():
    data = request.get_json()
    if not data:
        return jsonify(success=False, reason="No data provided.")
    allowed = (
        "sidebar_collapsed",
        "right_panel_collapsed",
        "properties_collapsed",
        "preview_mode",
    )
    for key in allowed:
        if key in data:
            set_setting(g.user, key, bool(data[key]))
    if "panel_widgets" in data and isinstance(data["panel_widgets"], list):
        set_panel_widgets(g.user, data["panel_widgets"])
    db.session.commit()
    return jsonify(success=True)


@ui_state_bp.route("/save_font", methods=["POST"])
@login_required
def save_font():
    # Body is raw text (the font family string), not JSON.
    new_font = request.data.decode("utf-8")
    if len(new_font) < 250:
        set_setting(g.user, "font", new_font)
        db.session.commit()
        return jsonify(success=True, new_font=new_font)
    return jsonify(
        success=False, reason="Font exceeds max allowed character limit of 250."
    )


@ui_state_bp.route("/save_hide_title", methods=["POST"])
@login_required
def save_hide_title():
    hide_title = request.get_json().get("hideTitle")
    hide_title = hide_title == 1 or hide_title is True
    set_setting(g.user, "hide_title", hide_title)
    db.session.commit()
    return jsonify(success=True, new_hide_title_setting=hide_title)