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


def test_settings_audio_panel_and_persistence(app_context):
    """The Audio settings tab renders and persists the seven audio settings."""
    from flasky.models import User
    from flasky.ui_settings import get_setting
    client = app_context.test_client()
    make_e2ee_user(client, "audiosettings", "testpassword123")

    # The settings fragment should render the Audio nav + panel + fields.
    r = client.get("/settings?_fragment=1")
    assert r.status_code == 200
    body = r.get_data(as_text=True)
    assert 'data-tab="audio"' in body
    assert 'name="audio-recording-enabled"' in body
    assert 'name="audio-device-id"' in body
    assert 'name="audio-max-duration-min"' in body
    assert 'name="audio-mime-preference"' in body
    assert 'name="audio-echo-cancellation"' in body
    assert 'name="audio-noise-suppression"' in body
    assert 'name="audio-auto-gain-control"' in body

    # Defaults before any POST: recording off, processing toggles on.
    user = User.query.filter_by(username="audiosettings").first()
    assert get_setting(user, "audio_recording_enabled") is False
    assert get_setting(user, "audio_echo_cancellation") is True
    assert get_setting(user, "audio_noise_suppression") is True
    assert get_setting(user, "audio_auto_gain_control") is True
    assert get_setting(user, "audio_max_duration_min") == 5
    assert get_setting(user, "audio_mime_preference") == "auto"
    assert get_setting(user, "audio_device_id") == ""

    # POST: turn recording on, set all fields.
    r = client.post(
        "/settings",
        data={
            "update-ui-settings": "Save settings",
            "audio-recording-enabled": "1",
            "audio-device-id": "default-device-xyz",
            "audio-max-duration-min": "10",
            "audio-mime-preference": "webm-opus",
            "audio-echo-cancellation": "1",
            "audio-noise-suppression": "1",
            "audio-auto-gain-control": "1",
        },
        follow_redirects=True,
    )
    assert r.status_code == 200
    assert get_setting(user, "audio_recording_enabled") is True
    assert get_setting(user, "audio_device_id") == "default-device-xyz"
    assert get_setting(user, "audio_max_duration_min") == 10
    assert get_setting(user, "audio_mime_preference") == "webm-opus"
    assert get_setting(user, "audio_echo_cancellation") is True

    # Omitting the recording toggle (unchecked checkbox) turns it back off;
    # the processing toggles also go off when omitted.
    r = client.post(
        "/settings",
        data={
            "update-ui-settings": "Save settings",
            "audio-device-id": "",
            "audio-max-duration-min": "5",
            "audio-mime-preference": "auto",
        },
        follow_redirects=True,
    )
    assert r.status_code == 200
    assert get_setting(user, "audio_recording_enabled") is False
    assert get_setting(user, "audio_echo_cancellation") is False
    assert get_setting(user, "audio_noise_suppression") is False
    assert get_setting(user, "audio_auto_gain_control") is False
    assert get_setting(user, "audio_device_id") == ""

    # Out-of-range duration and invalid mime are rejected silently (validator
    # falls back without overwriting). max_duration_min must stay in [1,300].
    r = client.post(
        "/settings",
        data={
            "update-ui-settings": "Save settings",
            "audio-max-duration-min": "99999",
            "audio-mime-preference": "bogus",
        },
        follow_redirects=True,
    )
    assert r.status_code == 200
    # "bogus" was coerced to "auto" by the handler (reject-then-default path).
    assert get_setting(user, "audio_mime_preference") == "auto"
    # 99999 fails _is_int_in_range(1,300) so the validator in set_setting
    # rejects it and the previous value (5) is preserved.
    assert get_setting(user, "audio_max_duration_min") == 5


def test_settings_links_panel_and_persistence(app_context):
    """The Links settings tab renders and persists the five link-suggest settings."""
    from flasky.models import User
    from flasky.ui_settings import get_setting
    client = app_context.test_client()
    make_e2ee_user(client, "linksettings", "testpassword123")

    # The settings fragment should render the Links nav + panel + fields.
    r = client.get("/settings?_fragment=1")
    assert r.status_code == 200
    body = r.get_data(as_text=True)
    assert 'data-tab="links"' in body
    assert 'name="autosuggest-note-links"' in body
    assert 'name="autosuggest-min-chars"' in body
    assert 'name="autosuggest-result-cap"' in body
    assert 'name="autosuggest-algorithm"' in body
    assert 'name="autosuggest-show-category"' in body
    assert 'name="autosuggest-ghost-notes"' in body
    assert 'name="autosuggest-ghost-create"' in body

    # Defaults before any POST: master toggle off, min 2, cap 5, algo title_prefix, no category, ghost on, ghost-create on.
    user = User.query.filter_by(username="linksettings").first()
    assert get_setting(user, "autosuggest_note_links") is False
    assert get_setting(user, "autosuggest_min_chars") == 2
    assert get_setting(user, "autosuggest_result_cap") == 5
    assert get_setting(user, "autosuggest_algorithm") == "title_prefix"
    assert get_setting(user, "autosuggest_show_category") is False
    assert get_setting(user, "autosuggest_ghost_notes") is True
    assert get_setting(user, "autosuggest_ghost_create") is True

    # POST: turn everything on and bump the numeric knobs.
    r = client.post(
        "/settings",
        data={
            "save-links": "Save links",
            "autosuggest-note-links": "1",
            "autosuggest-min-chars": "3",
            "autosuggest-result-cap": "10",
            "autosuggest-algorithm": "title_substring",
            "autosuggest-show-category": "1",
            "autosuggest-ghost-notes": "1",
            "autosuggest-ghost-create": "1",
        },
        follow_redirects=True,
    )
    assert r.status_code == 200
    assert get_setting(user, "autosuggest_note_links") is True
    assert get_setting(user, "autosuggest_min_chars") == 3
    assert get_setting(user, "autosuggest_result_cap") == 10
    assert get_setting(user, "autosuggest_algorithm") == "title_substring"
    assert get_setting(user, "autosuggest_show_category") is True
    assert get_setting(user, "autosuggest_ghost_notes") is True
    assert get_setting(user, "autosuggest_ghost_create") is True

    # Omitting the toggles (unchecked checkboxes) turns them back off;
    # out-of-range numerics fall back to the floor; bad algo -> title_prefix.
    r = client.post(
        "/settings",
        data={
            "save-links": "Save links",
            "autosuggest-min-chars": "1",
            "autosuggest-result-cap": "999",
            "autosuggest-algorithm": "bogus",
        },
        follow_redirects=True,
    )
    assert r.status_code == 200
    assert get_setting(user, "autosuggest_note_links") is False
    assert get_setting(user, "autosuggest_min_chars") == 2
    assert get_setting(user, "autosuggest_result_cap") == 1
    assert get_setting(user, "autosuggest_algorithm") == "title_prefix"
    assert get_setting(user, "autosuggest_show_category") is False
    assert get_setting(user, "autosuggest_ghost_notes") is False
    assert get_setting(user, "autosuggest_ghost_create") is False


# === Attachment upload on new note ===


def test_upload_attachment_after_creating_note(app_context):
    """Regression: attachments can be uploaded against a freshly created note.

    The client-side flow on a new (noteId=0) note is: save the note to obtain
    a real id, then POST /api/upload_attachment. This verifies the server
    path the client relies on — create via /api/save_note, then upload.
    """
    import io
    from flasky.models import Attachment, User, UserNote

    client = app_context.test_client()
    creds = make_e2ee_user(client, "uploadnew", "testpassword123")

    note_r = client.post(
        "/api/save_note",
        json={
            "noteId": 0,
            "title": enc(creds, "Untitled"),
            "content": enc(creds, ""),
            "category": None,
        },
    )
    assert note_r.status_code == 200
    assert note_r.get_json()["success"] is True
    note_id = note_r.get_json()["note"]["id"]
    assert note_id > 0

    r = client.post(
        "/api/upload_attachment",
        data={
            "file": (io.BytesIO(b"fake-encrypted-bytes"), "encrypted"),
            "filename": enc(creds, "pasted-image.png"),
        },
        content_type="multipart/form-data",
    )
    assert r.status_code in (200, 201)
    data = r.get_json()
    assert data["id"] > 0

    user = User.query.filter_by(username="uploadnew").first()
    assert Attachment.query.filter_by(id=data["id"], user_id=user.id).first() is not None
    note = UserNote.query.filter_by(id=note_id).first()
    assert note is not None
    assert dec(creds, note.title) == "Untitled"


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


# === Attachment rename endpoint ===


def test_rename_attachment_updates_filename_and_notes(auth_client):
    """PUT /api/attachment/<id>/rename updates the attachment's encrypted
    filename and atomically rewrites the encrypted content of every note
    the client supplies in the same transaction.
    """
    from flasky.models import User, Attachment, UserNote
    client, creds = auth_client
    user = User.query.filter_by(username="testuser").first()

    att = _create_attachment_via_service(user, b"img-bytes", "old-name.png")

    note_r = client.post(
        "/api/save_note",
        json={
            "noteId": 0,
            "title": enc(creds, "Note with embed"),
            "content": enc(creds, "Here is ![[old-name.png]] embedded."),
            "category": None,
        },
    )
    note_id = note_r.get_json()["note"]["id"]

    new_content_plain = "Here is ![[new-name.png]] embedded."
    r = client.put(
        f"/api/attachment/{att.id}/rename",
        json={
            "attachmentId": att.id,
            "newFilename": enc(creds, "new-name.png"),
            "notes": [{"noteId": note_id, "content": enc(creds, new_content_plain)}],
        },
    )
    assert r.status_code == 200
    data = r.get_json()
    assert data["id"] == att.id
    assert data["updated_notes"] == [note_id]

    refreshed = Attachment.query.filter_by(id=att.id).first()
    assert dec(creds, refreshed.filename) == "new-name.png"
    assert os.path.exists(refreshed.disk_path())

    note = UserNote.query.filter_by(id=note_id).first()
    assert dec(creds, note.content) == new_content_plain
    assert dec(creds, note.previous_content) == "Here is ![[old-name.png]] embedded."


def test_rename_attachment_no_notes_updates_name_only(auth_client):
    """Rename with an empty notes list updates only the attachment filename."""
    from flasky.models import User, Attachment
    client, creds = auth_client
    user = User.query.filter_by(username="testuser").first()
    att = _create_attachment_via_service(user, b"data", "before.png")

    r = client.put(
        f"/api/attachment/{att.id}/rename",
        json={
            "attachmentId": att.id,
            "newFilename": enc(creds, "after.png"),
            "notes": [],
        },
    )
    assert r.status_code == 200
    assert dec(creds, Attachment.query.filter_by(id=att.id).first().filename) == "after.png"


def test_rename_attachment_missing_returns_404(auth_client):
    """Rename of a nonexistent attachment returns 404."""
    client, creds = auth_client
    r = client.put(
        "/api/attachment/999999/rename",
        json={
            "attachmentId": 999999,
            "newFilename": enc(creds, "x.png"),
            "notes": [],
        },
    )
    assert r.status_code == 404


def test_rename_attachment_id_mismatch_rejected(auth_client):
    """If the body attachmentId doesn't match the URL id, reject with 400."""
    from flasky.models import User
    client, creds = auth_client
    user = User.query.filter_by(username="testuser").first()
    att = _create_attachment_via_service(user, b"data", "keep.png")

    r = client.put(
        f"/api/attachment/{att.id}/rename",
        json={
            "attachmentId": att.id + 1,
            "newFilename": enc(creds, "changed.png"),
            "notes": [],
        },
    )
    assert r.status_code == 400


def test_rename_attachment_validation_error(auth_client):
    """Missing required fields produce a 422 with structured details."""
    from flasky.models import User
    client, creds = auth_client
    user = User.query.filter_by(username="testuser").first()
    att = _create_attachment_via_service(user, b"data", "v.png")

    r = client.put(
        f"/api/attachment/{att.id}/rename",
        json={"attachmentId": att.id, "notes": []},
    )
    assert r.status_code == 422
    assert "details" in r.get_json()


def test_rename_attachment_other_user_not_found(auth_client):
    """Renaming another user's attachment returns 404 (ownership filter)."""
    from flasky.models import User, Attachment
    from flasky.services.auth import create_user
    client, creds = auth_client
    user_b = create_user("renameother", "otherpassword123", "ro@test.com")
    att_b = _create_attachment_via_service(user_b, b"theirs", "theirs.png")

    r = client.put(
        f"/api/attachment/{att_b.id}/rename",
        json={
            "attachmentId": att_b.id,
            "newFilename": enc(creds, "stolen.png"),
            "notes": [],
        },
    )
    assert r.status_code == 404
    assert Attachment.query.filter_by(id=att_b.id).first() is not None


def test_ghost_notes_setting_injected_into_page(app_context):
    """The autosuggestGhostNotes and autosuggestGhostCreate flags must be
    present in _pageData on the note editor page so the client-side JS can
    gate ghost note surfaces.
    """
    client = app_context.test_client()
    creds = make_e2ee_user(client, "ghostpage", "testpassword123")

    r = client.get("/note/0")
    assert r.status_code == 200
    body = r.get_data(as_text=True)
    assert '"autosuggestGhostNotes"' in body
    assert '"autosuggestGhostCreate"' in body

    from flasky.models import User
    from flasky.ui_settings import get_setting, set_setting
    user = User.query.filter_by(username="ghostpage").first()
    assert get_setting(user, "autosuggest_ghost_notes") is True
    assert get_setting(user, "autosuggest_ghost_create") is True

    set_setting(user, "autosuggest_ghost_notes", False)
    set_setting(user, "autosuggest_ghost_create", False)
    from flasky import db
    db.session.commit()

    r = client.get("/note/0")
    assert r.status_code == 200
    body = r.get_data(as_text=True)
    assert '"autosuggestGhostNotes": false' in body
    assert '"autosuggestGhostCreate": false' in body


def test_note_map_returns_encrypted_titles(app_context):
    """The /api/note-map endpoint returns encrypted note titles that the
    client-side search index (e2ee-search.js) decrypts and uses for
    computeOutboundLinks / computeBacklinks. Verify the data shape.
    """
    client = app_context.test_client()
    creds = make_e2ee_user(client, "notemap", "testpassword123")

    r = client.post(
        "/api/save_note",
        json={
            "noteId": 0,
            "title": enc(creds, "Test Note Title"),
            "content": enc(creds, "Some content with [[Ghost Link]] inside"),
            "category": None,
        },
    )
    assert r.status_code == 200
    note_id = r.get_json()["note"]["id"]

    r = client.get("/api/note-map")
    assert r.status_code == 200
    data = r.get_json()
    assert data["encrypted"] is True
    assert isinstance(data["notes"], list)
    assert len(data["notes"]) >= 1

    note_entry = next(n for n in data["notes"] if n["id"] == note_id)
    assert note_entry["id"] == note_id
    assert note_entry["title"] != "Test Note Title"
    assert dec(creds, note_entry["title"]) == "Test Note Title"
