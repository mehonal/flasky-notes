"""Dynamic per-user UI settings registry.

Adding a new UI setting = add a SettingDef entry below + read it where needed.
No schema migration required — settings are stored as JSON in
user_settings.ui_settings. Unknown keys are ignored on read; missing keys
fall back to their declared default. Retired keys remain in old users'
JSON harmlessly.

This module is the single source of truth for UI setting defaults and
validation. Blueprints and templates read via get_setting(user, key);
writes go through set_setting(user, key, value) which enforces the
SettingDef validator.
"""

from dataclasses import dataclass
from typing import Any, Callable, Optional


@dataclass(frozen=True)
class SettingDef:
    key: str
    default: Any
    type: type
    validator: Optional[Callable[[Any], bool]] = None


# Default ordering + visibility of right-panel widgets. New widgets can be
# appended here; existing users pick them up automatically on next read via
# the forward-merge in get_panel_widgets().
DEFAULT_PANEL_WIDGETS = [
    {"id": "outline", "label": "Outline", "visible": True},
    {"id": "backlinks", "label": "Backlinks", "visible": True},
    {"id": "outbound_links", "label": "Outbound Links", "visible": True},
    {"id": "properties", "label": "Properties", "visible": True},
    {"id": "todos", "label": "To-dos", "visible": False},
    {"id": "events", "label": "Events", "visible": False},
    {"id": "quick_settings", "label": "Quick Settings", "visible": False},
]


def _is_int_in_range(low: int, high: int) -> Callable[[Any], bool]:
    def check(v: Any) -> bool:
        try:
            return low <= int(v) <= high
        except (TypeError, ValueError):
            return False

    return check


# Registry of all UI settings. To add a new setting, append a SettingDef here
# and read/write it via get_setting()/set_setting(). No migration required.
REGISTRY: dict[str, SettingDef] = {
    "font": SettingDef("font", "sans-serif", str),
    "font_size": SettingDef("font_size", 16, int, _is_int_in_range(8, 40)),
    "mobile_font_size": SettingDef("mobile_font_size", 15, int, _is_int_in_range(8, 40)),
    "dark_mode": SettingDef("dark_mode", False, bool),
    "hide_title": SettingDef("hide_title", False, bool),
    "notes_row_count": SettingDef("notes_row_count", 3, int, _is_int_in_range(1, 100)),
    "notes_height": SettingDef("notes_height", 150, int, _is_int_in_range(50, 2000)),
    "auto_save": SettingDef("auto_save", False, bool),
    "sidebar_collapsed": SettingDef("sidebar_collapsed", False, bool),
    "right_panel_collapsed": SettingDef("right_panel_collapsed", True, bool),
    "properties_collapsed": SettingDef("properties_collapsed", True, bool),
    "preview_mode": SettingDef("preview_mode", False, bool),
    "panel_widgets": SettingDef("panel_widgets", DEFAULT_PANEL_WIDGETS, list),
}


class AttrDict(dict):
    """Dict that also exposes its keys as attributes (ui_settings.sidebar_collapsed).

    Returned by get_all_settings() so templates can keep using the
    attribute-style access pattern the codebase has always used.
    Only the registered UI keys are exposed; nested dicts (panel_widgets is a
    list) are returned as-is.
    """

    def __getattr__(self, name):
        try:
            return self[name]
        except KeyError as exc:
            raise AttributeError(name) from exc

    def __setattr__(self, name, value):
        self[name] = value


def _load_raw(user) -> dict:
    """Read the raw ui_settings JSON dict from the user's UserSettings."""
    import json

    settings = getattr(user, "settings", None)
    if settings is None:
        return {}
    raw = getattr(settings, "ui_settings", None)
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except (json.JSONDecodeError, TypeError):
        return {}


def _save_raw(user, payload: dict) -> None:
    import json

    settings = getattr(user, "settings", None)
    if settings is None:
        return
    settings.ui_settings = json.dumps(payload)


def get_setting(user, key: str) -> Any:
    """Read one UI setting, falling back to the registry default."""
    defn = REGISTRY.get(key)
    if defn is None:
        raise KeyError(f"Unknown UI setting: {key!r}")
    raw = _load_raw(user)
    if key in raw:
        return raw[key]
    return defn.default


def get_all_settings(user) -> AttrDict:
    """Return an AttrDict of all registered UI settings for the user.

    Missing keys are filled from REGISTRY defaults; unknown keys in the stored
    JSON are ignored on read (forward-compat). The returned object supports both
    dict-style (settings["font_size"]) and attribute-style (settings.font_size)
    access for template ergonomics.
    """
    raw = _load_raw(user)
    out = AttrDict()
    for key, defn in REGISTRY.items():
        out[key] = raw.get(key, defn.default)
    return out


def set_setting(user, key: str, value: Any) -> bool:
    """Validate and persist one UI setting. Returns False on validation failure."""
    defn = REGISTRY.get(key)
    if defn is None:
        return False
    # Coerce + validate
    try:
        if defn.type is bool:
            # Accept bool, or 0/1 ints, or "true"/"false" strings.
            if isinstance(value, bool):
                coerced = value
            elif isinstance(value, int):
                coerced = bool(value)
            elif isinstance(value, str):
                coerced = value.strip().lower() in ("true", "1", "yes", "on")
            else:
                return False
        else:
            coerced = defn.type(value)
    except (TypeError, ValueError):
        return False
    if defn.validator is not None and not defn.validator(coerced):
        return False
    raw = _load_raw(user)
    raw[key] = coerced
    _save_raw(user, raw)
    return True


def get_panel_widgets(user) -> list[dict]:
    """Return the panel_widgets list with retired ids stripped and new defaults merged.

    Forward-compat: if a new widget is added to DEFAULT_PANEL_WIDGETS, existing
    users pick it up on next read instead of having it silently hidden forever.
    """
    widgets = get_setting(user, "panel_widgets")
    if not isinstance(widgets, list):
        return [dict(w) for w in DEFAULT_PANEL_WIDGETS]
    # Strip retired widget ids (e.g. "agenda" was removed in an earlier version)
    cleaned = [w for w in widgets if isinstance(w, dict) and w.get("id") != "agenda"]
    saved_ids = [w.get("id") for w in cleaned]
    for default_w in DEFAULT_PANEL_WIDGETS:
        if default_w["id"] not in saved_ids:
            cleaned.append(dict(default_w))
    return cleaned


def set_panel_widgets(user, widgets: list[dict]) -> bool:
    """Persist the panel_widgets list."""
    if not isinstance(widgets, list):
        return False
    raw = _load_raw(user)
    raw["panel_widgets"] = widgets
    _save_raw(user, raw)
    return True
