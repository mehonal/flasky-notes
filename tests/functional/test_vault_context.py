"""Tests for the optional Vault Context feature (client-side RAG consent).

Covers the per-conversation toggle endpoint, the return_json field, the
global-gate enforcement, and Settings persistence of the gate + tunables.
Client-side retrieval (FlaskySearch) has no JS test harness and is verified
manually.
"""
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


def _enable_ai(auth_client):
    from flasky import db
    from flasky.models import User
    u = User.query.filter_by(username="testuser").first()
    u.settings.ai_enabled = True
    u.settings.ollama_api_key = "fake-key"
    db.session.commit()
    return u


def _enable_global_gate(user):
    from flasky import db
    from flasky.ui_settings import set_setting
    set_setting(user, "vault_context_allowed", True)
    db.session.commit()


def test_vault_context_endpoint_requires_ai_enabled(auth_client):
    client, _ = auth_client
    r = client.put("/ai/api/conversations/1/vault_context", json={"enabled": True})
    assert r.status_code == 403


def test_vault_context_endpoint_404_unknown_conversation(auth_client):
    client, _ = auth_client
    _enable_ai(auth_client)
    r = client.put("/ai/api/conversations/999999/vault_context", json={"enabled": True})
    assert r.status_code == 404


def test_vault_context_endpoint_rejects_enable_when_global_gate_off(auth_client):
    client, _ = auth_client
    u = _enable_ai(auth_client)
    from flasky import db
    from flasky.models import AiConversation
    conv = AiConversation(user_id=u.id, title="test")
    db.session.add(conv)
    db.session.commit()
    r = client.put(f"/ai/api/conversations/{conv.id}/vault_context", json={"enabled": True})
    assert r.status_code == 403
    assert "not enabled" in r.json["error"].lower()


def test_vault_context_endpoint_enables_when_global_gate_on(auth_client):
    client, _ = auth_client
    u = _enable_ai(auth_client)
    _enable_global_gate(u)
    from flasky import db
    from flasky.models import AiConversation
    conv = AiConversation(user_id=u.id, title="test")
    db.session.add(conv)
    db.session.commit()
    r = client.put(f"/ai/api/conversations/{conv.id}/vault_context", json={"enabled": True})
    assert r.status_code == 200
    assert r.json["vault_context_enabled"] is True


def test_vault_context_endpoint_disable_works_without_global_gate(auth_client):
    client, _ = auth_client
    u = _enable_ai(auth_client)
    from flasky import db
    from flasky.models import AiConversation
    conv = AiConversation(user_id=u.id, title="test", vault_context_enabled=True)
    db.session.add(conv)
    db.session.commit()
    r = client.put(f"/ai/api/conversations/{conv.id}/vault_context", json={"enabled": False})
    assert r.status_code == 200
    assert r.json["vault_context_enabled"] is False


def test_vault_context_endpoint_rejects_other_users_conversation(auth_client):
    client, _ = auth_client
    u = _enable_ai(auth_client)
    _enable_global_gate(u)
    from flasky import db
    from flasky.models import AiConversation
    # A conversation owned by a different user_id; the endpoint filters by
    # g.user.id so this is simply not found -> 404.
    other_conv = AiConversation(user_id=u.id + 999999, title="other")
    db.session.add(other_conv)
    db.session.commit()
    r = client.put(f"/ai/api/conversations/{other_conv.id}/vault_context", json={"enabled": True})
    assert r.status_code == 404


def test_conversation_return_json_includes_vault_context_field(auth_client):
    from flasky.models import AiConversation
    conv = AiConversation(user_id=1, title="t", vault_context_enabled=True)
    j = conv.return_json()
    assert j["vault_context_enabled"] is True


def test_conversation_return_json_defaults_vault_context_off():
    from flasky.models import AiConversation
    conv = AiConversation(user_id=1, title="t")
    j = conv.return_json()
    assert j["vault_context_enabled"] is False


def test_settings_persist_global_gate_and_tunables(auth_client):
    client, _ = auth_client
    _enable_ai(auth_client)
    r = client.post("/settings", data={
        "update-vault-context-settings": "1",
        "vault-context-allowed": "1",
        "vault-context-top-k": "12",
        "vault-context-max-chars": "30000",
    })
    assert r.status_code in (200, 302)
    from flasky.models import User
    from flasky.ui_settings import get_setting
    u = User.query.filter_by(username="testuser").first()
    assert get_setting(u, "vault_context_allowed") is True
    assert get_setting(u, "ai_vault_context_top_k") == 12
    assert get_setting(u, "ai_vault_context_max_chars") == 30000


def test_settings_rejects_out_of_range_tunables(auth_client):
    client, _ = auth_client
    _enable_ai(auth_client)
    client.post("/settings", data={
        "update-vault-context-settings": "1",
        "vault-context-allowed": "1",
        "vault-context-top-k": "999",
        "vault-context-max-chars": "50",
    })
    from flasky.models import User
    from flasky.ui_settings import get_setting
    u = User.query.filter_by(username="testuser").first()
    # set_setting returns False for invalid values; the view still commits
    # but the stored value is unchanged from the registry default.
    assert get_setting(u, "ai_vault_context_top_k") == 8
    assert get_setting(u, "ai_vault_context_max_chars") == 20000


def test_ai_page_passes_vault_context_fields(auth_client):
    client, _ = auth_client
    _enable_ai(auth_client)
    r = client.get("/ai?_fragment=1")
    assert r.status_code == 200
    body = r.data.decode()
    assert "vaultContextAllowed" in body
    assert "vaultContextTopK" in body
    assert "vaultContextMaxChars" in body
