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
    set_setting, set_panel_widgets, set_topbar_items, CUSTOMIZABLE_VARS,
    _load_raw, _save_raw,
)
from flasky.theme_presets import is_valid_preset_id

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


_FORBIDDEN_CSS_RE = re.compile(r"</style|<script|</script", re.IGNORECASE)


def _validate_css(css):
    if not isinstance(css, str):
        return "css must be a string."
    if len(css) > 50000:
        return "CSS too long."
    if _FORBIDDEN_CSS_RE.search(css):
        return "CSS contains forbidden markup."
    return None


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
        "render_embeds_in_edit_mode",
        "live_preview",
    )
    for key in allowed:
        if key in data:
            set_setting(g.user, key, bool(data[key]))
    if "panel_widgets" in data and isinstance(data["panel_widgets"], list):
        set_panel_widgets(g.user, data["panel_widgets"])
    if "topbar_items" in data and isinstance(data["topbar_items"], list):
        set_topbar_items(g.user, data["topbar_items"])
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
    err = _validate_css(data.get("css"))
    if err:
        return jsonify(success=False, reason=err), 400
    set_setting(g.user, "custom_css", data["css"])
    db.session.commit()
    return jsonify(success=True)


@ui_state_bp.route("/save_preset", methods=["POST"])
@login_required
def save_preset():
    data = request.get_json(silent=True) or {}
    preset_id = data.get("preset")
    if not isinstance(preset_id, str):
        return jsonify(success=False, reason="preset must be a string."), 400
    preset_id = preset_id.strip()
    if not is_valid_preset_id(preset_id):
        return jsonify(success=False, reason="Unknown preset."), 400
    set_setting(g.user, "active_preset", preset_id)
    db.session.commit()
    return jsonify(success=True, preset=preset_id)


@ui_state_bp.route("/save_theme_animations", methods=["POST"])
@login_required
def save_theme_animations():
    data = request.get_json(silent=True) or {}
    enabled = data.get("enabled")
    enabled = enabled == 1 or enabled is True
    set_setting(g.user, "theme_animations_enabled", enabled)
    db.session.commit()
    return jsonify(success=True, enabled=enabled)


def _clean_colors(colors):
    if not isinstance(colors, dict):
        return None
    cleaned = {}
    for mode in ("dark", "light"):
        mode_colors = colors.get(mode)
        if mode_colors is None or not isinstance(mode_colors, dict):
            continue
        cleaned_mode = {}
        for var, val in mode_colors.items():
            if var not in CUSTOMIZABLE_VARS:
                continue
            if not _is_valid_color_value(val):
                return None
            stripped = val.strip()
            if stripped:
                cleaned_mode[var] = stripped
        if cleaned_mode:
            cleaned[mode] = cleaned_mode
    return cleaned


@ui_state_bp.route("/save_appearance", methods=["POST"])
@login_required
def save_appearance():
    """Batch-save appearance settings in a single read-modify-write cycle.

    The individual /save_custom_colors, /save_custom_css, /save_font_family,
    /save_font_size, /save_preset, /save_theme_animations, and /save_dark_mode
    endpoints each do their own _load_raw → _save_raw.  Firing them
    concurrently (as the old JS did) causes last-write-wins data loss because
    every request starts from the same JSON snapshot.  This endpoint performs
    one load, applies all provided keys, then saves once.
    """
    data = request.get_json(silent=True) or {}

    raw = _load_raw(g.user)

    if "colors" in data:
        cleaned = _clean_colors(data["colors"])
        if cleaned is None:
            return jsonify(success=False, reason="Invalid colors."), 400
        raw["custom_colors"] = cleaned

    if "css" in data:
        err = _validate_css(data["css"])
        if err:
            return jsonify(success=False, reason=err), 400
        raw["custom_css"] = data["css"]

    if "font" in data:
        font = (data["font"] or "").strip()
        if len(font) > 200:
            return jsonify(success=False, reason="Font family too long."), 400
        raw["font"] = font

    if "font_size" in data:
        fs = data["font_size"]
        if not isinstance(fs, int) or not (8 <= fs <= 40):
            return jsonify(success=False, reason="font_size out of range."), 400
        raw["font_size"] = fs

    if "active_preset" in data:
        preset_id = data["active_preset"]
        if not isinstance(preset_id, str):
            return jsonify(success=False, reason="preset must be a string."), 400
        preset_id = preset_id.strip()
        if not is_valid_preset_id(preset_id):
            return jsonify(success=False, reason="Unknown preset."), 400
        raw["active_preset"] = preset_id

    if "theme_animations_enabled" in data:
        enabled = data["theme_animations_enabled"]
        raw["theme_animations_enabled"] = enabled == 1 or enabled is True

    if "dark_mode" in data:
        raw["dark_mode"] = bool(data["dark_mode"])

    if "tts_enabled" in data:
        raw["tts_enabled"] = bool(data["tts_enabled"])

    if "tts_autoplay_ai" in data:
        raw["tts_autoplay_ai"] = bool(data["tts_autoplay_ai"])

    if "tts_rate" in data:
        try:
            r = float(data["tts_rate"])
            if 0.5 <= r <= 2.0:
                raw["tts_rate"] = r
        except (TypeError, ValueError):
            pass

    if "tts_volume" in data:
        try:
            v = float(data["tts_volume"])
            if 0.0 <= v <= 1.0:
                raw["tts_volume"] = v
        except (TypeError, ValueError):
            pass

    if "tts_voice_uri" in data:
        uri = data["tts_voice_uri"]
        if isinstance(uri, str) and len(uri) <= 200:
            raw["tts_voice_uri"] = uri

    _save_raw(g.user, raw)
    db.session.commit()
    return jsonify(success=True)