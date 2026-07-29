"""Tests for the customize-appearance endpoints (colors, custom CSS, font).

These cover the three new ui_state endpoints plus the AI generate_css
endpoint (mocked). The existing ui_state endpoints (save_dark_mode,
save_font_size) are already covered by integration tests.
"""
import sys
import os
from unittest.mock import patch, MagicMock

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


def test_save_custom_colors(auth_client):
    client, _ = auth_client
    r = client.post("/api/save_custom_colors", json={
        "colors": {
            "dark": {"--accent": "#ff0000", "--bg-primary": "#112233"},
            "light": {"--accent": "#00ff00"},
        }
    })
    assert r.status_code == 200
    assert r.json["success"] is True
    assert r.json["colors"]["dark"]["--accent"] == "#ff0000"
    assert r.json["colors"]["light"]["--accent"] == "#00ff00"


def test_save_custom_colors_rejects_invalid_color(auth_client):
    client, _ = auth_client
    r = client.post("/api/save_custom_colors", json={
        "colors": {"dark": {"--accent": "javascript:alert(1)"}}
    })
    assert r.status_code == 400


def test_save_custom_colors_strips_unknown_vars(auth_client):
    client, _ = auth_client
    r = client.post("/api/save_custom_colors", json={
        "colors": {"dark": {"--accent": "#abc", "--bogus": "#000"}}
    })
    assert r.status_code == 200
    assert "--bogus" not in r.json["colors"]["dark"]


def test_save_custom_colors_empty_resets(auth_client):
    client, _ = auth_client
    # set a color then reset via empty string
    client.post("/api/save_custom_colors", json={
        "colors": {"dark": {"--accent": "#ff0000"}}
    })
    r = client.post("/api/save_custom_colors", json={
        "colors": {"dark": {"--accent": ""}}
    })
    assert r.status_code == 200
    # empty value means reset → the var should be dropped from the stored set
    assert "--accent" not in r.json.get("colors", {}).get("dark", {})


def test_save_custom_css(auth_client):
    client, _ = auth_client
    r = client.post("/api/save_custom_css", json={"css": ".x { color: red; }"})
    assert r.status_code == 200
    assert r.json["success"] is True


def test_save_custom_css_rejects_too_long(auth_client):
    client, _ = auth_client
    r = client.post("/api/save_custom_css", json={"css": "x" * 50001})
    assert r.status_code == 400


def test_save_font_family(auth_client):
    client, _ = auth_client
    r = client.post("/api/save_font_family", json={"font": "Inter, sans-serif"})
    assert r.status_code == 200
    assert r.json["font"] == "Inter, sans-serif"


def test_save_font_family_too_long(auth_client):
    client, _ = auth_client
    r = client.post("/api/save_font_family", json={"font": "x" * 201})
    assert r.status_code == 400


def test_customize_override_renders_on_editor(auth_client):
    """The note editor page includes the custom-theme override block."""
    client, _ = auth_client
    client.post("/api/save_custom_colors", json={
        "colors": {"dark": {"--accent": "#ff0000"}}
    })
    client.post("/api/save_custom_css", json={"css": ".sidebar { border-width: 2px; }"})
    r = client.get("/note/0")
    assert r.status_code == 200
    body = r.data.decode()
    assert "custom-theme-override" in body
    assert "--accent: #ff0000" in body
    assert ".sidebar { border-width: 2px; }" in body


def test_customize_override_renders_on_settings(auth_client):
    client, _ = auth_client
    client.post("/api/save_custom_colors", json={
        "colors": {"dark": {"--accent": "#a1b2c3"}}
    })
    # The shell (served for /settings) contains the custom theme override.
    r = client.get("/settings")
    assert r.status_code == 200
    body = r.data.decode()
    assert "custom-theme-override" in body
    assert "--accent: #a1b2c3" in body
    # The settings fragment has the Customize tab nav button.
    r2 = client.get("/settings?_fragment=1")
    assert r2.status_code == 200
    assert 'data-tab="customize"' in r2.data.decode()


def test_generate_css_requires_ai_enabled(auth_client):
    """generate_css is gated behind ai_enabled (returns 403 when off)."""
    client, _ = auth_client
    r = client.post("/ai/api/generate_css", json={"prompt": "make sidebar dark"})
    assert r.status_code == 403


def test_generate_css_requires_prompt(auth_client):
    client, _ = auth_client
    # Enable AI + key first
    from flasky import db
    from flasky.models import User
    u = User.query.filter_by(username="testuser").first()
    u.settings.ai_enabled = True
    u.settings.ollama_api_key = "fake-key"
    db.session.commit()
    r = client.post("/ai/api/generate_css", json={"prompt": ""})
    assert r.status_code == 400


def test_generate_css_returns_css(auth_client):
    client, _ = auth_client
    from flasky import db
    from flasky.models import User
    u = User.query.filter_by(username="testuser").first()
    u.settings.ai_enabled = True
    u.settings.ollama_api_key = "fake-key"
    u.settings.ollama_model = "test-model"
    db.session.commit()
    mock_resp = {"message": {"content": ":root { --accent: #00ff00; }"}}
    mock_client = MagicMock()
    mock_client.chat.return_value = mock_resp
    with patch("flasky.blueprints.ai._get_ollama_client", return_value=mock_client):
        r = client.post("/ai/api/generate_css", json={
            "prompt": "green accent", "theme": "dark"
        })
    assert r.status_code == 200
    assert r.json["valid"] is True
    assert "--accent: #00ff00" in r.json["css"]


def test_generate_css_strips_code_fence(auth_client):
    client, _ = auth_client
    from flasky import db
    from flasky.models import User
    u = User.query.filter_by(username="testuser").first()
    u.settings.ai_enabled = True
    u.settings.ollama_api_key = "fake-key"
    db.session.commit()
    mock_resp = {"message": {"content": "```css\n:root { --accent: #123; }\n```"}}
    mock_client = MagicMock()
    mock_client.chat.return_value = mock_resp
    with patch("flasky.blueprints.ai._get_ollama_client", return_value=mock_client):
        r = client.post("/ai/api/generate_css", json={"prompt": "x"})
    assert r.status_code == 200
    assert "```" not in r.json["css"]
    assert "--accent: #123" in r.json["css"]


def test_generate_css_rejects_unbalanced_braces(auth_client):
    client, _ = auth_client
    from flasky import db
    from flasky.models import User
    u = User.query.filter_by(username="testuser").first()
    u.settings.ai_enabled = True
    u.settings.ollama_api_key = "fake-key"
    db.session.commit()
    mock_resp = {"message": {"content": ".x { color: red"}}
    mock_client = MagicMock()
    mock_client.chat.return_value = mock_resp
    with patch("flasky.blueprints.ai._get_ollama_client", return_value=mock_client):
        r = client.post("/ai/api/generate_css", json={"prompt": "x"})
    assert r.status_code == 200
    assert r.json["valid"] is False


def test_generate_css_uses_selected_model(auth_client):
    client, _ = auth_client
    from flasky import db
    from flasky.models import User
    u = User.query.filter_by(username="testuser").first()
    u.settings.ai_enabled = True
    u.settings.ollama_api_key = "fake-key"
    u.settings.ollama_model = "default-model"
    db.session.commit()
    mock_resp = {"message": {"content": ":root { --accent: #abc; }"}}
    mock_client = MagicMock()
    mock_client.chat.return_value = mock_resp
    with patch("flasky.blueprints.ai._get_ollama_client", return_value=mock_client):
        r = client.post("/ai/api/generate_css", json={
            "prompt": "x", "model": "chosen-model"
        })
    assert r.status_code == 200
    args, kwargs = mock_client.chat.call_args
    assert kwargs["model"] == "chosen-model"


def test_generate_css_falls_back_to_settings_model(auth_client):
    client, _ = auth_client
    from flasky import db
    from flasky.models import User
    u = User.query.filter_by(username="testuser").first()
    u.settings.ai_enabled = True
    u.settings.ollama_api_key = "fake-key"
    u.settings.ollama_model = "settings-model"
    db.session.commit()
    mock_resp = {"message": {"content": ":root { --accent: #abc; }"}}
    mock_client = MagicMock()
    mock_client.chat.return_value = mock_resp
    with patch("flasky.blueprints.ai._get_ollama_client", return_value=mock_client):
        r = client.post("/ai/api/generate_css", json={"prompt": "x"})
    assert r.status_code == 200
    _, kwargs = mock_client.chat.call_args
    assert kwargs["model"] == "settings-model"


def test_generate_css_includes_current_css_when_requested(auth_client):
    client, _ = auth_client
    from flasky import db
    from flasky.models import User
    u = User.query.filter_by(username="testuser").first()
    u.settings.ai_enabled = True
    u.settings.ollama_api_key = "fake-key"
    db.session.commit()
    client.post("/api/save_custom_css", json={"css": ".sidebar { width: 10px; }"})
    mock_resp = {"message": {"content": ":root { --accent: #abc; }"}}
    mock_client = MagicMock()
    mock_client.chat.return_value = mock_resp
    with patch("flasky.blueprints.ai._get_ollama_client", return_value=mock_client):
        r = client.post("/ai/api/generate_css", json={
            "prompt": "x", "include_current_css": True
        })
    assert r.status_code == 200
    _, kwargs = mock_client.chat.call_args
    assert ".sidebar { width: 10px; }" in kwargs["messages"][1]["content"]


def test_generate_css_includes_color_overrides_when_requested(auth_client):
    client, _ = auth_client
    from flasky import db
    from flasky.models import User
    u = User.query.filter_by(username="testuser").first()
    u.settings.ai_enabled = True
    u.settings.ollama_api_key = "fake-key"
    db.session.commit()
    client.post("/api/save_custom_colors", json={
        "colors": {"dark": {"--accent": "#deadbe"}}
    })
    mock_resp = {"message": {"content": ":root { --accent: #abc; }"}}
    mock_client = MagicMock()
    mock_client.chat.return_value = mock_resp
    with patch("flasky.blueprints.ai._get_ollama_client", return_value=mock_client):
        r = client.post("/ai/api/generate_css", json={
            "prompt": "x", "theme": "dark", "include_color_overrides": True
        })
    assert r.status_code == 200
    _, kwargs = mock_client.chat.call_args
    assert "#deadbe" in kwargs["messages"][1]["content"]


def test_generate_css_omits_current_css_by_default(auth_client):
    client, _ = auth_client
    from flasky import db
    from flasky.models import User
    u = User.query.filter_by(username="testuser").first()
    u.settings.ai_enabled = True
    u.settings.ollama_api_key = "fake-key"
    db.session.commit()
    client.post("/api/save_custom_css", json={"css": ".marker-rule { x: 1; }"})
    mock_resp = {"message": {"content": ":root { --accent: #abc; }"}}
    mock_client = MagicMock()
    mock_client.chat.return_value = mock_resp
    with patch("flasky.blueprints.ai._get_ollama_client", return_value=mock_client):
        r = client.post("/ai/api/generate_css", json={"prompt": "x"})
    assert r.status_code == 200
    _, kwargs = mock_client.chat.call_args
    assert ".marker-rule" not in kwargs["messages"][1]["content"]


# ---------- Theme presets ----------

def test_theme_presets_registry_has_ten_plus_classic():
    from flasky.theme_presets import PRESETS, PRESET_MAP
    ids = [p.id for p in PRESETS]
    assert "classic" in ids
    assert len(PRESETS) == 15  # 14 themes + Classic
    assert len(PRESET_MAP) == len(PRESETS)


def test_theme_presets_define_both_modes():
    """Every non-classic preset must define dark + light palettes."""
    from flasky.theme_presets import PRESETS
    for p in PRESETS:
        if p.id == "classic":
            assert p.colors_dark == {} and p.colors_light == {}
            continue
        assert p.colors_dark, f"{p.id} missing dark palette"
        assert p.colors_light, f"{p.id} missing light palette"


def test_theme_presets_css_is_safe():
    """Preset custom_css must not contain </style> or <script>."""
    from flasky.theme_presets import PRESETS
    for p in PRESETS:
        css = p.custom_css or ""
        assert "</style" not in css.lower(), f"{p.id} has </style>"
        assert "<script" not in css.lower(), f"{p.id} has <script>"


def test_save_preset_valid(auth_client):
    client, _ = auth_client
    r = client.post("/api/save_preset", json={"preset": "midnight"})
    assert r.status_code == 200
    assert r.json["success"] is True
    assert r.json["preset"] == "midnight"


def test_save_preset_classic_empty(auth_client):
    client, _ = auth_client
    r = client.post("/api/save_preset", json={"preset": ""})
    assert r.status_code == 200
    assert r.json["preset"] == ""


def test_save_preset_rejects_unknown(auth_client):
    client, _ = auth_client
    r = client.post("/api/save_preset", json={"preset": "nonexistent-theme"})
    assert r.status_code == 400


def test_save_preset_rejects_non_string(auth_client):
    client, _ = auth_client
    r = client.post("/api/save_preset", json={"preset": 123})
    assert r.status_code == 400


def test_save_preset_rejects_missing_key(auth_client):
    client, _ = auth_client
    r = client.post("/api/save_preset", json={})
    assert r.status_code == 400


def test_active_preset_round_trips(auth_client):
    from flasky import db
    from flasky.models import User
    from flasky.ui_settings import get_setting
    client, _ = auth_client
    client.post("/api/save_preset", json={"preset": "tokyo-neon"})
    u = User.query.filter_by(username="testuser").first()
    assert get_setting(u, "active_preset") == "tokyo-neon"
    # clear
    client.post("/api/save_preset", json={"preset": ""})
    db.session.refresh(u)
    assert get_setting(u, "active_preset") == ""


def test_preset_applies_colors_via_existing_endpoints(auth_client):
    """Simulate what the JS applyPreset does: save a preset's colors through
    the existing /api/save_custom_colors endpoint and verify persistence."""
    from flasky.theme_presets import get_preset
    from flasky.ui_settings import get_setting
    from flasky.models import User
    client, _ = auth_client
    p = get_preset("nordic-frost")
    r = client.post("/api/save_custom_colors", json={
        "colors": {"dark": p.colors_dark, "light": p.colors_light}
    })
    assert r.status_code == 200
    u = User.query.filter_by(username="testuser").first()
    stored = get_setting(u, "custom_colors")
    assert stored["dark"]["--accent"] == "#88c0d0"


def test_preset_page_data_includes_active_preset(auth_client):
    """The editor page-data JSON should include activePreset."""
    client, _ = auth_client
    client.post("/api/save_preset", json={"preset": "graphite"})
    r = client.get("/note/0")
    assert r.status_code == 200
    assert '"activePreset": "graphite"' in r.data.decode()


def test_settings_customize_tab_has_themes_tab(auth_client):
    """The customize fragment should include the Themes tab button."""
    client, _ = auth_client
    r = client.get("/settings?_fragment=1")
    assert r.status_code == 200
    body = r.data.decode()
    assert 'data-tab="themes"' in body
    assert 'id="theme-presets-' in body


def test_new_customizable_vars_accepted(auth_client):
    """The 6 new vars (--accent-dim, --bg-hover, --bg-active, --green,
    --red, --yellow) should be accepted by save_custom_colors."""
    client, _ = auth_client
    r = client.post("/api/save_custom_colors", json={
        "colors": {
            "dark": {
                "--accent-dim": "rgba(255,0,0,0.1)",
                "--bg-hover": "rgba(255,255,255,0.1)",
                "--bg-active": "rgba(255,255,255,0.2)",
                "--green": "#00ff00",
                "--red": "#ff0000",
                "--yellow": "#ffff00",
            }
        }
    })
    assert r.status_code == 200
    stored = r.json["colors"]["dark"]
    assert "--accent-dim" in stored
    assert "--green" in stored


def test_save_theme_animations(auth_client):
    client, _ = auth_client
    r = client.post("/api/save_theme_animations", json={"enabled": False})
    assert r.status_code == 200
    assert r.json["success"] is True
    assert r.json["enabled"] is False


def test_save_theme_animations_truthy(auth_client):
    from flasky import db
    from flasky.models import User
    from flasky.ui_settings import get_setting
    client, _ = auth_client
    client.post("/api/save_theme_animations", json={"enabled": False})
    client.post("/api/save_theme_animations", json={"enabled": 1})
    u = User.query.filter_by(username="testuser").first()
    assert get_setting(u, "theme_animations_enabled") is True


def test_theme_page_data_includes_animations_flag(auth_client):
    client, _ = auth_client
    r = client.get("/note/0")
    assert r.status_code == 200
    assert '"themeAnimationsEnabled"' in r.data.decode()


# ---------- Batch save_appearance endpoint ----------

def test_save_appearance_colors_only(auth_client):
    from flasky.models import User
    from flasky.ui_settings import get_setting
    client, _ = auth_client
    r = client.post("/api/save_appearance", json={
        "colors": {"dark": {"--accent": "#ff0000"}}
    })
    assert r.status_code == 200
    u = User.query.filter_by(username="testuser").first()
    assert get_setting(u, "custom_colors")["dark"]["--accent"] == "#ff0000"


def test_save_appearance_all_keys(auth_client):
    from flasky.models import User
    from flasky.ui_settings import get_setting
    client, _ = auth_client
    r = client.post("/api/save_appearance", json={
        "colors": {"dark": {"--accent": "#00ff00"}, "light": {"--accent": "#ff0000"}},
        "css": "body { background: red; }",
        "font": "monospace",
        "font_size": 18,
        "active_preset": "matrix",
        "theme_animations_enabled": 0,
        "dark_mode": 1,
    })
    assert r.status_code == 200
    u = User.query.filter_by(username="testuser").first()
    assert get_setting(u, "custom_colors")["dark"]["--accent"] == "#00ff00"
    assert get_setting(u, "custom_css") == "body { background: red; }"
    assert get_setting(u, "font") == "monospace"
    assert get_setting(u, "font_size") == 18
    assert get_setting(u, "active_preset") == "matrix"
    assert get_setting(u, "theme_animations_enabled") is False
    assert get_setting(u, "dark_mode") is True


def test_save_appearance_rejects_bad_css(auth_client):
    client, _ = auth_client
    r = client.post("/api/save_appearance", json={"css": 123})
    assert r.status_code == 400


def test_save_appearance_rejects_bad_preset(auth_client):
    client, _ = auth_client
    r = client.post("/api/save_appearance", json={"active_preset": "fake"})
    assert r.status_code == 400


def test_save_appearance_rejects_bad_font_size(auth_client):
    client, _ = auth_client
    r = client.post("/api/save_appearance", json={"font_size": 99})
    assert r.status_code == 400


def test_save_appearance_rejects_bad_colors(auth_client):
    client, _ = auth_client
    r = client.post("/api/save_appearance", json={
        "colors": {"dark": {"--accent": 123}}
    })
    assert r.status_code == 400


def test_save_appearance_rejects_forbidden_css(auth_client):
    client, _ = auth_client
    r = client.post("/api/save_appearance", json={
        "css": "body { color: red; } </style><script>alert(1)</script>"
    })
    assert r.status_code == 400
    assert "forbidden" in r.json["reason"].lower()


def test_save_custom_css_rejects_forbidden_markup(auth_client):
    client, _ = auth_client
    r = client.post("/api/save_custom_css", json={
        "css": "x { } </style><script>x</script>"
    })
    assert r.status_code == 400


def test_save_appearance_atomic_no_clobber(auth_client):
    """The batch endpoint must not lose keys that are absent from the payload."""
    from flasky.models import User
    from flasky.ui_settings import get_setting
    client, _ = auth_client
    client.post("/api/save_appearance", json={"css": "body{}", "font": "serif"})
    client.post("/api/save_appearance", json={"colors": {"dark": {"--accent": "#123456"}}})
    u = User.query.filter_by(username="testuser").first()
    assert get_setting(u, "custom_css") == "body{}"
    assert get_setting(u, "font") == "serif"
    assert get_setting(u, "custom_colors")["dark"]["--accent"] == "#123456"


def test_animated_preset_css_renders_on_pageload(auth_client):
    """When a preset with animated CSS is saved via save_appearance (animations
    enabled), the CSS must appear in the rendered note page so animations work
    on a fresh pageload — not just after JS applyCssLive runs."""
    from flasky.theme_presets import get_preset
    client, _ = auth_client
    p = get_preset("matrix")
    client.post("/api/save_appearance", json={
        "css": p.custom_css,
        "active_preset": "matrix",
        "theme_animations_enabled": 1,
    })
    r = client.get("/note/0")
    assert r.status_code == 200
    body = r.data.decode()
    assert "custom-theme-override" in body
    assert "flasky-matrix-rain" in body
    assert "body::before" in body
    assert "content:''" in body


def test_stripped_preset_css_renders_on_pageload(auth_client):
    """When animations are disabled, the stripped CSS (no @keyframes, no
    animation:) must be what's stored and rendered on pageload."""
    from flasky.theme_presets import get_preset
    from flasky.models import User
    from flasky.ui_settings import get_setting
    client, _ = auth_client
    p = get_preset("matrix")
    # Simulate stripAnimations: remove @keyframes and animation: declarations
    import re
    stripped = p.custom_css
    stripped = re.sub(r'@keyframes[^{]*\{[^@]*?\}\s*', '', stripped)
    stripped = re.sub(r'animation\s*:[^;}]*;?', '', stripped)
    client.post("/api/save_appearance", json={
        "css": stripped,
        "active_preset": "matrix",
        "theme_animations_enabled": 0,
    })
    u = User.query.filter_by(username="testuser").first()
    stored_css = get_setting(u, "custom_css")
    assert "@keyframes" not in stored_css
    assert "animation:" not in stored_css
    r = client.get("/note/0")
    body = r.data.decode()
    assert "flasky-matrix-rain" not in body
