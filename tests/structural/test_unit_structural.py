"""
Structural Unit Tests: User Model
White-box testing of User model internals
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from flasky.models import User


def test_user_password_hashing():
    user = User("testuser", "testpass", "test@test.com")
    assert user.password.startswith(b'$2b$')


def test_user_settings_generation():
    user = User("testuser", "testpass", "test@test.com")
    assert user.settingsid is not None
    assert user.settings is not None


def test_user_get_main_category_creates_if_missing():
    user = User("testuser", "testpass", "test@test.com")
    main = user.get_main_category()
    assert main is not None
    assert main.name == "Main"


def test_user_get_category_by_name():
    user = User("testuser", "testpass", "test@test.com")
    cat = user.get_category("Work", create=True)
    assert cat is not None
    assert cat.name == "Work"

    # Getting same category again should return existing
    cat2 = user.get_category("Work", create=False)
    assert cat2.id == cat.id


def test_user_get_category_none_returns_main():
    user = User("testuser", "testpass", "test@test.com")
    cat = user.get_category(None)
    assert cat.name == "Main"


def test_user_category_tree():
    user = User("testuser", "testpass", "test@test.com")
    user.get_category("Work", create=True)
    user.get_category("Work/Projects", create=True)
    user.get_category("Personal", create=True)

    tree = user.get_category_tree()
    assert "Work" in tree
    assert "Projects" in tree["Work"]["_children"]
    assert "Personal" in tree


def test_user_add_and_delete_note():
    from flasky import db
    user = User("testuser", "testpass", "test@test.com")
    note = user.add_note("Test", "Content", None)
    assert note is not False
    note_id = note.id

    result = user.delete_note(note_id)
    assert result is True

    result2 = user.delete_note(9999)
    assert result2 is False


def test_user_timezone():
    user = User("testuser", "testpass", "test@test.com")
    assert user.get_timezone(as_str=True) == "UTC"

    user.set_timezone("America/New_York")
    assert user.get_timezone(as_str=True) == "America/New_York"

    # Invalid timezone should fall back to UTC
    user.set_timezone("Invalid/Zone")
    assert user.get_timezone(as_str=True) == "UTC"
