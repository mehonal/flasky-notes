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


def test_user_get_default_category_creates_if_missing():
    """get_default_category returns None when no categories exist; the
    categories service creates one on demand via
    get_or_create_default_category. With no default_category_id set, it
    falls back to first-by-id.
    """
    from flasky.services.categories import get_or_create_default_category
    user = _make_user()
    default = get_or_create_default_category(user)
    assert default is not None


def test_user_get_category_by_id():
    from flasky.services.categories import create_category
    user = _make_user()
    cat = create_category(user, "opaque-ciphertext")
    fetched = user.get_category(cat.id)
    assert fetched is not None
    assert fetched.id == cat.id


def test_user_get_category_none_returns_default():
    from flasky.services.categories import get_or_create_default_category
    user = _make_user()
    get_or_create_default_category(user)  # ensure a default category exists
    cat = user.get_category(None)
    assert cat is not None


def test_default_category_setting_is_honored():
    """When default_category_id points at an existing category, that category
    is returned by get_default_category / get_or_create_default_category
    instead of the first-by-id fallback.
    """
    from flasky.services.categories import (
        create_category, get_or_create_default_category,
    )
    from flasky.ui_settings import set_setting
    user = _make_user()
    first = get_or_create_default_category(user)  # creates + returns first
    chosen = create_category(user, "opaque-ciphertext-2")
    set_setting(user, "default_category_id", chosen.id)
    assert user.get_default_category().id == chosen.id
    assert get_or_create_default_category(user).id == chosen.id
    assert user.get_default_category().id != first.id


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
    set_setting(user, "compact_mode", True)
    assert get_setting(user, "compact_mode") is True


def test_ui_settings_defaults_on_missing_key():
    """A user with no stored ui_settings gets the registry defaults on read."""
    from flasky.ui_settings import get_setting
    user = _make_user("testuser2", "testpass", "test2@test.com")
    assert get_setting(user, "font_size") == 16  # registry default
    assert get_setting(user, "dark_mode") is False  # registry default
    assert get_setting(user, "compact_mode") is False  # registry default


def test_attachment_drawing_max_width_round_trip():
    """attachment_max_width / drawing_max_width persist and read back."""
    from flasky.ui_settings import set_setting, get_setting
    user = _make_user("widthuser", "testpass", "width@test.com")
    # Default is empty string (full width).
    assert get_setting(user, "attachment_max_width") == ""
    assert get_setting(user, "drawing_max_width") == ""
    # Valid values persist.
    assert set_setting(user, "attachment_max_width", "300") is True
    assert get_setting(user, "attachment_max_width") == "300"
    assert set_setting(user, "drawing_max_width", "250px") is True
    assert get_setting(user, "drawing_max_width") == "250px"
    assert set_setting(user, "attachment_max_width", "50%") is True
    assert get_setting(user, "attachment_max_width") == "50%"


def test_attachment_drawing_max_width_validation():
    """Validator accepts valid width strings and rejects invalid ones."""
    from flasky.ui_settings import set_setting, get_setting
    user = _make_user("widthvalid", "testpass", "widthvalid@test.com")
    # Accepted: empty, "0", bare number, "Npx", "N%".
    for ok in ("", "0", "300", "300px", "50%", "1%", "100%", "4000px"):
        assert set_setting(user, "attachment_max_width", ok) is True, ok
    # Rejected: negative, over range, bad percent, non-numeric, wrong type,
    # whitespace inside the value, signed numbers, wrong unit casing.
    for bad in ("-5", "4001px", "5000", "0%", "150%", "abc", "12.5px", "30em",
                "300 px", "+300", "300PX", "0x10", "1e3", True):
        assert set_setting(user, "attachment_max_width", bad) is False, bad
        # On rejection the previously stored value is preserved.
        assert get_setting(user, "attachment_max_width") == "4000px"


def test_attachments_folder_settings_defaults_and_round_trip():
    """attachments_folder_enabled / attachments_folder_subcategories default
    to True and persist True/False round-trips."""
    from flasky.ui_settings import set_setting, get_setting
    user = _make_user("attfolder", "testpass", "attfolder@test.com")
    assert get_setting(user, "attachments_folder_enabled") is True
    assert get_setting(user, "attachments_folder_subcategories") is True
    assert set_setting(user, "attachments_folder_enabled", False) is True
    assert get_setting(user, "attachments_folder_enabled") is False
    assert set_setting(user, "attachments_folder_subcategories", False) is True
    assert get_setting(user, "attachments_folder_subcategories") is False
    # Truthy round-trip back on.
    assert set_setting(user, "attachments_folder_enabled", True) is True
    assert get_setting(user, "attachments_folder_enabled") is True
    # Bool coercion from common truthy strings.
    assert set_setting(user, "attachments_folder_enabled", "1") is True
    assert get_setting(user, "attachments_folder_enabled") is True


# === Attachment deletion (service layer) ===


def _make_attachment(user, data=b"test-bytes", filename="test.png"):
    """Create an attachment via the service layer (bypasses HTTP)."""
    from flasky.services.attachments import upload_attachment_bytes
    att, _ = upload_attachment_bytes(user, filename, data)
    return att


def test_delete_attachment_removes_row_and_disk_file():
    from flasky.services.attachments import delete_attachment, get_attachment, AttachmentNotFound
    user = _make_user("attdelete", "testpass", "attdelete@test.com")
    att = _make_attachment(user, b"hello-world", "file.png")
    assert att.id is not None

    disk = att.disk_path()
    import os
    assert os.path.exists(disk)

    deleted = delete_attachment(user, att.id)
    assert deleted.id == att.id

    # DB row gone
    try:
        get_attachment(user, att.id)
        assert False, "Should have raised AttachmentNotFound"
    except AttachmentNotFound:
        pass

    # Disk file gone
    assert not os.path.exists(disk)


def test_delete_attachment_not_found_raises():
    from flasky.services.attachments import delete_attachment, AttachmentNotFound
    user = _make_user("att404", "testpass", "att404@test.com")
    try:
        delete_attachment(user, 999999)
        assert False, "Should have raised AttachmentNotFound"
    except AttachmentNotFound:
        pass


def test_delete_attachment_other_user_not_found():
    """A user cannot delete another user's attachment (ownership check)."""
    from flasky.services.attachments import delete_attachment, AttachmentNotFound
    user_a = _make_user("usera", "testpass", "usera@test.com")
    user_b = _make_user("userb", "testpass", "userb@test.com")
    att = _make_attachment(user_a, b"owner-a", "secret.png")
    try:
        delete_attachment(user_b, att.id)
        assert False, "Should have raised AttachmentNotFound"
    except AttachmentNotFound:
        pass
    # user_a's attachment is untouched
    from flasky.services.attachments import get_attachment
    assert get_attachment(user_a, att.id).id == att.id


def test_delete_attachments_batch():
    """Bulk delete removes all matching attachments owned by the user."""
    from flasky.services.attachments import delete_attachments, list_attachments, Attachment
    user = _make_user("attbatch", "testpass", "attbatch@test.com")
    a1 = _make_attachment(user, b"one", "a.png")
    a2 = _make_attachment(user, b"two", "b.png")
    a3 = _make_attachment(user, b"three", "c.png")
    ids = [a1.id, a2.id, a3.id]

    count = delete_attachments(user, ids)
    assert count == 3
    assert list_attachments(user) == []
    for aid in ids:
        assert Attachment.query.filter_by(id=aid).first() is None


def test_delete_attachments_batch_ignores_other_user_ids():
    """Bulk delete only touches rows owned by the calling user."""
    from flasky.services.attachments import delete_attachments, get_attachment
    user_a = _make_user("batcha", "testpass", "batcha@test.com")
    user_b = _make_user("batchb", "testpass", "batchb@test.com")
    att_a = _make_attachment(user_a, b"mine", "mine.png")
    att_b = _make_attachment(user_b, b"theirs", "theirs.png")
    count = delete_attachments(user_a, [att_a.id, att_b.id])
    assert count == 1  # only user_a's attachment
    # user_b's attachment is untouched
    assert get_attachment(user_b, att_b.id).id == att_b.id


def test_delete_attachments_batch_empty_list():
    from flasky.services.attachments import delete_attachments
    user = _make_user("attempty", "testpass", "attempty@test.com")
    assert delete_attachments(user, []) == 0


def test_topbar_items_defaults():
    """A fresh user gets DEFAULT_TOPBAR_ITEMS from the registry on first read,
    minus feature-gated items (drawing/audio/daily_note/ai) whose features
    default off."""
    from flasky.ui_settings import get_topbar_items, DEFAULT_TOPBAR_ITEMS
    user = _make_user("topbardef", "testpass", "topbardef@test.com")
    items = get_topbar_items(user)
    ids = [it["id"] for it in items]
    # Feature-gated ids are stripped when the feature is off (fresh user).
    gated = {"drawing", "audio", "daily_note", "ai"}
    expected = [it["id"] for it in DEFAULT_TOPBAR_ITEMS if it["id"] not in gated]
    assert ids == expected
    assert all(it["visible"] for it in items if not it["id"].startswith("divider_"))


def test_topbar_items_round_trip_and_reorder():
    """set_topbar_items persists order + visibility; get_topbar_items reads it back."""
    from flasky.ui_settings import get_topbar_items, set_topbar_items
    user = _make_user("topbarrr", "testpass", "topbarrr@test.com")
    items = get_topbar_items(user)
    # Reverse the order and hide one item.
    reordered = list(reversed(items))
    reordered[0]["visible"] = False
    assert set_topbar_items(user, reordered) is True
    back = get_topbar_items(user)
    assert [it["id"] for it in back] == [it["id"] for it in reordered]
    assert back[0]["visible"] is False


def test_topbar_items_forward_merge_new_defaults():
    """When a new item is added to DEFAULT_TOPBAR_ITEMS, existing users pick it
    up on next read (forward-merge) instead of having it hidden forever."""
    from flasky.ui_settings import get_topbar_items, set_topbar_items, DEFAULT_TOPBAR_ITEMS
    user = _make_user("topbarfm", "testpass", "topbarfm@test.com")
    # Save a list missing the last default item (simulate an older saved state).
    items = get_topbar_items(user)
    trimmed = [dict(it) for it in items if it["id"] != DEFAULT_TOPBAR_ITEMS[-1]["id"]]
    set_topbar_items(user, trimmed)
    # On re-read the missing default is appended at the end.
    back = get_topbar_items(user)
    assert back[-1]["id"] == DEFAULT_TOPBAR_ITEMS[-1]["id"]


def test_topbar_items_strips_feature_off_items():
    """Feature-gated items (drawing/audio/daily_note) are stripped when their
    feature flag is off, so the customizer never offers a no-op toggle."""
    from flasky.ui_settings import get_topbar_items, set_setting
    user = _make_user("topbargate", "testpass", "topbargate@test.com")
    # drawing_enabled defaults off; drawing must not appear.
    items = get_topbar_items(user)
    assert "drawing" not in [it["id"] for it in items]
    # Turn drawing on → drawing reappears (forward-merge from defaults).
    set_setting(user, "drawing_enabled", True)
    items = get_topbar_items(user)
    assert "drawing" in [it["id"] for it in items]
    # Turn it back off → drawing is stripped again.
    set_setting(user, "drawing_enabled", False)
    items = get_topbar_items(user)
    assert "drawing" not in [it["id"] for it in items]


def test_topbar_items_ai_gate_uses_user_settings():
    """The ai item is gated by UserSettings.ai_enabled (a column), not a
    ui_settings key, so it is stripped when ai_enabled is False."""
    from flasky.ui_settings import get_topbar_items
    user = _make_user("topbarai", "testpass", "topbarai@test.com")
    # ai_enabled defaults False on a fresh UserSettings.
    assert not user.settings.ai_enabled
    items = get_topbar_items(user)
    assert "ai" not in [it["id"] for it in items]
    # Enable ai on the settings column → ai reappears.
    user.settings.ai_enabled = True
    db.session.commit()
    items = get_topbar_items(user)
    assert "ai" in [it["id"] for it in items]