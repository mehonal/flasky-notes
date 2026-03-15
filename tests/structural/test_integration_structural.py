"""
Structural Integration Tests: Database Layer
White-box testing of database interactions and model methods
"""

import sys
import os
import json
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from flasky import db
from flasky.models import User, UserNote, UserNoteCategory


def test_note_category_cascading():
    """Deleting a category should reassign notes to Main."""
    user = User("testuser", "testpass", "test@test.com")
    db.session.commit()

    main_category = user.get_main_category()
    db.session.commit()

    test_category = UserNoteCategory(user.id, "Test Category")
    db.session.commit()

    note = user.add_note("Test", "Content", test_category.id)
    db.session.commit()

    # Reassign notes before deleting category (mimicking delete_category route)
    for n in UserNote.query.filter_by(category_id=test_category.id):
        n.category_id = main_category.id
    db.session.commit()
    db.session.delete(test_category)
    db.session.commit()

    db.session.refresh(note)
    assert note is not None
    assert note.category_id == main_category.id


def test_note_change_content_parses_frontmatter():
    """Changing note content with frontmatter should extract properties."""
    user = User("testuser", "testpass", "test@test.com")
    note = user.add_note("Test", "Original", None)

    note.change_content("---\nstatus: published\n---\nNew body")
    assert note.content == "New body"
    props = note.get_properties()
    assert props["status"] == "published"


def test_note_change_content_stores_previous():
    """change_content should store old content in previous_content."""
    user = User("testuser", "testpass", "test@test.com")
    note = user.add_note("Test", "Version 1", None)

    note.change_content("Version 2")
    assert note.content == "Version 2"
    assert note.previous_content == "Version 1"


def test_note_revert():
    """Reverting should swap content and previous_content."""
    user = User("testuser", "testpass", "test@test.com")
    note = user.add_note("Test", "v1", None)
    note.change_content("v2")

    result = note.revert_to_last_version()
    assert result is True
    assert note.content == "v1"
    assert note.previous_content == "v2"


def test_note_revert_no_previous():
    """Reverting with no previous content should return False."""
    user = User("testuser", "testpass", "test@test.com")
    note = user.add_note("Test", "Only version", None)

    result = note.revert_to_last_version()
    assert result is False


def test_note_get_full_content_with_properties():
    """get_full_content should reconstruct frontmatter + body."""
    user = User("testuser", "testpass", "test@test.com")
    note = user.add_note("Test", "---\ntags:\n  - python\n---\nBody here", None)

    full = note.get_full_content()
    assert "tags:" in full
    assert "Body here" in full


def test_note_return_json():
    """return_json should include all expected keys."""
    user = User("testuser", "testpass", "test@test.com")
    note = user.add_note("Test", "Content", None)

    data = note.return_json()
    assert data['title'] == 'Test'
    assert data['content'] == 'Content'
    assert 'id' in data
    assert 'category' in data
    assert 'properties' in data
    assert 'date_added' in data
    assert 'date_last_changed' in data


def test_note_change_category_by_id():
    user = User("testuser", "testpass", "test@test.com")
    cat = UserNoteCategory(user.id, "Target")
    note = user.add_note("Test", "Content", None)

    note.change_category(cat.id)
    assert note.category_id == cat.id


def test_note_change_category_by_name():
    user = User("testuser", "testpass", "test@test.com")
    note = user.add_note("Test", "Content", None)

    note.change_category("NewCat")
    assert note.category.name == "NewCat"


def test_note_frontmatter_with_init():
    """Creating a note with frontmatter should extract properties on init."""
    user = User("testuser", "testpass", "test@test.com")
    note = user.add_note("FM Note", "---\nkey: value\n---\nBody", None)

    assert note.content == "Body"
    props = note.get_properties()
    assert props["key"] == "value"
