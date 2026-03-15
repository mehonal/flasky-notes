"""
Functional Unit Tests: User Module and Utilities
Testing through public interfaces
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from flasky.models import User
from flasky.utils import (
    parse_note_frontmatter, build_note_frontmatter, content_with_frontmatter,
    content_hash, has_banned_chars, valid_email
)


def test_user_creation_interface():
    user = User("testuser", "testpass", "test@test.com")
    assert user.username == "testuser"
    assert user.email == "test@test.com"


def test_user_settings_default_theme():
    user = User("testuser", "testpass", "test@test.com")
    settings = user.return_settings()
    assert settings.theme_preference == "cozy"


def test_user_settings_default_timezone():
    user = User("testuser", "testpass", "test@test.com")
    settings = user.return_settings()
    assert settings.timezone == "UTC"


def test_user_settings_obsidian_sync_default():
    user = User("testuser", "testpass", "test@test.com")
    settings = user.return_settings()
    assert settings.obsidian_sync_enabled is False


# --- Frontmatter parsing ---

def test_parse_frontmatter_with_properties():
    text = "---\ntags:\n  - foo\n  - bar\nstatus: draft\n---\nBody content here"
    props, body = parse_note_frontmatter(text)
    assert props["tags"] == ["foo", "bar"]
    assert props["status"] == "draft"
    assert body == "Body content here"


def test_parse_frontmatter_no_frontmatter():
    text = "Just plain text"
    props, body = parse_note_frontmatter(text)
    assert props == {}
    assert body == "Just plain text"


def test_parse_frontmatter_strips_sync_keys():
    text = "---\nflasky_id: 42\nflasky_hash: abc\ntags:\n  - x\n---\nBody"
    props, body = parse_note_frontmatter(text)
    assert "flasky_id" not in props
    assert "flasky_hash" not in props
    assert props["tags"] == ["x"]


def test_parse_frontmatter_empty_text():
    props, body = parse_note_frontmatter("")
    assert props == {}
    assert body == ""


def test_parse_frontmatter_none():
    props, body = parse_note_frontmatter(None)
    assert props == {}
    assert body == ""


def test_build_note_frontmatter():
    props = {"tags": ["a", "b"], "status": "done"}
    fm = build_note_frontmatter(props)
    assert fm.startswith("---\n")
    assert fm.endswith("---\n")
    assert "tags:" in fm
    assert "status: done" in fm


def test_build_note_frontmatter_empty():
    assert build_note_frontmatter({}) == ""
    assert build_note_frontmatter(None) == ""


def test_content_with_frontmatter_roundtrip():
    import json
    props = {"status": "draft"}
    content = "Hello world"
    props_json = json.dumps(props)
    full = content_with_frontmatter(content, props_json)
    assert "---" in full
    assert "status: draft" in full
    assert "Hello world" in full


def test_content_hash_deterministic():
    h1 = content_hash("test content")
    h2 = content_hash("test content")
    assert h1 == h2
    assert len(h1) == 64  # SHA-256 hex


def test_content_hash_none():
    h = content_hash(None)
    assert len(h) == 64


# --- Validation utilities ---

def test_has_banned_chars():
    assert has_banned_chars("hello") is False
    assert has_banned_chars("hello123") is False
    assert has_banned_chars("hello world") is True
    assert has_banned_chars("hello!") is True


def test_valid_email():
    assert valid_email("user@example.com") is True
    assert valid_email("user@sub.domain.org") is True
    assert valid_email("notanemail") is False
    assert valid_email("@missing.com") is False
