"""UI state blueprint — per-user UI preference endpoints.

All settings are stored as JSON in user_settings.ui_settings via the dynamic
registry in flasky/ui_settings.py. Adding a new UI setting requires no
migration — only a new SettingDef entry in REGISTRY. These endpoints persist
single keys.
"""
import re

from flask import Blueprint, request, g, jsonify

from flasky import db
from flasky.utils import login_required
from flasky.ui_settings import (
    set_setting, set_panel_widgets, CUSTOMIZABLE_VARS,
)

ui_state_bp = Blueprint("ui_state", __name__, url_prefix="/api")

# Accept hex colors (#rgb / #rrggbb / #rrggbbaa / #rrrrggggbbbb), CSS named
# colors, and rgba()/rgb() function calls. Empty string means "reset to
# default" and is allowed.
_COLOR_RE = re.compile(
    r"^(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|[a-zA-Z-]+)$"
)


def _is_valid_color_value(val):
    if not isinstance(val, str):
        return False
    val = val.strip()
    if not val:
        return True
    return bool(_COLOR_RE.match(val))


@ui_state_bp.route("/save_font_size/<int:font_size>")
@login_required
def save_font_size(font_size):
    set_setting(g.user, "font_size", font_size)
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


@ui_state_bp.route("/save_dark_mode/<int:dark_mode>")
@login_required
def save_dark_mode(dark_mode):
    dark_mode = dark_mode == 1
    set_setting(g.user, "dark_mode", dark_mode)
    db.session.commit()
    return jsonify(success=True, new_dark_mode_setting=dark_mode)


@ui_state_bp.route("/save_compact_mode/<int:compact_mode>")
@login_required
def save_compact_mode(compact_mode):
    compact_mode = compact_mode == 1
    set_setting(g.user, "compact_mode", compact_mode)
    db.session.commit()
    return jsonify(success=True, new_compact_mode_setting=compact_mode)


@ui_state_bp.route("/save_spotlight_mode/<int:spotlight_mode>")
@login_required
def save_spotlight_mode(spotlight_mode):
    spotlight_mode = spotlight_mode == 1
    set_setting(g.user, "spotlight_mode", spotlight_mode)
    db.session.commit()
    return jsonify(success=True, new_spotlight_mode_setting=spotlight_mode)


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


@ui_state_bp.route("/save_hide_title", methods=["POST"])
@login_required
def save_hide_title():
    hide_title = request.get_json().get("hideTitle")
    hide_title = hide_title == 1 or hide_title is True
    set_setting(g.user, "hide_title", hide_title)
    db.session.commit()
    return jsonify(success=True, new_hide_title_setting=hide_title)


@ui_state_bp.route("/save_font_family", methods=["POST"])
@login_required
def save_font_family():
    data = request.get_json(silent=True) or {}
    font = (data.get("font") or "").strip()
    if len(font) > 200:
        return jsonify(success=False, reason="Font family too long."), 400
    set_setting(g.user, "font", font)
    db.session.commit()
    return jsonify(success=True, font=font)


@ui_state_bp.route("/save_custom_colors", methods=["POST"])
@login_required
def save_custom_colors():
    data = request.get_json(silent=True) or {}
    colors = data.get("colors")
    if not isinstance(colors, dict):
        return jsonify(success=False, reason="colors must be an object."), 400
    # Validate structure: {"dark": {var: val}, "light": {var: val}}
    cleaned = {}
    for mode in ("dark", "light"):
        mode_colors = colors.get(mode)
        if mode_colors is None:
            continue
        if not isinstance(mode_colors, dict):
            return jsonify(
                success=False, reason=f"{mode} must be an object."
            ), 400
        cleaned_mode = {}
        for var, val in mode_colors.items():
            if var not in CUSTOMIZABLE_VARS:
                continue
            if not _is_valid_color_value(val):
                return jsonify(
                    success=False, reason=f"Invalid color for {var}."
                ), 400
            stripped = val.strip()
            if stripped:
                cleaned_mode[var] = stripped
        if cleaned_mode:
            cleaned[mode] = cleaned_mode
    set_setting(g.user, "custom_colors", cleaned)
    db.session.commit()
    return jsonify(success=True, colors=cleaned)


@ui_state_bp.route("/save_custom_css", methods=["POST"])
@login_required
def save_custom_css():
    data = request.get_json(silent=True) or {}
    css = data.get("css")
    if not isinstance(css, str):
        return jsonify(success=False, reason="css must be a string."), 400
    if len(css) > 50000:
        return jsonify(success=False, reason="CSS too long."), 400
    set_setting(g.user, "custom_css", css)
    db.session.commit()
    return jsonify(success=True)