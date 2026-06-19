"""
Functional System Tests: Complete E2EE user flows.

Tests the full registration + login + note creation flow via the real
/api/auth/register and /api/auth/login endpoints with client-side key
derivation (using tests/e2ee_helpers, which mirrors the JS crypto).
"""

import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
import pytest
from tests.e2ee_helpers import make_e2ee_user, enc, dec, derive_keys


def test_full_e2ee_registration_and_login_flow(app_context):
    """A fresh user can register, log in, create an encrypted note, fetch it
    back, and decrypt it — end-to-end through the real auth + notes API.
    """
    client = app_context.test_client()
    creds = make_e2ee_user(client, "flowuser", "flowpassword123")

    # Create a note via the API (encrypted client-side)
    r = client.post(
        "/api/save_note",
        json={
            "noteId": 0,
            "title": enc(creds, "Flow Test Note"),
            "content": enc(creds, "Test content for flow"),
            "category": None,
        },
    )
    assert r.status_code == 200
    assert r.json["success"] is True
    note_id = r.json["note"]["id"]

    # Fetch the note back and decrypt
    fetch_r = client.get(f"/api/note/{note_id}")
    assert fetch_r.json["success"] is True
    assert dec(creds, fetch_r.json["note"]["title"]) == "Flow Test Note"
    assert dec(creds, fetch_r.json["note"]["content"]) == "Test content for flow"


def test_e2ee_login_with_wrong_password_fails(app_context):
    """Login with the wrong password (wrong auth_key) is rejected."""
    client = app_context.test_client()
    from tests.e2ee_helpers import register_e2ee_user

    creds = register_e2ee_user(client, "wrongpwuser", "correctpassword")
    # Derive auth_key from a DIFFERENT password
    wrong_auth_key, _ = derive_keys("wrongpassword", "wrongpwuser")
    r = client.post(
        "/api/auth/login",
        json={"username": "wrongpwuser", "auth_key": wrong_auth_key},
    )
    assert r.status_code == 401
    assert r.json["success"] is False


def test_e2ee_duplicate_username_rejected(app_context):
    client = app_context.test_client()
    make_e2ee_user(client, "dupuser", "duppassword123")
    # Second registration with same username should fail
    from tests.e2ee_helpers import register_e2ee_user
    with pytest.raises(RuntimeError):
        register_e2ee_user(client, "dupuser", "anotherpassword123")


def test_e2ee_user_can_access_protected_routes_after_login(app_context):
    client = app_context.test_client()
    creds = make_e2ee_user(client, "protecteduser", "protectedpass123")

    # Should be able to hit protected endpoints
    r = client.get("/api/get_all_notes")
    assert r.status_code == 200

    r = client.get("/settings")
    assert r.status_code == 200


def test_e2ee_unauthenticated_user_blocked(client):
    """Without logging in, protected routes return 401/302."""
    r = client.get("/api/get_all_notes")
    assert r.status_code == 401

    r = client.get("/notes", follow_redirects=False)
    assert r.status_code == 302  # redirect to /login


def test_e2ee_salt_endpoint_returns_salt_for_known_user(app_context):
    client = app_context.test_client()
    creds = make_e2ee_user(client, "saltuser", "saltpass123")

    r = client.get("/api/auth/salt?username=saltuser")
    assert r.status_code == 200
    assert r.json["key_salt"] is not None
    # The salt should match what was registered
    assert r.json["key_salt"] == creds["salt_hex"]


def test_e2ee_salt_endpoint_returns_fake_salt_for_unknown_user(client):
    """Unknown users get a deterministic fake salt to prevent enumeration."""
    r = client.get("/api/auth/salt?username=nonexistentuser")
    assert r.status_code == 200
    assert r.json["key_salt"] is not None  # fake salt, not None