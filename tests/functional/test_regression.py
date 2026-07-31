"""
Functional Regression Tests: Known bug cases (E2EE-aware).
"""

import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from tests.e2ee_helpers import make_e2ee_user, enc, dec


def test_note_category_reassignment_bug(app_context):
    """Regression: when a category is deleted, notes are reassigned to the default category."""
    client = app_context.test_client()
    creds = make_e2ee_user(client, "bugtest", "testpassword123")

    cat_r = client.post("/api/add_category", json={"categoryName": enc(creds, "Delete Test")})
    category_id = cat_r.json["category"]

    note_r = client.post(
        "/api/save_note",
        json={
            "noteId": 0,
            "title": enc(creds, "Category Bug Test"),
            "content": enc(creds, "Testing category reassignment"),
            "category": category_id,
        },
    )
    note_id = note_r.json["note"]["id"]

    client.post("/api/delete_category", json={"categoryId": category_id})

    # Note should still be accessible (moved to default category)
    note_check = client.get(f"/note/{note_id}")
    assert note_check.status_code == 200


def test_ui_settings_persistence(app_context):
    """Regression: UI settings should persist after being changed."""
    client = app_context.test_client()
    creds = make_e2ee_user(client, "uitest", "testpassword123")

    # Change dark mode via the API
    r = client.get("/api/save_dark_mode/1")
    assert r.json["success"] is True

    # Verify settings page still renders
    settings_r = client.get("/settings")
    assert settings_r.status_code == 200


def test_note_revert_preserves_previous(app_context):
    """Regression: reverting a note should swap content and previous_content."""
    client = app_context.test_client()
    creds = make_e2ee_user(client, "reverttest", "testpassword123")

    r = client.post(
        "/api/save_note",
        json={"noteId": 0, "title": enc(creds, "Revert Note"), "content": enc(creds, "Version 1"), "category": None},
    )
    note_id = r.json["note"]["id"]

    client.post(
        "/api/save_note",
        json={"noteId": note_id, "title": enc(creds, "Revert Note"), "content": enc(creds, "Version 2"), "category": None},
    )

    # Revert via the API
    client.post("/api/revert_note", json={"noteId": note_id})

    # Fetch the note via the API and decrypt to verify content is back to v1
    note_r = client.get(f"/api/note/{note_id}")
    assert note_r.json["success"] is True
    assert dec(creds, note_r.json["note"]["content"]) == "Version 1"


def test_subfolder_category_deletion(app_context):
    """Regression: deleting a parent category still leaves child notes accessible
    (reassigned to the default category). With mandatory E2EE, the client sends
    separate delete requests for each child; this test only deletes the parent.
    """
    client = app_context.test_client()
    creds = make_e2ee_user(client, "subfoldertest", "testpassword123")

    parent_r = client.post("/api/add_category", json={"categoryName": enc(creds, "Work")})
    parent_id = parent_r.json["category"]
    child_r = client.post("/api/add_category", json={"categoryName": enc(creds, "Work/Projects")})
    child_id = child_r.json["category"]

    note_r = client.post(
        "/api/save_note",
        json={"noteId": 0, "title": enc(creds, "Child Note"), "content": enc(creds, "In child"), "category": child_id},
    )
    note_id = note_r.json["note"]["id"]

    # Delete the child category (parent stays). With E2EE the client must
    # delete children individually — the server can't find them by path prefix.
    client.post("/api/delete_category", json={"categoryId": child_id})

    # Note should still exist (reassigned to main)
    note_check = client.get(f"/note/{note_id}")
    assert note_check.status_code == 200


def test_settings_attachments_panel_and_persistence(app_context):
    """The Attachments/Drawing settings tabs render and persist max-width values."""
    from flasky.ui_settings import get_setting
    from flasky.models import User
    client = app_context.test_client()
    creds = make_e2ee_user(client, "attachsettings", "testpassword123")

    # The settings fragment should render both panels + nav buttons.
    r = client.get("/settings?_fragment=1")
    assert r.status_code == 200
    body = r.get_data(as_text=True)
    assert 'data-tab="attachments"' in body
    assert 'name="attachment-max-width"' in body
    assert 'name="attachments-folder-enabled"' in body
    assert 'name="attachments-folder-subcategories"' in body
    assert 'data-tab="drawing"' in body
    assert 'name="drawing-max-width"' in body

    # POST the shared ui-settings form with the two fields + drawing toggle +
    # the attachments-folder toggles.
    r = client.post(
        "/settings",
        data={
            "update-ui-settings": "Save settings",
            "drawing-enabled": "1",
            "attachment-max-width": "300",
            "drawing-max-width": "250px",
            "attachments-folder-enabled": "1",
            "attachments-folder-subcategories": "1",
        },
        follow_redirects=True,
    )
    assert r.status_code == 200

    user = User.query.filter_by(username="attachsettings").first()
    assert get_setting(user, "attachment_max_width") == "300"
    assert get_setting(user, "drawing_max_width") == "250px"
    assert get_setting(user, "drawing_enabled") is True
    assert get_setting(user, "attachments_folder_enabled") is True
    assert get_setting(user, "attachments_folder_subcategories") is True

    # Omitting the toggles (unchecked checkboxes) turns them back off.
    r = client.post(
        "/settings",
        data={
            "update-ui-settings": "Save settings",
            "attachment-max-width": "300",
            "drawing-max-width": "250px",
        },
        follow_redirects=True,
    )
    assert r.status_code == 200
    assert get_setting(user, "attachments_folder_enabled") is False
    assert get_setting(user, "attachments_folder_subcategories") is False

    # Bad input is rejected and does not crash or overwrite the stored value.
    r = client.post(
        "/settings",
        data={
            "update-ui-settings": "Save settings",
            "attachment-max-width": "abc",
            "drawing-max-width": "150%",
        },
        follow_redirects=True,
    )
    assert r.status_code == 200
    # "abc" rejected → previous "300" preserved; "150%" rejected → "250px" preserved.
    assert get_setting(user, "attachment_max_width") == "300"
    assert get_setting(user, "drawing_max_width") == "250px"


# === Attachment deletion endpoints ===


def _create_attachment_via_service(user, data=b"test-bytes", filename="test.png"):
    from flasky.services.attachments import upload_attachment_bytes
    att, _ = upload_attachment_bytes(user, filename, data)
    return att


def test_delete_attachment_endpoint(auth_client):
    """DELETE /api/attachment/<id> removes the attachment."""
    from flasky.models import User
    client, creds = auth_client
    user = User.query.filter_by(username="testuser").first()
    att = _create_attachment_via_service(user, b"hello", "photo.png")

    r = client.delete(f"/api/attachment/{att.id}")
    assert r.status_code == 200
    assert r.get_json()["deleted"] == att.id
    from flasky.models import Attachment
    assert Attachment.query.filter_by(id=att.id).first() is None


def test_delete_attachment_not_found_endpoint(auth_client):
    """DELETE /api/attachment/<id> returns 404 for nonexistent id."""
    client, creds = auth_client
    r = client.delete("/api/attachment/999999")
    assert r.status_code == 404


def test_delete_attachment_batch_endpoint(auth_client):
    """POST /api/attachments/delete-batch removes multiple attachments."""
    from flasky.models import User, Attachment
    client, creds = auth_client
    user = User.query.filter_by(username="testuser").first()
    a1 = _create_attachment_via_service(user, b"one", "a.png")
    a2 = _create_attachment_via_service(user, b"two", "b.png")
    a3 = _create_attachment_via_service(user, b"three", "c.png")

    r = client.post(
        "/api/attachments/delete-batch",
        json={"ids": [a1.id, a2.id, a3.id]},
    )
    assert r.status_code == 200
    assert r.get_json()["deleted"] == 3
    assert Attachment.query.filter_by(user_id=user.id).count() == 0


def test_delete_attachment_batch_empty_ids(auth_client):
    """POST /api/attachments/delete-batch rejects empty/missing ids list."""
    client, creds = auth_client
    r = client.post("/api/attachments/delete-batch", json={"ids": []})
    assert r.status_code == 400
    r = client.post("/api/attachments/delete-batch", json={})
    assert r.status_code == 400


def test_delete_attachment_batch_ignores_other_user_ids(auth_client):
    """Batch delete only touches the calling user's attachments."""
    from flasky.models import User, Attachment
    from flasky.services.auth import create_user
    client, creds = auth_client
    user_a = User.query.filter_by(username="testuser").first()

    # Create a second user directly (without changing the session)
    user_b = create_user("otheruser2", "otherpassword123", "otheruser2@test.com")
    att_b = _create_attachment_via_service(user_b, b"theirs", "theirs.png")
    att_a = _create_attachment_via_service(user_a, b"mine", "mine.png")

    # user_a tries to delete both their own and user_b's attachment
    r = client.post(
        "/api/attachments/delete-batch",
        json={"ids": [att_a.id, att_b.id]},
    )
    assert r.status_code == 200
    assert r.get_json()["deleted"] == 1  # only user_a's
    # user_b's attachment still exists
    assert Attachment.query.filter_by(id=att_b.id).first() is not None