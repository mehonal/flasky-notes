"""
Structural Unit Tests: User model internals (E2EE-aware).
"""

import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from flasky import db
from flasky.models import User, UserSettings, UserNoteCategory


def _make_user(username="testuser", password="testpass", email="test@test.com"):
    """Create a user via the auth service (the only way to create users now)."""
    from flasky.services.auth import create_user
    return create_user(username, password, email)


def test_user_password_hashing():
    user = _make_user()
    assert user.password.startswith(b"$2b$")


def test_user_settings_generation():
    user = _make_user()
    assert user.settingsid is not None
    assert user.settings is not None


def test_user_get_main_category_creates_if_missing():
    """With mandatory E2EE, the main category is the first by id; get_main_category
    returns None when no categories exist. The categories service creates one
    on demand via get_or_create_main_category.
    """
    from flasky.services.categories import get_or_create_main_category
    user = _make_user()
    main = get_or_create_main_category(user)
    assert main is not None


def test_user_get_category_by_id():
    from flasky.services.categories import create_category
    user = _make_user()
    cat = create_category(user, "opaque-ciphertext")
    fetched = user.get_category(cat.id)
    assert fetched is not None
    assert fetched.id == cat.id


def test_user_get_category_none_returns_main():
    from flasky.services.categories import get_or_create_main_category
    user = _make_user()
    get_or_create_main_category(user)  # ensure a main category exists
    cat = user.get_category(None)
    assert cat is not None


def test_user_category_tree():
    from flasky.services.categories import create_category
    user = _make_user()
    create_category(user, "Work")
    create_category(user, "Work/Projects")
    create_category(user, "Personal")

    tree = user.get_category_tree()
    assert "Work" in tree
    assert "Projects" in tree["Work"]["_children"]
    assert "Personal" in tree


def test_user_add_and_delete_note():
    """Note creation goes through the notes service now."""
    from flasky.services.notes import create_note, delete_note
    user = _make_user()
    note = create_note(user, "cipher-title", "cipher-content", None)
    assert note is not None
    note_id = note.id

    result = delete_note(user, note_id)
    assert result is True

    result2 = delete_note(user, 9999)
    assert result2 is False


def test_user_timezone():
    from flasky.services.settings import set_timezone
    user = _make_user()
    assert user.get_timezone(as_str=True) == "UTC"

    set_timezone(user, "America/New_York")
    assert user.get_timezone(as_str=True) == "America/New_York"

    # Invalid timezone should fall back to UTC
    set_timezone(user, "Invalid/Zone")
    assert user.get_timezone(as_str=True) == "UTC"


def test_ui_settings_round_trip():
    """set_setting / get_setting should persist and read UI preferences."""
    from flasky.ui_settings import set_setting, get_setting
    user = _make_user()
    set_setting(user, "dark_mode", True)
    assert get_setting(user, "dark_mode") is True
    set_setting(user, "font_size", 20)
    assert get_setting(user, "font_size") == 20


def test_ui_settings_defaults_on_missing_key():
    """A user with no stored ui_settings gets the registry defaults on read."""
    from flasky.ui_settings import get_setting
    user = _make_user("testuser2", "testpass", "test2@test.com")
    assert get_setting(user, "font_size") == 16  # registry default
    assert get_setting(user, "dark_mode") is False  # registry default