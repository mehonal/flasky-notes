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
    r = client.get("/settings")
    assert r.status_code == 200
    body = r.data.decode()
    assert "custom-theme-override" in body
    assert "--accent: #a1b2c3" in body
    # The Customize tab nav button should be present
    assert 'data-tab="customize"' in body


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
