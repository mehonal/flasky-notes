"""
Functional Integration Tests: Sync API (E2EE-aware).

The sync API uses Bearer token auth. With mandatory E2EE, all note content
is opaque ciphertext; the sync client encrypts/decrypts. These tests send
ciphertext (via tests/e2ee_helpers.enc) and verify round-trips by decrypting.
"""

import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from tests.e2ee_helpers import enc, dec


def _headers(token):
    return {"Authorization": f"Bearer {token}"}


def test_sync_manifest_empty(sync_client):
    client, token, user, creds = sync_client
    r = client.get("/api/sync/manifest", headers=_headers(token))
    assert r.status_code == 200
    assert r.json == []


def test_sync_create_note(sync_client):
    client, token, user, creds = sync_client
    r = client.post(
        "/api/sync/note",
        json={"title": enc(creds, "Sync Note"), "content": enc(creds, "Hello from sync"), "category": ""},
        headers=_headers(token),
    )
    assert r.status_code == 201
    assert dec(creds, r.json["title"]) == "Sync Note"
    assert "content_hash" in r.json
    assert r.json["encrypted"] is True


def test_sync_get_note(sync_client):
    client, token, user, creds = sync_client
    create_r = client.post(
        "/api/sync/note",
        json={"title": enc(creds, "Get Me"), "content": enc(creds, "Body"), "category": ""},
        headers=_headers(token),
    )
    note_id = create_r.json["id"]

    r = client.get(f"/api/sync/note/{note_id}", headers=_headers(token))
    assert r.status_code == 200
    assert dec(creds, r.json["title"]) == "Get Me"


def test_sync_update_note(sync_client):
    client, token, user, creds = sync_client
    create_r = client.post(
        "/api/sync/note",
        json={"title": enc(creds, "Update Me"), "content": enc(creds, "v1"), "category": ""},
        headers=_headers(token),
    )
    note_id = create_r.json["id"]

    r = client.put(
        f"/api/sync/note/{note_id}",
        json={"title": enc(creds, "Updated"), "content": enc(creds, "v2")},
        headers=_headers(token),
    )
    assert r.status_code == 200
    assert dec(creds, r.json["title"]) == "Updated"


def test_sync_delete_note(sync_client):
    client, token, user, creds = sync_client
    create_r = client.post(
        "/api/sync/note",
        json={"title": enc(creds, "Delete Me"), "content": "", "category": ""},
        headers=_headers(token),
    )
    note_id = create_r.json["id"]

    r = client.delete(f"/api/sync/note/{note_id}", headers=_headers(token))
    assert r.status_code == 200
    assert r.json["success"] is True

    manifest = client.get("/api/sync/manifest", headers=_headers(token))
    assert len(manifest.json) == 0


def test_sync_manifest_with_notes(sync_client):
    client, token, user, creds = sync_client
    for n in ("Note 1", "Note 2"):
        client.post(
            "/api/sync/note",
            json={"title": enc(creds, n), "content": enc(creds, f"Body for {n}"), "category": ""},
            headers=_headers(token),
        )

    r = client.get("/api/sync/manifest", headers=_headers(token))
    assert len(r.json) == 2
    assert all("content_hash" in note for note in r.json)
    assert all(note["encrypted"] is True for note in r.json)


def test_sync_get_nonexistent_note(sync_client):
    client, token, user, creds = sync_client
    r = client.get("/api/sync/note/9999", headers=_headers(token))
    assert r.status_code == 404


def test_sync_report_conflict(sync_client):
    client, token, user, creds = sync_client
    r = client.post(
        "/api/sync/conflict",
        json={
            "note_id": 1,
            "local_title": enc(creds, "Local Version"),
            "local_content": enc(creds, "Local body"),
            "server_title": enc(creds, "Server Version"),
            "server_content": enc(creds, "Server body"),
            "category": "",
        },
        headers=_headers(token),
    )
    assert r.status_code == 201
    assert "id" in r.json


def test_sync_list_conflicts(sync_client):
    client, token, user, creds = sync_client
    client.post(
        "/api/sync/conflict",
        json={
            "note_id": 1,
            "local_title": "L",
            "local_content": "LC",
            "server_title": "S",
            "server_content": "SC",
            "category": "",
        },
        headers=_headers(token),
    )

    r = client.get("/api/sync/conflicts", headers=_headers(token))
    assert r.status_code == 200
    assert len(r.json) == 1
    assert r.json[0]["resolved"] is False


def test_sync_resolve_link(sync_client):
    """With mandatory E2EE the client sends the encrypted title to resolve.
    The server does a case-insensitive byte-equal comparison.
    """
    import urllib.parse

    client, token, user, creds = sync_client
    enc_title = enc(creds, "My Page")
    client.post(
        "/api/sync/note",
        json={"title": enc_title, "content": enc(creds, "content"), "category": ""},
        headers=_headers(token),
    )

    r = client.get(
        f"/api/sync/resolve-link?title={urllib.parse.quote(enc_title)}",
        headers=_headers(token),
    )
    assert r.status_code == 200
    assert r.json["title"] == enc_title


def test_sync_resolve_link_not_found(sync_client):
    client, token, user, creds = sync_client
    r = client.get("/api/sync/resolve-link?title=nonexistent-ciphertext", headers=_headers(token))
    assert r.status_code == 404


def test_sync_attachment_manifest_empty(sync_client):
    client, token, user, creds = sync_client
    r = client.get("/api/sync/attachments", headers=_headers(token))
    assert r.status_code == 200
    assert r.json == []


def test_sync_encryption_info(sync_client):
    """The encryption_info endpoint returns the wrapped sym key for the sync
    client to unwrap. encryption_enabled is no longer in the response (always
    True implicitly).
    """
    client, token, user, creds = sync_client
    r = client.get("/api/sync/encryption_info", headers=_headers(token))
    assert r.status_code == 200
    assert "encrypted_sym_key" in r.json
    assert "encryption_version" in r.json
    # encryption_enabled is no longer in the response — encryption is mandatory
    assert "encryption_enabled" not in r.json


def test_sync_requires_auth(client):
    r = client.get("/api/sync/manifest")
    assert r.status_code == 401


def test_sync_invalid_token(client):
    r = client.get("/api/sync/manifest", headers={"Authorization": "Bearer invalid-token"})
    assert r.status_code == 401