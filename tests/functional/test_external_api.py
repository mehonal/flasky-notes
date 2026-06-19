"""
Functional Integration Tests: External API (E2EE-aware).

With mandatory E2EE the external API requires `auth_key` (the PBKDF2-derived
hex string), not a raw password. The server never sees the user's password.
Callers must derive the auth_key the same way the login flow does — see
tests/e2ee_helpers.derive_keys for a Python reference. Note content
is opaque ciphertext; the caller encrypts/decrypts.
"""

import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from tests.e2ee_helpers import register_e2ee_user, enc, dec


USERNAME = "extuser"
PASSWORD = "extpassword123"


def _setup(app_context):
    """Register an E2EE user and return (client, creds)."""
    client = app_context.test_client()
    creds = register_e2ee_user(client, USERNAME, PASSWORD)
    return client, creds


def test_external_get_notes_empty(app_context):
    client, creds = _setup(app_context)
    r = client.post(
        "/api/external/get-notes",
        json={"username": USERNAME, "auth_key": creds["auth_key"]},
    )
    assert r.status_code == 200
    assert r.json == []


def test_external_add_note(app_context):
    client, creds = _setup(app_context)
    r = client.post(
        "/api/external/add-note",
        json={
            "username": USERNAME,
            "auth_key": creds["auth_key"],
            "title": enc(creds, "External Note"),
            "content": enc(creds, "Created via API"),
            "category": "",
        },
    )
    assert r.json["success"] is True
    assert dec(creds, r.json["note"]["title"]) == "External Note"


def test_external_get_notes_after_add(app_context):
    client, creds = _setup(app_context)
    for n in ("Note 1", "Note 2"):
        client.post(
            "/api/external/add-note",
            json={
                "username": USERNAME,
                "auth_key": creds["auth_key"],
                "title": enc(creds, n),
                "content": enc(creds, "Body"),
                "category": "",
            },
        )

    r = client.post(
        "/api/external/get-notes",
        json={"username": USERNAME, "auth_key": creds["auth_key"]},
    )
    assert len(r.json) == 2


def test_external_get_notes_with_limit(app_context):
    client, creds = _setup(app_context)
    for i in range(5):
        client.post(
            "/api/external/add-note",
            json={
                "username": USERNAME,
                "auth_key": creds["auth_key"],
                "title": enc(creds, f"Note {i}"),
                "content": "",
                "category": "",
            },
        )

    r = client.post(
        "/api/external/get-notes",
        json={"username": USERNAME, "auth_key": creds["auth_key"], "limit": 2},
    )
    assert len(r.json) == 2


def test_external_get_single_note(app_context):
    client, creds = _setup(app_context)
    add_r = client.post(
        "/api/external/add-note",
        json={
            "username": USERNAME,
            "auth_key": creds["auth_key"],
            "title": enc(creds, "Single"),
            "content": enc(creds, "Body"),
            "category": "",
        },
    )
    note_id = add_r.json["note"]["id"]

    r = client.post(
        "/api/external/get-note",
        json={"username": USERNAME, "auth_key": creds["auth_key"], "note-id": note_id},
    )
    assert r.json["success"] is True
    assert dec(creds, r.json["note"]["title"]) == "Single"


def test_external_edit_note(app_context):
    client, creds = _setup(app_context)
    add_r = client.post(
        "/api/external/add-note",
        json={
            "username": USERNAME,
            "auth_key": creds["auth_key"],
            "title": enc(creds, "Original"),
            "content": enc(creds, "v1"),
            "category": "",
        },
    )
    note_id = add_r.json["note"]["id"]

    r = client.post(
        "/api/external/edit-note",
        json={
            "username": USERNAME,
            "auth_key": creds["auth_key"],
            "note-id": note_id,
            "title": enc(creds, "Updated"),
            "content": enc(creds, "v2"),
        },
    )
    assert r.json["success"] is True
    assert dec(creds, r.json["note"]["title"]) == "Updated"


def test_external_wrong_auth_key(app_context):
    client, creds = _setup(app_context)
    r = client.post(
        "/api/external/get-notes",
        json={"username": USERNAME, "auth_key": "0" * 64},
    )
    assert r.json["success"] is False
    assert "invalid credentials" in r.json["reason"].lower()


def test_external_nonexistent_user(client):
    r = client.post(
        "/api/external/get-notes",
        json={"username": "nobody", "auth_key": "0" * 64},
    )
    assert r.json["success"] is False
    assert "invalid credentials" in r.json["reason"].lower()


def test_external_get_nonexistent_note(app_context):
    client, creds = _setup(app_context)
    r = client.post(
        "/api/external/get-note",
        json={"username": USERNAME, "auth_key": creds["auth_key"], "note-id": 9999},
    )
    assert r.json["success"] is False


def test_external_rejects_legacy_password_field(app_context):
    """With mandatory E2EE, sending `password` instead of `auth_key` fails."""
    client, creds = _setup(app_context)
    r = client.post(
        "/api/external/get-notes",
        json={"username": USERNAME, "password": PASSWORD},
    )
    assert r.json["success"] is False