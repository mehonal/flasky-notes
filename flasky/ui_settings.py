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

import json
import re
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
    {"id": "link_graph", "label": "Link Graph", "visible": False},
]
# Note: the calendar widget is NOT in this shared default list because its
# presence is conditional on the per-user daily_note_enabled setting. It is
# injected per-user by get_panel_widgets() below.


# Default ordering + visibility of topbar action items (the right-side
# .toolbar-actions cluster). Compound controls are atomic: font_size is the
# [- label +] group, ai is the dropdown button + its menu. export and delete
# are separate items so users can hide one but not the other. dividers are
# first-class items so users can add/remove/move them like buttons.
# Feature-gated items (drawing, audio, daily_note, ai) are stripped by
# get_topbar_items() when their feature is off, mirroring how
# get_panel_widgets() strips the calendar widget. mobile_save is intentionally
# NOT here: it stays fixed at the end of .toolbar-actions and is shown/hidden
# purely via CSS (desktop vs. mobile).
DEFAULT_TOPBAR_ITEMS = [
    {"id": "font_size", "label": "Font size", "visible": True},
    {"id": "divider_1", "label": "Divider", "visible": True},
    {"id": "mode_toggle", "label": "Edit / Preview", "visible": True},
    {"id": "divider_2", "label": "Divider", "visible": True},
    {"id": "search", "label": "Search", "visible": True},
    {"id": "drawing", "label": "Drawing", "visible": True},
    {"id": "audio", "label": "Record audio", "visible": True},
    {"id": "daily_note", "label": "Daily note", "visible": True},
    {"id": "ai", "label": "Ask AI", "visible": True},
    {"id": "panel_toggle", "label": "Outline panel", "visible": True},
    {"id": "theme_toggle", "label": "Theme", "visible": True},
    {"id": "shortcuts", "label": "Shortcuts", "visible": True},
    {"id": "divider_3", "label": "Divider", "visible": False},
    {"id": "export", "label": "Export", "visible": True},
    {"id": "divider_4", "label": "Divider", "visible": False},
    {"id": "delete", "label": "Delete", "visible": True},
    {"id": "divider_5", "label": "Divider", "visible": False},
]

# Feature gates for topbar items. An item id maps to the ui_settings key whose
# truthiness determines whether the item is offered. Items not in this map are
# always available. Honored by get_topbar_items() so the customizer never shows
# a toggle for a button the feature flag has hidden.
_TOPBAR_FEATURE_GATES = {
    "drawing": "drawing_enabled",
    "audio": "audio_recording_enabled",
    "daily_note": "daily_note_enabled",
}
# ai is gated by UserSettings.ai_enabled (a column, not a ui_settings key), so
# it is handled separately in get_topbar_items() via the user.settings object.


_WIDTH_RE = re.compile(r"^([1-9]\d{0,3})(px|%)?$")


def _is_valid_width(v: Any) -> bool:
    if not isinstance(v, str):
        return False
    v = v.strip()
    if v == "" or v == "0":
        return True
    m = _WIDTH_RE.match(v)
    if not m:
        return False
    num, unit = int(m.group(1)), m.group(2)
    if unit == "%":
        return 1 <= num <= 100
    return 1 <= num <= 4000


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
    "font": SettingDef("font", "", str),
    "font_size": SettingDef("font_size", 16, int, _is_int_in_range(8, 40)),
    "dark_mode": SettingDef("dark_mode", False, bool),
    "compact_mode": SettingDef("compact_mode", False, bool),
    "spotlight_mode": SettingDef("spotlight_mode", False, bool),
    "hide_title": SettingDef("hide_title", False, bool),
    "auto_save": SettingDef("auto_save", False, bool),
    "sidebar_collapsed": SettingDef("sidebar_collapsed", False, bool),
    "right_panel_collapsed": SettingDef("right_panel_collapsed", True, bool),
    "properties_collapsed": SettingDef("properties_collapsed", True, bool),
    "preview_mode": SettingDef("preview_mode", False, bool),
    # Render ![[image]] and ![[drawing.fldraw]] embeds inline while editing
    # (CM6 widget decoration replaces the ![[...]] text visually without
    # altering the underlying document). Off by default — opt-in.
    "render_embeds_in_edit_mode": SettingDef("render_embeds_in_edit_mode", False, bool),
    # Live rendering in edit mode: hide markdown syntax (#, **, [](), etc.)
    # and render headings, emphasis, links, code blocks, callouts, and lists
    # as styled output. The raw source is revealed on the line holding the
    # cursor so it stays editable. Off by default — opt-in.
    "live_preview": SettingDef("live_preview", False, bool),
    "panel_widgets": SettingDef("panel_widgets", DEFAULT_PANEL_WIDGETS, list),
    "topbar_items": SettingDef("topbar_items", DEFAULT_TOPBAR_ITEMS, list),
    # Daily notes (optional). daily_note_template_id / daily_note_category_id
    # use 0 to mean "none" so they stay plain ints (no nullable coercion needed).
    "daily_note_enabled": SettingDef("daily_note_enabled", False, bool),
    "daily_note_title_format": SettingDef(
        "daily_note_title_format",
        "YYYY-MM-DD",
        str,
        lambda v: bool(v) and len(v) <= 100,
    ),
    "daily_note_template_id": SettingDef(
        "daily_note_template_id",
        0,
        int,
        _is_int_in_range(0, 999999999),
    ),
    "daily_note_category_id": SettingDef(
        "daily_note_category_id",
        0,
        int,
        _is_int_in_range(0, 999999999),
    ),
    "daily_note_open_on_start": SettingDef("daily_note_open_on_start", False, bool),
    # Where the daily-notes calendar widget renders. "left" places it in the
    # left sidebar; "right" in the right-panel widget stack alongside the
    # other widgets. Honored by applyWidgetLayout() on the client.
    "calendar_placement": SettingDef(
        "calendar_placement", "left", str,
        lambda v: v in ("left", "right"),
    ),
    # Default folder for new notes created outside a specific folder context
    # (e.g. the "New note" toolbar button). 0 = unset → first category by id.
    # Honored by create_note and the external/sync APIs when no category given.
    "default_category_id": SettingDef(
        "default_category_id", 0, int, _is_int_in_range(0, 999999999),
    ),
    # Drawing integration (canvas .fldraw). Disabled by default; the toolbar
    # button and slash command are hidden unless this is on.
    "drawing_enabled": SettingDef("drawing_enabled", False, bool),
    # Per-user theme customization. custom_colors is a dict mapping theme
    # mode ("dark"/"light") to {css_var: value} overrides for the ~10
    # customizable CSS variables. custom_css is raw user CSS appended after
    # the variable overrides. Both are injected into a <style> block that
    # comes after app.css / page inline styles so it wins the cascade.
    "custom_colors": SettingDef(
        "custom_colors", {}, dict,
        lambda v: isinstance(v, dict) and len(json.dumps(v)) <= 20000,
    ),
    "custom_css": SettingDef(
        "custom_css", "", str,
        lambda v: isinstance(v, str) and len(v) <= 50000,
    ),
    # Currently-applied one-click theme preset id ("" = none/Classic).
    # Used only to highlight the active card in the preset picker; the
    # actual colors/css come from custom_colors/custom_css. Cleared when
    # the user manually edits a color/font/css after applying a preset.
    "active_preset": SettingDef("active_preset", "", str),
    # Whether animated theme effects (keyframes, scanlines, etc.) are
    # applied when a preset is selected. When off, @keyframes and
    # animation: declarations are stripped from the preset CSS before
    # applying — static CSS (textures, font settings) is preserved.
    "theme_animations_enabled": SettingDef("theme_animations_enabled", True, bool),
    # Max render width for embedded attachments (images + videos) and .fldraw
    # drawings. Accepts "N", "Npx", "N%"; empty / "0" = full width. Bare
    # numbers get "px" appended client-side. Audio/PDF/links unaffected.
    "attachment_max_width": SettingDef("attachment_max_width", "", str, _is_valid_width),
    "drawing_max_width": SettingDef("drawing_max_width", "", str, _is_valid_width),
    # Background shown behind transparent images and .fldraw drawings in
    # embeds, the drawing editor, and the attachment preview. "theme" follows
    # the light/dark CSS variables (auto light/dark); "solid" uses
    # embed_bg_color; "dynamic" analyzes content luminance at decode time and
    # picks white or black for maximum contrast (best for line art, signatures,
    # and screenshots). Applies to image embeds, .fldraw embeds, the drawing
    # editor canvas, and the attachment preview modal.
    "embed_bg_mode": SettingDef(
        "embed_bg_mode", "theme", str,
        lambda v: v in ("theme", "solid", "dynamic"),
    ),
    # Hex color (e.g. "#ffffff") used when embed_bg_mode == "solid". Ignored
    # for other modes.
    "embed_bg_color": SettingDef(
        "embed_bg_color", "#ffffff", str,
        lambda v: isinstance(v, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", v) is not None,
    ),
    # Virtual "Attachments" sidebar folder. When enabled, a read-only folder
    # listing all of the user's attachments is prepended to the sidebar tree.
    # The subcategories flag further groups items into Images / Videos /
    # Drawings / Other subfolders. Both are pure client-side concerns: the
    # server has no mime info (filenames are ciphertext), so classification
    # happens in the browser after E2EE decryption.
    "attachments_folder_enabled": SettingDef(
        "attachments_folder_enabled", False, bool,
    ),
    "attachments_folder_subcategories": SettingDef(
        "attachments_folder_subcategories", False, bool,
    ),
    # Vault Context (client-side RAG) tuning + global consent gate. The global
    # gate (vault_context_allowed) defaults off and must be on before the
    # per-conversation chip is offered. The top_k / max_chars tunables cap how
    # much of each note is sent to the AI provider per message. All three are
    # consulted only when the global gate AND the per-conversation
    # ai_conversation.vault_context_enabled flag are both true.
    "vault_context_allowed": SettingDef("vault_context_allowed", False, bool),
    "ai_vault_context_top_k": SettingDef(
        "ai_vault_context_top_k", 8, int, _is_int_in_range(1, 50),
    ),
    "ai_vault_context_max_chars": SettingDef(
        "ai_vault_context_max_chars", 20000, int, _is_int_in_range(1000, 200000),
    ),
    # Audio recording (optional). Off by default; the toolbar mic button and
    # slash command are hidden unless audio_recording_enabled is on. The
    # device_id is the MediaTrackConstraints.deviceId string from
    # enumerateDevices() (empty = system default). mime_preference controls
    # which MediaRecorder codec is selected when more than one is supported:
    # "auto" picks the first supported of webm-opus → mp4-aac → browser
    # default. The three processing toggles map 1:1 to getUserMedia audio
    # constraints and default on (standard practice).
    "audio_recording_enabled": SettingDef("audio_recording_enabled", False, bool),
    "audio_device_id": SettingDef(
        "audio_device_id", "", str, lambda v: isinstance(v, str) and len(v) <= 200,
    ),
    "audio_max_duration_min": SettingDef(
        "audio_max_duration_min", 5, int, _is_int_in_range(1, 300),
    ),
    "audio_mime_preference": SettingDef(
        "audio_mime_preference", "auto", str,
        lambda v: v in ("auto", "webm-opus", "mp4-aac"),
    ),
    "audio_echo_cancellation": SettingDef("audio_echo_cancellation", True, bool),
    "audio_noise_suppression": SettingDef("audio_noise_suppression", True, bool),
    "audio_auto_gain_control": SettingDef("audio_auto_gain_control", True, bool),
    # Auto-suggest note links while typing (no [[ required). Master toggle,
    # off by default. When on, a dropdown of matching note titles appears
    # below the cursor as the user types a word; accepting one replaces the
    # typed fragment with [[Title]]. Applies to the editor only.
    "autosuggest_note_links": SettingDef("autosuggest_note_links", False, bool),
    # Minimum characters typed before the no-[[ autosuggest triggers.
    # Floor of 2 enforced by the validator to avoid single-char noise.
    "autosuggest_min_chars": SettingDef(
        "autosuggest_min_chars", 2, int, _is_int_in_range(2, 10),
    ),
    # Maximum number of suggestions shown in both the no-[[ autosuggest and
    # the existing [[ wikilink autocomplete dropdowns.
    "autosuggest_result_cap": SettingDef(
        "autosuggest_result_cap", 5, int, _is_int_in_range(1, 30),
    ),
    # Show the note's folder name next to each suggestion in both dropdowns.
    "autosuggest_show_category": SettingDef(
        "autosuggest_show_category", False, bool,
    ),
    # Matching algorithm used by both dropdowns. title_prefix = fast
    # prefix-of-title-or-title-word match; title_substring = looser
    # substring-anywhere-in-title match; full_search = reuses the
    # FlaskySearch engine (title + content scoring, highest recall, slowest).
    "autosuggest_algorithm": SettingDef(
        "autosuggest_algorithm", "title_prefix", str,
        lambda v: v in ("title_prefix", "title_substring", "full_search"),
    ),
}

# The CSS variables exposed in the customize UI (curated subset). The dark
# and light defaults below MUST stay in sync with app.css :root /
# [data-theme="light"] so the customize UI can show the current value and
# reset to default. rgba vars (border/border-light) use text inputs in the UI.
CUSTOMIZABLE_VARS = [
    "--bg-primary", "--bg-secondary", "--bg-sidebar", "--bg-input",
    "--text-primary", "--text-secondary", "--text-muted",
    "--accent", "--accent-hover",
    "--border", "--border-light",
    "--accent-dim", "--bg-hover", "--bg-active",
    "--green", "--red", "--yellow",
]

DEFAULT_COLORS = {
    "dark": {
        "--bg-primary": "#1e1e2e",
        "--bg-secondary": "#181825",
        "--bg-sidebar": "#11111b",
        "--bg-input": "#1e1e2e",
        "--text-primary": "#cdd6f4",
        "--text-secondary": "#bac2de",
        "--text-muted": "#585b70",
        "--accent": "#b4befe",
        "--accent-hover": "#cba6f7",
        "--border": "rgba(255,255,255,0.06)",
        "--border-light": "rgba(255,255,255,0.1)",
        "--accent-dim": "rgba(180,190,254,0.1)",
        "--bg-hover": "rgba(255,255,255,0.05)",
        "--bg-active": "rgba(255,255,255,0.08)",
        "--green": "#a6e3a1",
        "--red": "#f38ba8",
        "--yellow": "#f9e2af",
    },
    "light": {
        "--bg-primary": "#f8f9fc",
        "--bg-secondary": "#eff1f5",
        "--bg-sidebar": "#e6e9ef",
        "--bg-input": "#ffffff",
        "--text-primary": "#1a1a2e",
        "--text-secondary": "#2d2d44",
        "--text-muted": "#555770",
        "--accent": "#5a6fe0",
        "--accent-hover": "#7630d4",
        "--border": "rgba(0,0,0,0.12)",
        "--border-light": "rgba(0,0,0,0.18)",
        "--accent-dim": "rgba(90,111,224,0.16)",
        "--bg-hover": "rgba(0,0,0,0.06)",
        "--bg-active": "rgba(0,0,0,0.10)",
        "--green": "#2d8a1a",
        "--red": "#c40d33",
        "--yellow": "#c47a10",
    },
}


def get_effective_colors(custom_colors: dict | None) -> dict:
    """Return the merged color overrides for both themes.

    Only overrides the user has actually set are included (empty value =
    reset to default). This lets the injected <style> block stay small and
    lets missing keys fall through to app.css defaults naturally.

    Takes the raw ``custom_colors`` dict (as stored in ui_settings) so the
    caller can pass the already-loaded value from get_all_settings() —
    avoiding a redundant JSON re-parse per page render.
    """
    if not isinstance(custom_colors, dict):
        return {}
    out = {}
    for mode in ("dark", "light"):
        mode_overrides = {}
        raw = custom_colors.get(mode)
        if isinstance(raw, dict):
            for var in CUSTOMIZABLE_VARS:
                val = raw.get(var)
                if isinstance(val, str) and val.strip():
                    mode_overrides[var] = val.strip()
        if mode_overrides:
            out[mode] = mode_overrides
    return out


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
        widgets = [dict(w) for w in DEFAULT_PANEL_WIDGETS]
    # Strip retired widget ids (e.g. "agenda" was removed in an earlier version)
    cleaned = [w for w in widgets if isinstance(w, dict) and w.get("id") != "agenda"]
    daily_enabled = bool(get_setting(user, "daily_note_enabled"))
    # The calendar widget only makes sense when daily notes are enabled.
    # Strip it for users who haven't turned daily notes on so the config
    # panel doesn't offer a no-op toggle.
    if not daily_enabled:
        cleaned = [w for w in cleaned if w.get("id") != "calendar"]
    saved_ids = [w.get("id") for w in cleaned]
    for default_w in DEFAULT_PANEL_WIDGETS:
        if default_w["id"] not in saved_ids:
            cleaned.append(dict(default_w))
    # Inject the calendar widget (conditional on daily notes; not in the
    # shared default list because its presence is per-user). On first
    # appearance it defaults to visible when daily notes are enabled; once
    # the user has saved a choice, that is honored on subsequent reads.
    if daily_enabled and "calendar" not in saved_ids:
        cleaned.append({"id": "calendar", "label": "Calendar", "visible": True})
    return cleaned


def set_panel_widgets(user, widgets: list[dict]) -> bool:
    """Persist the panel_widgets list."""
    if not isinstance(widgets, list):
        return False
    raw = _load_raw(user)
    raw["panel_widgets"] = widgets
    _save_raw(user, raw)
    return True


def get_topbar_items(user) -> list[dict]:
    """Return the topbar_items list with feature-off items stripped and new
    defaults merged.

    Forward-compat mirrors get_panel_widgets(): when a new item is added to
    DEFAULT_TOPBAR_ITEMS, existing users pick it up on next read instead of
    having it silently hidden forever. Feature-gated items (drawing/audio/
    daily_note via ui_settings, ai via UserSettings.ai_enabled) are stripped
    when their feature is off so the customizer doesn't offer a no-op toggle.
    """
    items = get_setting(user, "topbar_items")
    if not isinstance(items, list):
        items = [dict(w) for w in DEFAULT_TOPBAR_ITEMS]
    # Strip feature-gated items whose feature is currently off.
    gated_ids = set()
    for item_id, setting_key in _TOPBAR_FEATURE_GATES.items():
        if not bool(get_setting(user, setting_key)):
            gated_ids.add(item_id)
    # ai is gated by a column on UserSettings, not a ui_settings key.
    settings = getattr(user, "settings", None)
    if settings is None or not getattr(settings, "ai_enabled", False):
        gated_ids.add("ai")
    cleaned = [w for w in items if isinstance(w, dict) and w.get("id") not in gated_ids]
    # Strip ids no longer in the defaults (e.g. retired after a refactor) so
    # the config list doesn't show stale entries the toolbar can't render.
    valid_ids = {w["id"] for w in DEFAULT_TOPBAR_ITEMS}
    cleaned = [w for w in cleaned if w.get("id") in valid_ids]
    # Labels are display text defined in DEFAULT_TOPBAR_ITEMS; the DB stores
    # only id + visible + order. Always take the label from defaults on read
    # so a stale label (e.g. from a renamed/split item) never leaks to the UI.
    label_by_id = {w["id"]: w["label"] for w in DEFAULT_TOPBAR_ITEMS}
    for w in cleaned:
        if w["id"] in label_by_id:
            w["label"] = label_by_id[w["id"]]
    # Forward-merge any new defaults the user doesn't have yet.
    saved_ids = [w.get("id") for w in cleaned]
    for default_w in DEFAULT_TOPBAR_ITEMS:
        if default_w["id"] not in saved_ids and default_w["id"] not in gated_ids:
            cleaned.append(dict(default_w))
    return cleaned


def set_topbar_items(user, items: list[dict]) -> bool:
    """Persist the topbar_items list."""
    if not isinstance(items, list):
        return False
    raw = _load_raw(user)
    raw["topbar_items"] = items
    _save_raw(user, raw)
    return True
