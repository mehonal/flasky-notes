"""Tests for the optional AI Web Search feature (Ollama web tools consent).

Covers the per-conversation toggle endpoint, the return_json field, the
global-gate enforcement, Settings persistence of the gate, the ai_page
fragment flag, and the chat tool loop with mocked Ollama REST calls.
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
    set_setting(user, "ai_web_search_allowed", True)
    db.session.commit()


def _make_conv(user, **kwargs):
    from flasky import db
    from flasky.models import AiConversation
    conv = AiConversation(user_id=user.id, title="test", **kwargs)
    db.session.add(conv)
    db.session.commit()
    return conv


def test_web_search_endpoint_requires_ai_enabled(auth_client):
    client, _ = auth_client
    r = client.put("/ai/api/conversations/1/web_search", json={"enabled": True})
    assert r.status_code == 403


def test_web_search_endpoint_404_unknown_conversation(auth_client):
    client, _ = auth_client
    _enable_ai(auth_client)
    r = client.put("/ai/api/conversations/999999/web_search", json={"enabled": True})
    assert r.status_code == 404


def test_web_search_endpoint_rejects_enable_when_global_gate_off(auth_client):
    client, _ = auth_client
    u = _enable_ai(auth_client)
    conv = _make_conv(u)
    r = client.put(f"/ai/api/conversations/{conv.id}/web_search", json={"enabled": True})
    assert r.status_code == 403
    assert "not enabled" in r.json["error"].lower()


def test_web_search_endpoint_enables_when_global_gate_on(auth_client):
    client, _ = auth_client
    u = _enable_ai(auth_client)
    _enable_global_gate(u)
    conv = _make_conv(u)
    r = client.put(f"/ai/api/conversations/{conv.id}/web_search", json={"enabled": True})
    assert r.status_code == 200
    assert r.json["web_search_enabled"] is True


def test_web_search_endpoint_disable_works_without_global_gate(auth_client):
    client, _ = auth_client
    u = _enable_ai(auth_client)
    conv = _make_conv(u, web_search_enabled=True)
    r = client.put(f"/ai/api/conversations/{conv.id}/web_search", json={"enabled": False})
    assert r.status_code == 200
    assert r.json["web_search_enabled"] is False


def test_web_search_endpoint_rejects_other_users_conversation(auth_client):
    client, _ = auth_client
    u = _enable_ai(auth_client)
    _enable_global_gate(u)
    conv = _make_conv(u)
    conv.user_id = u.id + 999999
    from flasky import db
    db.session.commit()
    r = client.put(f"/ai/api/conversations/{conv.id}/web_search", json={"enabled": True})
    assert r.status_code == 404


def test_conversation_return_json_includes_web_search_field():
    from flasky.models import AiConversation
    conv = AiConversation(user_id=1, title="t", web_search_enabled=True)
    j = conv.return_json()
    assert j["web_search_enabled"] is True


def test_conversation_return_json_defaults_web_search_off():
    from flasky.models import AiConversation
    conv = AiConversation(user_id=1, title="t")
    j = conv.return_json()
    assert j["web_search_enabled"] is False


def test_settings_persist_global_gate(auth_client):
    client, _ = auth_client
    _enable_ai(auth_client)
    r = client.post("/settings", data={
        "update-ai-web-search-settings": "1",
        "ai-web-search-allowed": "1",
        "ai-web-search-max-rounds": "6",
        "ai-web-search-result-max-chars": "12000",
        "ai-web-search-timeout": "45",
    })
    assert r.status_code in (200, 302)
    from flasky.models import User
    from flasky.ui_settings import get_setting
    u = User.query.filter_by(username="testuser").first()
    assert get_setting(u, "ai_web_search_allowed") is True
    assert get_setting(u, "ai_web_search_max_rounds") == 6
    assert get_setting(u, "ai_web_search_result_max_chars") == 12000
    assert get_setting(u, "ai_web_search_timeout") == 45


def test_settings_reject_out_of_range_tunables(auth_client):
    client, _ = auth_client
    u = _enable_ai(auth_client)
    client.post("/settings", data={
        "update-ai-web-search-settings": "1",
        "ai-web-search-allowed": "1",
        "ai-web-search-max-rounds": "999",
        "ai-web-search-result-max-chars": "10",
        "ai-web-search-timeout": "1",
    })
    from flasky.ui_settings import get_setting
    assert get_setting(u, "ai_web_search_max_rounds") == 4
    assert get_setting(u, "ai_web_search_result_max_chars") == 8000
    assert get_setting(u, "ai_web_search_timeout") == 30


def test_settings_unset_global_gate(auth_client):
    client, _ = auth_client
    u = _enable_ai(auth_client)
    _enable_global_gate(u)
    client.post("/settings", data={"update-ai-web-search-settings": "1"})
    from flasky.ui_settings import get_setting
    assert get_setting(u, "ai_web_search_allowed") is False


def test_ai_page_fragment_passes_web_search_flag(auth_client):
    client, _ = auth_client
    u = _enable_ai(auth_client)
    _enable_global_gate(u)
    r = client.get("/ai?_fragment=1")
    assert r.status_code == 200
    body = r.data.decode()
    assert "aiWebSearchAllowed" in body


def test_agenda_fragment_passes_web_search_flag(auth_client):
    client, _ = auth_client
    u = _enable_ai(auth_client)
    _enable_global_gate(u)
    r = client.get("/agenda?_fragment=1")
    assert r.status_code == 200
    assert b"toggle-ai-web-search" in r.data


def test_agenda_fragment_hides_button_when_gate_off(auth_client):
    client, _ = auth_client
    _enable_ai(auth_client)
    r = client.get("/agenda?_fragment=1")
    assert r.status_code == 200
    assert b"toggle-ai-web-search" not in r.data


def _sse_events(resp):
    events = []
    for line in resp.data.decode().split("\n"):
        if line.startswith("data: "):
            import json as _json
            events.append(_json.loads(line[6:]))
    return events


def test_chat_tool_loop_searches_and_streams(monkeypatch, auth_client):
    client, _ = auth_client
    u = _enable_ai(auth_client)
    _enable_global_gate(u)
    conv = _make_conv(u, web_search_enabled=True)

    import flasky.blueprints.ai as ai_bp_mod

    call_states = {"round": 0}

    def fake_chat(**kwargs):
        call_states["round"] += 1
        assert "tools" in kwargs, "tools must be passed when web search is on"
        if call_states["round"] == 1:
            return iter([
                {"message": {"content": "", "tool_calls": [
                    {"function": {"name": "web_search", "arguments": {"query": "ollama news", "max_results": 3}}},
                ]}},
            ])
        return iter([
            {"message": {"content": "Here is "}},
            {"message": {"content": "the answer."}},
        ])

    class FakeClient:
        def chat(self, **kwargs):
            return fake_chat(**kwargs)

    monkeypatch.setattr(ai_bp_mod, "_get_ollama_client", lambda settings: FakeClient())

    def fake_requests_post(endpoint, headers=None, json=None, timeout=None):
        assert endpoint.endswith("/api/web_search")
        assert json["query"] == "ollama news"
        assert json["max_results"] == 3

        class R:
            def raise_for_status(self):
                pass

            def json(self):
                return {"results": [{"title": "Ollama", "url": "https://ollama.com", "content": "news"}]}

        return R()

    monkeypatch.setattr(ai_bp_mod.requests, "post", fake_requests_post)

    r = client.post(
        f"/ai/api/conversations/{conv.id}/chat",
        json={"message": "what's new with ollama?", "messages": [
            {"role": "user", "content": "what's new with ollama?"},
        ]},
    )
    assert r.status_code == 200
    events = _sse_events(r)
    tool_events = [e for e in events if "tool" in e]
    assert len(tool_events) == 1
    assert tool_events[0]["tool"] == "web_search"
    assert tool_events[0]["query"] == "ollama news"
    done = [e for e in events if e.get("done")]
    assert done, "expected a done event"
    assert done[0]["message_id"]
    text = "".join(e["chunk"] for e in events if "chunk" in e)
    assert text == "Here is the answer."

    from flasky.models import AiMessage
    stored = AiMessage.query.filter_by(conversation_id=conv.id, role="assistant").first()
    assert stored.content == "Here is the answer."


def test_chat_without_web_search_passes_no_tools(monkeypatch, auth_client):
    client, _ = auth_client
    u = _enable_ai(auth_client)
    conv = _make_conv(u)

    import flasky.blueprints.ai as ai_bp_mod

    class FakeClient:
        def chat(self, **kwargs):
            assert "tools" not in kwargs, "tools must not be passed when web search is off"
            return iter([{"message": {"content": "plain answer"}}])

    monkeypatch.setattr(ai_bp_mod, "_get_ollama_client", lambda settings: FakeClient())

    r = client.post(
        f"/ai/api/conversations/{conv.id}/chat",
        json={"message": "hi", "messages": [{"role": "user", "content": "hi"}]},
    )
    assert r.status_code == 200
    events = _sse_events(r)
    assert not [e for e in events if "tool" in e]
    assert "".join(e["chunk"] for e in events if "chunk" in e) == "plain answer"


def test_chat_tool_loop_survives_tool_failure(monkeypatch, auth_client):
    client, _ = auth_client
    u = _enable_ai(auth_client)
    _enable_global_gate(u)
    conv = _make_conv(u, web_search_enabled=True)

    import flasky.blueprints.ai as ai_bp_mod

    call_states = {"round": 0}

    class FakeClient:
        def chat(self, **kwargs):
            call_states["round"] += 1
            if call_states["round"] == 1:
                return iter([
                    {"message": {"content": "", "tool_calls": [
                        {"function": {"name": "web_fetch", "arguments": {"url": "https://x.test"}}},
                    ]}},
                ])
            return iter([{"message": {"content": "fallback."}}])

    monkeypatch.setattr(ai_bp_mod, "_get_ollama_client", lambda settings: FakeClient())

    def boom(*a, **kw):
        raise RuntimeError("network down")

    monkeypatch.setattr(ai_bp_mod.requests, "post", boom)

    r = client.post(
        f"/ai/api/conversations/{conv.id}/chat",
        json={"message": "fetch it", "messages": [{"role": "user", "content": "fetch it"}]},
    )
    assert r.status_code == 200
    events = _sse_events(r)
    assert [e for e in events if "tool" in e], "tool status event expected even if the call fails"
    assert "".join(e["chunk"] for e in events if "chunk" in e) == "fallback."


def test_chat_tool_loop_caps_rounds(monkeypatch, auth_client):
    client, _ = auth_client
    u = _enable_ai(auth_client)
    _enable_global_gate(u)
    from flasky.ui_settings import get_setting
    max_rounds = get_setting(u, "ai_web_search_max_rounds")
    conv = _make_conv(u, web_search_enabled=True)

    import flasky.blueprints.ai as ai_bp_mod

    class FakeClient:
        def __init__(self):
            self.calls = 0

        def chat(self, **kwargs):
            self.calls += 1
            return iter([
                {"message": {"content": "", "tool_calls": [
                    {"function": {"name": "web_search", "arguments": {"query": f"q{self.calls}"}}},
                ]}},
            ])

    fake = FakeClient()
    monkeypatch.setattr(ai_bp_mod, "_get_ollama_client", lambda settings: fake)

    def ok(*a, **kw):
        class R:
            def raise_for_status(self):
                pass

            def json(self):
                return {"results": []}

        return R()

    monkeypatch.setattr(ai_bp_mod.requests, "post", ok)

    r = client.post(
        f"/ai/api/conversations/{conv.id}/chat",
        json={"message": "keep searching", "messages": [{"role": "user", "content": "keep searching"}]},
    )
    assert r.status_code == 200
    _sse_events(r)
    assert fake.calls == max_rounds + 1


def test_chat_tool_loop_honors_custom_rounds(monkeypatch, auth_client):
    client, _ = auth_client
    u = _enable_ai(auth_client)
    _enable_global_gate(u)
    from flasky import db
    from flasky.ui_settings import set_setting
    set_setting(u, "ai_web_search_max_rounds", 1)
    db.session.commit()
    conv = _make_conv(u, web_search_enabled=True)

    import flasky.blueprints.ai as ai_bp_mod

    class FakeClient:
        def __init__(self):
            self.calls = 0

        def chat(self, **kwargs):
            self.calls += 1
            return iter([
                {"message": {"content": "", "tool_calls": [
                    {"function": {"name": "web_search", "arguments": {"query": f"q{self.calls}"}}},
                ]}},
            ])

    fake = FakeClient()
    monkeypatch.setattr(ai_bp_mod, "_get_ollama_client", lambda settings: fake)

    class R:
        def raise_for_status(self):
            pass

        def json(self):
            return {"results": []}

    monkeypatch.setattr(ai_bp_mod.requests, "post", lambda *a, **kw: R())

    r = client.post(
        f"/ai/api/conversations/{conv.id}/chat",
        json={"message": "keep searching", "messages": [{"role": "user", "content": "keep searching"}]},
    )
    assert r.status_code == 200
    _sse_events(r)
    assert fake.calls == 2