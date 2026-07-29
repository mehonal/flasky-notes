"""
Functional Integration Tests: Notes, Todos, Events, Categories APIs (E2EE-aware).

All note/category/todo/event content is encrypted with the test user's
symmetric key before send and decrypted after fetch to verify round-trips.
Uses tests/e2ee_helpers.enc/dec for crypto.
"""

import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from tests.e2ee_helpers import enc, dec


# === Notes API ===


def test_save_and_get_notes(auth_client):
    client, creds = auth_client
    title_cipher = enc(creds, "Test Note")
    content_cipher = enc(creds, "Test Content")
    r = client.post(
        "/api/save_note",
        json={"noteId": 0, "title": title_cipher, "content": content_cipher, "category": None},
    )
    assert r.status_code == 200
    assert r.json["success"] is True
    # Title comes back as ciphertext — decrypt to verify
    assert dec(creds, r.json["note"]["title"]) == "Test Note"

    notes_r = client.get("/api/get_all_notes")
    assert notes_r.status_code == 200
    assert len(notes_r.json) == 1
    assert dec(creds, notes_r.json[0]["title"]) == "Test Note"


def test_save_note_update_existing(auth_client):
    client, creds = auth_client
    r = client.post(
        "/api/save_note",
        json={"noteId": 0, "title": enc(creds, "Original"), "content": enc(creds, "Body"), "category": None},
    )
    note_id = r.json["note"]["id"]

    r2 = client.post(
        "/api/save_note",
        json={"noteId": note_id, "title": enc(creds, "Updated"), "content": enc(creds, "New Body"), "category": None},
    )
    assert r2.json["success"] is True
    assert dec(creds, r2.json["note"]["title"]) == "Updated"


def test_delete_note(auth_client):
    client, creds = auth_client
    r = client.post(
        "/api/save_note",
        json={"noteId": 0, "title": enc(creds, "To Delete"), "content": enc(creds, "Body"), "category": None},
    )
    note_id = r.json["note"]["id"]

    del_r = client.post("/api/delete_note", json={"noteId": note_id})
    assert del_r.json["success"] is True

    notes = client.get("/api/get_all_notes")
    assert len(notes.json) == 0


def test_note_map(auth_client):
    """With mandatory E2EE, note-map returns arrays of {id, title} (ciphertext)
    instead of a title-keyed dict. The client decrypts + indexes locally.
    """
    client, creds = auth_client
    client.post(
        "/api/save_note",
        json={"noteId": 0, "title": enc(creds, "My Note"), "content": enc(creds, "Body"), "category": None},
    )

    r = client.get("/api/note-map")
    assert r.status_code == 200
    data = r.json
    assert data["encrypted"] is True
    assert isinstance(data["notes"], list)
    assert len(data["notes"]) == 1
    assert dec(creds, data["notes"][0]["title"]) == "My Note"


def test_note_map_has_attachments_key(auth_client):
    client, creds = auth_client
    r = client.get("/api/note-map")
    assert "attachments" in r.json


# === Sidebar tree (E2EE: always JSON, client-side render) ===


def test_sidebar_tree_returns_encrypted_json(auth_client):
    client, creds = auth_client
    r = client.get("/api/sidebar_tree")
    assert r.status_code == 200
    assert r.json["encrypted"] is True
    assert isinstance(r.json["categories"], list)
    assert isinstance(r.json["notes"], list)


# === Categories ===


def test_add_category(auth_client):
    client, creds = auth_client
    r = client.post("/api/add_category", json={"categoryName": enc(creds, "Work")})
    assert r.json["success"] is True
    assert r.json["category"] is not None


def test_edit_note_category(auth_client):
    client, creds = auth_client
    cat_r = client.post("/api/add_category", json={"categoryName": enc(creds, "Personal")})
    cat_id = cat_r.json["category"]

    note_r = client.post(
        "/api/save_note",
        json={"noteId": 0, "title": enc(creds, "Note"), "content": enc(creds, "Body"), "category": None},
    )
    note_id = note_r.json["note"]["id"]

    r = client.post("/api/edit_note_category", json={"noteId": note_id, "category": cat_id})
    assert r.json["success"] is True


def test_delete_category_reassigns_notes(auth_client):
    client, creds = auth_client
    cat_r = client.post("/api/add_category", json={"categoryName": enc(creds, "Temp")})
    cat_id = cat_r.json["category"]

    note_r = client.post(
        "/api/save_note",
        json={"noteId": 0, "title": enc(creds, "Cat Note"), "content": enc(creds, "Body"), "category": cat_id},
    )
    note_id = note_r.json["note"]["id"]

    client.post("/api/delete_category", json={"categoryId": cat_id})

    # Note should still be accessible (moved to default category)
    note_check = client.get(f"/note/{note_id}")
    assert note_check.status_code == 200


def test_default_category_applied_when_none(auth_client):
    """create_note with no category honours the user's default_category_id."""
    from flasky.models import User
    from flasky.ui_settings import set_setting
    from flasky.services.categories import get_or_create_default_category

    client, creds = auth_client
    cat_r = client.post("/api/add_category", json={"categoryName": enc(creds, "Inbox")})
    inbox_id = cat_r.json["category"]

    user = User.query.filter_by(username="testuser").first()
    assert set_setting(user, "default_category_id", inbox_id)
    from flasky import db
    db.session.commit()

    note_r = client.post(
        "/api/save_note",
        json={"noteId": 0, "title": enc(creds, "Defaulted"), "content": enc(creds, ""), "category": None},
    )
    assert note_r.json["success"] is True
    assert note_r.json["note"]["category_id"] == inbox_id


def test_default_category_falls_back_to_first_when_stale(auth_client):
    """If default_category_id points at a category that no longer exists,
    create_note falls back to the user's first category.
    """
    from flasky.models import User, UserNoteCategory
    from flasky.ui_settings import set_setting
    from flasky.services.categories import get_or_create_default_category

    client, creds = auth_client
    user = User.query.filter_by(username="testuser").first()
    first_id = get_or_create_default_category(user).id

    # Point the setting at a non-existent category id (simulates a stale
    # setting after the configured folder was removed out-of-band).
    set_setting(user, "default_category_id", 999999)
    from flasky import db
    db.session.commit()

    note_r = client.post(
        "/api/save_note",
        json={"noteId": 0, "title": enc(creds, "Fallback"), "content": enc(creds, ""), "category": None},
    )
    assert note_r.json["success"] is True
    assert note_r.json["note"]["category_id"] == first_id


def test_default_category_zero_uses_main(auth_client):
    """Unset default (0) falls back to the user's first category (legacy)."""
    from flasky.models import User
    from flasky.ui_settings import set_setting
    from flasky.services.categories import get_or_create_default_category

    client, creds = auth_client
    user = User.query.filter_by(username="testuser").first()
    set_setting(user, "default_category_id", 0)
    from flasky import db
    db.session.commit()

    default_id = get_or_create_default_category(user).id

    note_r = client.post(
        "/api/save_note",
        json={"noteId": 0, "title": enc(creds, "Plain"), "content": enc(creds, ""), "category": None},
    )
    assert note_r.json["success"] is True
    assert note_r.json["note"]["category_id"] == default_id


def test_move_category_with_renames(auth_client):
    """With mandatory E2EE, move_category requires `renames` (client-computed
    encrypted names for the moved category + affected children).
    """
    client, creds = auth_client
    cat_r = client.post("/api/add_category", json={"categoryName": enc(creds, "Projects")})
    cat_id = cat_r.json["category"]

    r = client.post(
        "/api/move_category",
        json={"categoryId": cat_id, "renames": [{"id": cat_id, "name": enc(creds, "Work/Projects")}]},
    )
    assert r.json["success"] is True


def test_cannot_delete_default_category(auth_client):
    client, creds = auth_client
    from flasky.models import User
    from flasky.services.categories import get_or_create_default_category

    user = User.query.filter_by(username="testuser").first()
    default = get_or_create_default_category(user)

    r = client.post("/api/delete_category", json={"categoryId": default.id})
    assert r.json["success"] is False


# === Todos API ===


def test_add_todo(auth_client):
    client, creds = auth_client
    r = client.post(
        "/api/add_todo",
        json={"title": enc(creds, "Buy groceries"), "content": enc(creds, "Milk, eggs"), "dateDue": "2026-04-01"},
    )
    assert r.json["success"] is True
    assert dec(creds, r.json["todo"]["title"]) == "Buy groceries"


def test_get_todos(auth_client):
    client, creds = auth_client
    client.post("/api/add_todo", json={"title": enc(creds, "Todo 1"), "content": "", "dateDue": ""})
    client.post("/api/add_todo", json={"title": enc(creds, "Todo 2"), "content": "", "dateDue": ""})

    r = client.get("/api/get_todos")
    assert r.status_code == 200
    assert len(r.json) == 2


def test_get_single_todo(auth_client):
    client, creds = auth_client
    r = client.post("/api/add_todo", json={"title": enc(creds, "Single"), "content": enc(creds, "Details"), "dateDue": ""})
    todo_id = r.json["id"]

    r2 = client.get(f"/api/get_todo/{todo_id}")
    assert r2.json["success"] is True
    assert dec(creds, r2.json["todo"]["title"]) == "Single"


def test_edit_todo(auth_client):
    client, creds = auth_client
    r = client.post("/api/add_todo", json={"title": enc(creds, "Original"), "content": "", "dateDue": ""})
    todo_id = r.json["id"]

    r2 = client.post(
        "/api/edit_todo",
        json={"toDoId": todo_id, "title": enc(creds, "Updated"), "content": enc(creds, "New"), "dateDue": ""},
    )
    assert r2.json["success"] is True
    assert dec(creds, r2.json["todo"]["title"]) == "Updated"


def test_toggle_todo(auth_client):
    client, creds = auth_client
    r = client.post("/api/add_todo", json={"title": enc(creds, "Toggle Me"), "content": "", "dateDue": ""})
    todo_id = r.json["id"]

    r2 = client.post("/api/toggle_todo", json={"toDoId": todo_id, "status": "1"})
    assert r2.json["success"] is True

    r3 = client.get(f"/api/get_todo/{todo_id}")
    assert r3.json["todo"]["completed"] is True


def test_archive_unarchive_todo(auth_client):
    client, creds = auth_client
    r = client.post("/api/add_todo", json={"title": enc(creds, "Archive Me"), "content": "", "dateDue": ""})
    todo_id = r.json["id"]

    client.post("/api/archive_todo", json={"toDoId": todo_id})
    archived = client.get("/api/get_todos?archived=true")
    assert any(t["id"] == todo_id for t in archived.json)

    client.post("/api/unarchive_todo", json={"toDoId": todo_id})
    active = client.get("/api/get_todos")
    assert any(t["id"] == todo_id for t in active.json)


def test_delete_todo(auth_client):
    client, creds = auth_client
    r = client.post("/api/add_todo", json={"title": enc(creds, "Delete Me"), "content": "", "dateDue": ""})
    todo_id = r.json["id"]

    r2 = client.post("/api/delete_todo", json={"toDoId": todo_id})
    assert r2.json["success"] is True

    r3 = client.get("/api/get_todos")
    assert len(r3.json) == 0


# === Events API ===


def test_add_event(auth_client):
    client, creds = auth_client
    r = client.post(
        "/api/add_event",
        json={"title": enc(creds, "Meeting"), "content": enc(creds, "Team sync"), "dateOfEvent": "2026-04-15"},
    )
    assert r.json["success"] is True
    assert dec(creds, r.json["event"]["title"]) == "Meeting"


def test_get_events(auth_client):
    client, creds = auth_client
    client.post("/api/add_event", json={"title": enc(creds, "Event 1"), "content": "", "dateOfEvent": ""})
    client.post("/api/add_event", json={"title": enc(creds, "Event 2"), "content": "", "dateOfEvent": ""})

    r = client.get("/api/get_events")
    assert r.status_code == 200
    assert len(r.json) == 2


def test_get_single_event(auth_client):
    client, creds = auth_client
    r = client.post("/api/add_event", json={"title": enc(creds, "Single Event"), "content": "", "dateOfEvent": ""})
    event_id = r.json["id"]

    r2 = client.get(f"/api/get_event/{event_id}")
    assert r2.json["success"] is True
    assert dec(creds, r2.json["event"]["title"]) == "Single Event"


def test_edit_event(auth_client):
    client, creds = auth_client
    r = client.post("/api/add_event", json={"title": enc(creds, "Original"), "content": "", "dateOfEvent": ""})
    event_id = r.json["id"]

    r2 = client.post(
        "/api/edit_event",
        json={"eventId": event_id, "title": enc(creds, "Updated"), "content": enc(creds, "New"), "dateOfEvent": "2026-05-01"},
    )
    assert r2.json["success"] is True
    assert dec(creds, r2.json["event"]["title"]) == "Updated"


def test_delete_event(auth_client):
    client, creds = auth_client
    r = client.post("/api/add_event", json={"title": enc(creds, "Delete Me"), "content": "", "dateOfEvent": ""})
    event_id = r.json["id"]

    r2 = client.post("/api/delete_event", json={"eventId": event_id})
    assert r2.json["success"] is True

    r3 = client.get("/api/get_events")
    assert len(r3.json) == 0


# === Timezone / UTC round-trip ===
#
# Semantics: the client sends wall-clock components (what the user picked in
# the UI) with NO timezone suffix. The server interprets them in the user's
# configured timezone (UserSettings.timezone, default UTC), converts to a
# naive UTC instant, and stores. Responses emit stored instants as UTC-with-Z
# so the client can parse them unambiguously. Display accessors
# (formatted_due_time / formatted_event_time) convert UTC back to the user's
# configured tz for rendering.


def test_add_todo_wall_clock_stored_as_utc(auth_client):
    """A bare wall-clock dateDue is interpreted in the user's tz (UTC by default)
    and echoed back as UTC-with-Z."""
    client, creds = auth_client
    r = client.post(
        "/api/add_todo",
        json={"title": enc(creds, "Due todo"), "content": "", "dateDue": "2026-07-23T19:00"},
    )
    assert r.json["success"] is True
    assert r.json["todo"]["date_due"] == "2026-07-23T19:00:00Z"


def test_add_event_wall_clock_stored_as_utc(auth_client):
    """A bare wall-clock dateOfEvent is interpreted in the user's tz and echoed
    back as UTC-with-Z."""
    client, creds = auth_client
    r = client.post(
        "/api/add_event",
        json={"title": enc(creds, "Meeting"), "content": "", "dateOfEvent": "2026-07-23T19:00"},
    )
    assert r.json["success"] is True
    assert r.json["event"]["date_of_event"] == "2026-07-23T19:00:00Z"


def test_edit_todo_preserves_wall_clock_utc(auth_client):
    """Editing a todo does not shift its stored UTC instant for a UTC user."""
    client, creds = auth_client
    r = client.post(
        "/api/add_todo",
        json={"title": enc(creds, "Original"), "content": "", "dateDue": "2026-07-23T19:00"},
    )
    todo_id = r.json["id"]
    assert r.json["todo"]["date_due"] == "2026-07-23T19:00:00Z"

    r2 = client.post(
        "/api/edit_todo",
        json={"toDoId": todo_id, "title": enc(creds, "Updated"), "content": "", "dateDue": "2026-07-23T19:00"},
    )
    assert r2.json["success"] is True
    assert r2.json["todo"]["date_due"] == "2026-07-23T19:00:00Z"


def test_get_todos_returns_utc_z_dates(auth_client):
    """The list endpoint emits date_due as UTC-with-Z, not bare naive ISO."""
    client, creds = auth_client
    client.post(
        "/api/add_todo",
        json={"title": enc(creds, "Listed"), "content": "", "dateDue": "2026-08-01T08:30"},
    )
    r = client.get("/api/get_todos")
    assert r.status_code == 200
    matched = [t for t in r.json if t.get("date_due")]
    assert len(matched) == 1
    assert matched[0]["date_due"] == "2026-08-01T08:30:00Z"


def test_get_events_returns_utc_z_dates(auth_client):
    """The events list endpoint emits date_of_event as UTC-with-Z."""
    client, creds = auth_client
    client.post(
        "/api/add_event",
        json={"title": enc(creds, "Listed Event"), "content": "", "dateOfEvent": "2026-08-01T08:30"},
    )
    r = client.get("/api/get_events")
    assert r.status_code == 200
    matched = [e for e in r.json if e.get("date_of_event")]
    assert len(matched) == 1
    assert matched[0]["date_of_event"] == "2026-08-01T08:30:00Z"


def test_wall_clock_interpreted_in_user_timezone(auth_client):
    """A wall-clock dateDue is interpreted in the user's *configured* timezone,
    not the server's. For a New York user (UTC-4 in July), 19:00 wall-clock
    → 23:00 UTC."""
    from flasky.models import User
    from flasky.services.settings import set_timezone

    client, creds = auth_client
    user = User.query.filter_by(username="testuser").first()
    set_timezone(user, "America/New_York")

    r = client.post(
        "/api/add_todo",
        json={"title": enc(creds, "TZ todo"), "content": "", "dateDue": "2026-07-23T19:00"},
    )
    assert r.json["success"] is True
    # 19:00 EDT = 23:00 UTC
    assert r.json["todo"]["date_due"] == "2026-07-23T23:00:00Z"
    # Display accessor converts back to the user's tz: 19:00 → "7:00 PM"
    assert r.json["todo"]["formatted_due_time"] == "7:00 PM"


def test_wall_clock_event_interpreted_in_user_timezone(auth_client):
    """A wall-clock dateOfEvent is interpreted in the user's configured tz; the
    display accessor renders it back in that tz."""
    from flasky.models import User
    from flasky.services.settings import set_timezone

    client, creds = auth_client
    user = User.query.filter_by(username="testuser").first()
    set_timezone(user, "America/New_York")

    # 00:00 wall-clock EDT = 04:00 UTC; display → "12:00 AM"
    r = client.post(
        "/api/add_event",
        json={"title": enc(creds, "TZ event"), "content": "", "dateOfEvent": "2026-07-23T00:00"},
    )
    assert r.json["success"] is True
    assert r.json["event"]["date_of_event"] == "2026-07-23T04:00:00Z"
    assert r.json["event"]["formatted_event_time"] == "12:00 AM"


def test_date_only_interpreted_as_midnight_in_user_timezone(auth_client):
    """A bare YYYY-MM-DD is midnight in the user's configured tz, not UTC, so a
    New York user's 2026-07-23 → 2026-07-23T04:00:00Z."""
    from flasky.models import User
    from flasky.services.settings import set_timezone

    client, creds = auth_client
    user = User.query.filter_by(username="testuser").first()
    set_timezone(user, "America/New_York")

    r = client.post(
        "/api/add_todo",
        json={"title": enc(creds, "Date only"), "content": "", "dateDue": "2026-07-23"},
    )
    assert r.json["success"] is True
    assert r.json["todo"]["date_due"] == "2026-07-23T04:00:00Z"


def test_explicit_tz_input_is_normalized_to_utc(auth_client):
    """A full ISO string with an explicit offset is normalized to UTC regardless
    of the user's configured tz (the offset is authoritative)."""
    from flasky.models import User
    from flasky.services.settings import set_timezone

    client, creds = auth_client
    user = User.query.filter_by(username="testuser").first()
    set_timezone(user, "America/New_York")

    # 19:00 UTC+05:30 = 13:30 UTC, independent of configured tz
    r = client.post(
        "/api/add_todo",
        json={"title": enc(creds, "Offset"), "content": "", "dateDue": "2026-07-23T19:00:00+05:30"},
    )
    assert r.json["success"] is True
    assert r.json["todo"]["date_due"] == "2026-07-23T13:30:00Z"


def test_naive_iso_with_seconds_interpreted_in_user_timezone(auth_client):
    """A naive ISO string with seconds (no tz suffix) is interpreted in the
    user's configured tz, not silently dropped. Guards against a regression
    where fromisoformat succeeded but the strptime fallback loop didn't match."""
    from flasky.models import User
    from flasky.services.settings import set_timezone

    client, creds = auth_client
    user = User.query.filter_by(username="testuser").first()
    set_timezone(user, "America/New_York")

    r = client.post(
        "/api/add_todo",
        json={"title": enc(creds, "Seconds"), "content": "", "dateDue": "2026-07-23T19:00:00"},
    )
    assert r.json["success"] is True
    # 19:00 EDT = 23:00 UTC
    assert r.json["todo"]["date_due"] == "2026-07-23T23:00:00Z"


# === UI state API ===


def test_save_dark_mode(auth_client):
    client, creds = auth_client
    r = client.get("/api/save_dark_mode/1")
    assert r.json["success"] is True
    assert r.json["new_dark_mode_setting"] is True


def test_save_compact_mode(auth_client):
    client, creds = auth_client
    r = client.get("/api/save_compact_mode/1")
    assert r.json["success"] is True
    assert r.json["new_compact_mode_setting"] is True
    r = client.get("/api/save_compact_mode/0")
    assert r.json["success"] is True
    assert r.json["new_compact_mode_setting"] is False


def test_save_spotlight_mode(auth_client):
    client, creds = auth_client
    r = client.get("/api/save_spotlight_mode/1")
    assert r.json["success"] is True
    assert r.json["new_spotlight_mode_setting"] is True
    r = client.get("/api/save_spotlight_mode/0")
    assert r.json["success"] is True
    assert r.json["new_spotlight_mode_setting"] is False


def test_save_font_size(auth_client):
    client, creds = auth_client
    r = client.get("/api/save_font_size/20")
    assert r.json["success"] is True
    assert r.json["font_size"] == 20


# === Validation (marshmallow) ===


def test_save_note_missing_required_field_returns_422(auth_client):
    """flask-smorest validation should reject a missing required noteId."""
    client, creds = auth_client
    r = client.post("/api/save_note", json={"title": "x"})
    assert r.status_code == 422


# === Auth-required endpoints return failure when not logged in ===


def test_notes_api_requires_auth(client):
    r = client.get("/api/get_all_notes")
    assert r.status_code == 401


def test_todos_api_requires_auth(client):
    r = client.get("/api/get_todos")
    assert r.status_code == 401