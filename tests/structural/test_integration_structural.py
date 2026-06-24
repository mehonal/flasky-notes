"""
Structural Integration Tests: Database layer (E2EE-aware).

With mandatory E2EE the server stores content as opaque ciphertext — there
is no server-side frontmatter parsing. These tests verify the data layer
works correctly via the service layer (the only path that writes now).
"""

import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from flasky import db
from flasky.models import UserNote, UserNoteCategory


def _make_user(username="testuser"):
    from flasky.services.auth import create_user
    return create_user(username, "testpass", f"{username}@test.com")


def test_note_category_cascading():
    """Deleting a category should reassign notes to the user's default folder."""
    from flasky.services.notes import create_note
    from flasky.services.categories import (
        create_category, delete_category, get_or_create_default_category,
    )

    user = _make_user()
    default_category = get_or_create_default_category(user)
    test_category = create_category(user, "opaque-ciphertext")

    note = create_note(user, "cipher-title", "cipher-content", test_category.id)
    note_id = note.id

    delete_category(user, test_category.id)

    db.session.refresh(note)
    assert note is not None
    assert note.category_id == default_category.id


def test_note_change_content_stores_previous():
    """update_note should store old content in previous_content. With
    mandatory E2EE the new content is opaque ciphertext, stored as-is.
    """
    from flasky.services.notes import create_note, update_note
    user = _make_user()
    note = create_note(user, "cipher-title", "cipher-v1", None)

    update_note(user, note.id, content="cipher-v2")
    db.session.refresh(note)
    assert note.content == "cipher-v2"
    assert note.previous_content == "cipher-v1"


def test_note_revert():
    """Reverting should swap content and previous_content."""
    from flasky.services.notes import create_note, update_note, revert_note
    user = _make_user()
    note = create_note(user, "cipher-title", "cipher-v1", None)
    update_note(user, note.id, content="cipher-v2")

    result = revert_note(user, note.id)
    assert result is not None
    db.session.refresh(note)
    assert note.content == "cipher-v1"
    assert note.previous_content == "cipher-v2"


def test_note_revert_no_previous():
    """Reverting with no previous content should return None."""
    from flasky.services.notes import create_note, revert_note
    user = _make_user()
    note = create_note(user, "cipher-title", "cipher-only", None)

    result = revert_note(user, note.id)
    assert result is None


def test_note_return_json():
    """return_json should include all expected keys."""
    from flasky.services.notes import create_note
    user = _make_user()
    note = create_note(user, "cipher-title", "cipher-content", None)

    data = note.return_json()
    assert data["title"] == "cipher-title"
    assert data["content"] == "cipher-content"
    assert "id" in data
    assert "category" in data
    assert "properties" in data
    assert "date_added" in data
    assert "date_last_changed" in data


def test_note_change_category_by_id():
    """With mandatory E2EE, update_note accepts an int id for category."""
    from flasky.services.notes import create_note, update_note
    from flasky.services.categories import create_category
    user = _make_user()
    cat = create_category(user, "target-ciphertext")
    note = create_note(user, "cipher-title", "cipher-content", None)

    update_note(user, note.id, category=cat.id)
    db.session.refresh(note)
    assert note.category_id == cat.id


def test_note_change_category_by_string_id():
    """update_note also accepts a string that parses to an int id."""
    from flasky.services.notes import create_note, update_note
    from flasky.services.categories import create_category
    user = _make_user()
    cat = create_category(user, "target-ciphertext")
    note = create_note(user, "cipher-title", "cipher-content", None)

    update_note(user, note.id, category=str(cat.id))
    db.session.refresh(note)
    assert note.category_id == cat.id


def test_note_get_properties_returns_raw_when_ciphertext():
    """With mandatory E2EE, properties is opaque ciphertext. get_properties
    returns it as-is (no JSON parsing).
    """
    from flasky.services.notes import create_note, update_note
    user = _make_user()
    note = create_note(user, "cipher-title", "cipher-content", None)
    update_note(user, note.id, properties="opaque-ciphertext-properties")
    db.session.refresh(note)

    props = note.get_properties()
    assert props == "opaque-ciphertext-properties"


def test_note_get_properties_empty_when_unset():
    from flasky.services.notes import create_note
    user = _make_user()
    note = create_note(user, "cipher-title", "cipher-content", None)

    assert note.get_properties() == {}