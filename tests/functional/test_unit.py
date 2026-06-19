"""
Functional Unit Tests: User model + utilities (E2EE-aware).
"""

import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from flasky.utils import content_hash, has_banned_chars, valid_email


def _make_user(username="testuser"):
    from flasky.services.auth import create_user
    return create_user(username, "testpass", f"{username}@test.com")


def test_user_creation_interface():
    user = _make_user()
    assert user.username == "testuser"
    assert user.email == "testuser@test.com"


def test_user_settings_default_timezone():
    user = _make_user()
    settings = user.return_settings()
    assert settings.timezone == "UTC"


def test_user_settings_obsidian_sync_default():
    user = _make_user()
    settings = user.return_settings()
    assert settings.obsidian_sync_enabled is False


def test_user_settings_ui_settings_default_empty():
    """ui_settings starts as {} — defaults come from the registry on read."""
    user = _make_user()
    settings = user.return_settings()
    assert settings.ui_settings in (None, "{}", "")


def test_content_hash_deterministic():
    h1 = content_hash("test content")
    h2 = content_hash("test content")
    assert h1 == h2
    assert len(h1) == 64  # SHA-256 hex


def test_content_hash_none():
    h = content_hash(None)
    assert len(h) == 64


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