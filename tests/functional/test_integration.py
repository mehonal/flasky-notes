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


def test_load_notes_pagination(auth_client):
    client, creds = auth_client
    for i in range(7):
        client.post(
            "/api/save_note",
            json={"noteId": 0, "title": enc(creds, f"Note {i}"), "content": enc(creds, "Body"), "category": None},
        )

    page1 = client.post("/api/load_notes", json={"page": 1})
    assert len(page1.json) == 5

    page2 = client.post("/api/load_notes", json={"page": 2})
    assert len(page2.json) == 2


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

    # Note should still be accessible (moved to main category)
    note_check = client.get(f"/note/{note_id}")
    assert note_check.status_code == 200


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


def test_cannot_delete_main_category(auth_client):
    client, creds = auth_client
    from flasky.models import User
    from flasky.services.categories import get_or_create_main_category

    user = User.query.filter_by(username="testuser").first()
    main = get_or_create_main_category(user)

    r = client.post("/api/delete_category", json={"categoryId": main.id})
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


def test_save_notes_row_count(auth_client):
    client, creds = auth_client
    r = client.get("/api/save_notes_row_count/5")
    assert r.json["success"] is True
    assert r.json["new_row_count"] == 5


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