"""Tests for AI Research Mode (client-driven research loop).

Covers the ai_research_allowed global gate, request validation, the
stateless SSE round protocol (chunk / tool / round_done events), tool
execution with mocked Ollama REST calls, the finish flag, and that
nothing is persisted server-side.
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


def _enable_research(user):
    from flasky import db
    from flasky.ui_settings import set_setting
    set_setting(user, "ai_research_allowed", True)
    db.session.commit()


def _sse_events(resp):
    events = []
    for line in resp.data.decode().split("\n"):
        if line.startswith("data: "):
            import json as _json
            events.append(_json.loads(line[6:]))
    return events


def test_research_round_requires_ai_enabled(auth_client):
    client, _ = auth_client
    r = client.post("/ai/api/research/round", json={"messages": [{"role": "user", "content": "topic"}]})
    assert r.status_code == 403


def test_research_round_rejects_gate_off(auth_client):
    client, _ = auth_client
    _enable_ai(auth_client)
    r = client.post("/ai/api/research/round", json={"messages": [{"role": "user", "content": "topic"}]})
    assert r.status_code == 403
    assert "not enabled" in r.json["error"].lower()


def test_research_round_rejects_missing_messages(auth_client):
    client, _ = auth_client
    u = _enable_ai(auth_client)
    _enable_research(u)
    r = client.post("/ai/api/research/round", json={})
    assert r.status_code == 400
    r = client.post("/ai/api/research/round", json={"messages": []})
    assert r.status_code == 400


def test_research_round_rejects_invalid_messages(auth_client):
    client, _ = auth_client
    u = _enable_ai(auth_client)
    _enable_research(u)
    r = client.post("/ai/api/research/round", json={"messages": [{"role": "system", "content": "nope"}]})
    assert r.status_code == 400
    r = client.post("/ai/api/research/round", json={"messages": [{"role": "user", "content": 42}]})
    assert r.status_code == 400


def test_research_round_requires_api_key(auth_client):
    client, _ = auth_client
    from flasky import db
    u = _enable_ai(auth_client)
    u.settings.ollama_api_key = None
    db.session.commit()
    _enable_research(u)
    r = client.post("/ai/api/research/round", json={"messages": [{"role": "user", "content": "topic"}]})
    assert r.status_code == 400


def test_research_to_conversation(auth_client):
    client, _ = auth_client
    _enable_ai(auth_client)
    from flasky.models import AiConversation, AiMessage
    r = client.post("/ai/api/research/conversation", json={
        "title": "Maduro research",
        "messages": [
            {"role": "user", "content": "Research topic: who is Maduro"},
            {"role": "assistant", "content": "Findings about Maduro."},
            {"role": "user", "content": "Follow-up: his cabinet"},
            {"role": "assistant", "content": "Cabinet details."},
        ],
    })
    assert r.status_code == 200
    conv_id = r.json["id"]
    conv = AiConversation.query.get(conv_id)
    assert conv is not None and conv.user_id is not None
    msgs = AiMessage.query.filter_by(conversation_id=conv_id).order_by(AiMessage.created_at.asc()).all()
    assert [m.role for m in msgs] == ["user", "assistant", "user", "assistant"]
    assert msgs[0].content == "Research topic: who is Maduro"
    assert msgs[3].content == "Cabinet details."


def test_research_to_conversation_rejects_tool_messages(auth_client):
    client, _ = auth_client
    _enable_ai(auth_client)
    r = client.post("/ai/api/research/conversation", json={
        "title": "x",
        "messages": [
            {"role": "user", "content": "topic"},
            {"role": "tool", "content": '{"results": []}', "tool_name": "web_search"},
        ],
    })
    assert r.status_code == 400
    r = client.post("/ai/api/research/conversation", json={"title": "x", "messages": []})
    assert r.status_code == 400
    r = client.post("/ai/api/research/conversation", json={
        "title": "x", "messages": [{"role": "user", "content": "   "}],
    })
    assert r.status_code == 400


def test_research_to_conversation_requires_ai_enabled(auth_client):
    client, _ = auth_client
    r = client.post("/ai/api/research/conversation", json={
        "title": "x", "messages": [{"role": "user", "content": "topic"}],
    })
    assert r.status_code == 403


def _install_fake_client(monkeypatch, responses):
    """responses: list of iterables of stream parts, one per model call."""
    import flasky.blueprints.ai as ai_bp_mod

    state = {"call": 0}

    def fake_chat(**kwargs):
        i = min(state["call"], len(responses) - 1)
        state["call"] += 1
        return iter(responses[i])

    class FakeClient:
        def chat(self, **kwargs):
            return fake_chat(**kwargs)

    monkeypatch.setattr(ai_bp_mod, "_get_ollama_client", lambda settings: FakeClient())
    return state


def test_research_round_tool_then_final(monkeypatch, auth_client):
    client, _ = auth_client
    u = _enable_ai(auth_client)
    _enable_research(u)

    import flasky.blueprints.ai as ai_bp_mod

    _install_fake_client(monkeypatch, [
        [{"message": {"content": "", "tool_calls": [
            {"function": {"name": "web_search", "arguments": {"query": "flask notes"}}},
        ]}}],
        [{"message": {"content": "Final "}}, {"message": {"content": "answer."}}],
    ])

    def fake_requests_post(endpoint, headers=None, json=None, timeout=None):
        assert endpoint.endswith("/api/web_search")
        assert json["query"] == "flask notes"

        class R:
            def raise_for_status(self):
                pass

            def json(self):
                return {"results": [{"title": "Flasky", "url": "https://example.com", "content": "notes"}]}

        return R()

    monkeypatch.setattr(ai_bp_mod.requests, "post", fake_requests_post)

    r = client.post("/ai/api/research/round", json={"messages": [
        {"role": "user", "content": "Research this topic thoroughly: flask notes"},
    ]})
    assert r.status_code == 200
    events = _sse_events(r)
    assert "error" not in events[-1]

    tool_events = [e for e in events if "tool" in e and "tool_calls" not in e and not e.get("tool_result")]
    assert len(tool_events) == 1
    assert tool_events[0]["tool"] == "web_search"
    assert tool_events[0]["query"] == "flask notes"

    tool_call_events = [e for e in events if "tool_calls" in e]
    assert len(tool_call_events) == 1
    assert tool_call_events[0]["tool_calls"][0]["function"]["name"] == "web_search"

    tool_result_events = [e for e in events if e.get("tool_result")]
    assert len(tool_result_events) == 1
    assert tool_result_events[0]["name"] == "web_search"
    assert "flask notes" in tool_result_events[0]["content"] or tool_result_events[0]["content"]

    text = "".join(e["chunk"] for e in events if "chunk" in e)
    assert text == "Final answer."

    done = [e for e in events if e.get("round_done")]
    assert done
    assert done[0]["final"] is True
    assert done[0]["content"] == "Final answer."
    assert done[0]["last_text"] == "Final answer."

    from flasky.models import AiMessage, AiConversation
    assert AiMessage.query.count() == 0
    assert AiConversation.query.count() == 0


def test_research_round_reports_not_final_when_tool_calls_remain(monkeypatch, auth_client):
    client, _ = auth_client
    u = _enable_ai(auth_client)
    _enable_research(u)

    import flasky.blueprints.ai as ai_bp_mod
    from flasky.ui_settings import get_setting, set_setting
    from flasky import db
    set_setting(u, "ai_research_max_rounds", 1)
    db.session.commit()
    assert get_setting(u, "ai_research_max_rounds") == 1

    _install_fake_client(monkeypatch, [
        [{"message": {"content": "still searching...", "tool_calls": [
            {"function": {"name": "web_search", "arguments": {"query": "q1"}}},
        ]}}],
        [{"message": {"content": "", "tool_calls": [
            {"function": {"name": "web_search", "arguments": {"query": "q2"}}},
        ]}}],
    ])

    monkeypatch.setattr(
        ai_bp_mod.requests, "post",
        lambda endpoint, headers=None, json=None, timeout=None: type("R", (), {
            "raise_for_status": lambda self: None,
            "json": lambda self: {"results": []},
        })(),
    )

    r = client.post("/ai/api/research/round", json={"messages": [
        {"role": "user", "content": "Research this topic thoroughly: something"},
    ]})
    assert r.status_code == 200
    events = _sse_events(r)
    done = [e for e in events if e.get("round_done")]
    assert done
    assert done[0]["final"] is False


def test_research_round_finish_skips_tools(monkeypatch, auth_client):
    client, _ = auth_client
    u = _enable_ai(auth_client)
    _enable_research(u)

    seen_kwargs = {}

    import flasky.blueprints.ai as ai_bp_mod

    class FakeClient:
        def chat(self, **kwargs):
            seen_kwargs.update(kwargs)
            return iter([{"message": {"content": "The wrap-up answer."}}])

    monkeypatch.setattr(ai_bp_mod, "_get_ollama_client", lambda settings: FakeClient())

    r = client.post("/ai/api/research/round", json={
        "messages": [{"role": "user", "content": "Research this topic thoroughly: x"}],
        "finish": True,
    })
    assert r.status_code == 200
    events = _sse_events(r)
    assert "tools" not in seen_kwargs, "finish round must not pass tools"
    done = [e for e in events if e.get("round_done")]
    assert done
    assert done[0]["content"] == "The wrap-up answer."
    assert done[0]["final"] is True


def test_research_round_prepends_system_prompt(monkeypatch, auth_client):
    client, _ = auth_client
    u = _enable_ai(auth_client)
    _enable_research(u)

    import flasky.blueprints.ai as ai_bp_mod

    seen_messages = []

    class FakeClient:
        def chat(self, **kwargs):
            seen_messages.append(kwargs["messages"])
            return iter([{"message": {"content": "done"}}])

    monkeypatch.setattr(ai_bp_mod, "_get_ollama_client", lambda settings: FakeClient())

    r = client.post("/ai/api/research/round", json={"messages": [
        {"role": "user", "content": "topic"},
    ]})
    assert r.status_code == 200
    msgs = seen_messages[0]
    assert msgs[0]["role"] == "system"
    assert "research agent" in msgs[0]["content"].lower()
    assert msgs[1]["role"] == "user"
    assert msgs[1]["content"] == "topic"


def test_research_round_tool_failure_degrades_gracefully(monkeypatch, auth_client):
    client, _ = auth_client
    u = _enable_ai(auth_client)
    _enable_research(u)

    import flasky.blueprints.ai as ai_bp_mod

    _install_fake_client(monkeypatch, [
        [{"message": {"content": "", "tool_calls": [
            {"function": {"name": "web_search", "arguments": {"query": "boom"}}},
        ]}}],
        [{"message": {"content": "Recovered."}}],
    ])

    def boom(endpoint, headers=None, json=None, timeout=None):
        raise Exception("network down")

    monkeypatch.setattr(ai_bp_mod.requests, "post", boom)

    r = client.post("/ai/api/research/round", json={"messages": [
        {"role": "user", "content": "Research this topic thoroughly: x"},
    ]})
    assert r.status_code == 200
    events = _sse_events(r)
    done = [e for e in events if e.get("round_done")]
    assert done
    assert done[0]["content"] == "Recovered."


def test_research_round_error_preserves_partial_content(monkeypatch, auth_client):
    client, _ = auth_client
    u = _enable_ai(auth_client)
    _enable_research(u)

    import flasky.blueprints.ai as ai_bp_mod

    class ExplodingClient:
        def chat(self, **kwargs):
            return iter([
                {"message": {"content": "Partial finding: the topic is about "}},
                {"message": {"content": "encrypted notes."}},
            ])

    def boom_after_stream(it):
        def gen():
            for x in it:
                yield x
            raise Exception("stream exploded")
        return gen()

    class FakeClient:
        def chat(self, **kwargs):
            return boom_after_stream([
                {"message": {"content": "Partial finding: the topic is about "}},
                {"message": {"content": "encrypted notes."}},
            ])

    monkeypatch.setattr(ai_bp_mod, "_get_ollama_client", lambda settings: FakeClient())

    r = client.post("/ai/api/research/round", json={"messages": [
        {"role": "user", "content": "Research this topic thoroughly: x"},
    ]})
    assert r.status_code == 200
    events = _sse_events(r)
    errors = [e for e in events if "error" in e]
    assert errors, "expected an error event"
    assert errors[0]["content"] == "Partial finding: the topic is about encrypted notes."


def test_research_round_serializes_pydantic_like_tool_calls(monkeypatch, auth_client):
    """The ollama SDK returns pydantic ToolCall objects, not dicts; the
    tool_calls SSE event must still serialize (regression: 'Object of type
    ToolCall is not JSON serializable')."""
    client, _ = auth_client
    u = _enable_ai(auth_client)
    _enable_research(u)

    import flasky.blueprints.ai as ai_bp_mod

    class FakeFunction:
        name = "web_search"
        arguments = {"query": "maduro"}

    class FakeToolCall:
        function = FakeFunction()

    class FakeClient:
        calls = 0

        def chat(self, **kwargs):
            FakeClient.calls += 1
            if kwargs.get("tools") and FakeClient.calls == 1:
                return iter([
                    {"message": {"content": "Searching...", "tool_calls": [FakeToolCall()]}},
                ])
            return iter([{"message": {"content": "Answer after tools."}}])

    monkeypatch.setattr(ai_bp_mod, "_get_ollama_client", lambda settings: FakeClient())

    monkeypatch.setattr(
        ai_bp_mod.requests, "post",
        lambda endpoint, headers=None, json=None, timeout=None: type("R", (), {
            "raise_for_status": lambda self: None,
            "json": lambda self: {"results": [{"title": "t", "url": "u", "content": "c"}]},
        })(),
    )

    r = client.post("/ai/api/research/round", json={"messages": [
        {"role": "user", "content": "Research this topic thoroughly: maduro"},
    ]})
    assert r.status_code == 200
    events = _sse_events(r)
    assert "error" not in events[0], events
    tool_call_events = [e for e in events if "tool_calls" in e]
    assert len(tool_call_events) == 1
    assert tool_call_events[0]["tool_calls"] == [
        {"function": {"name": "web_search", "arguments": {"query": "maduro"}}}
    ]
    done = [e for e in events if e.get("round_done")]
    assert done
    assert done[0]["content"] == "Searching...Answer after tools."
    assert done[0]["last_text"] == "Answer after tools."


def test_research_round_accepts_transcript_with_tool_context(monkeypatch, auth_client):
    """The client mirrors tool_calls/tool_result events back as transcript
    messages on later rounds; the server must accept that shape."""
    client, _ = auth_client
    u = _enable_ai(auth_client)
    _enable_research(u)

    import flasky.blueprints.ai as ai_bp_mod

    seen_messages = []

    class FakeClient:
        def chat(self, **kwargs):
            seen_messages.append(kwargs["messages"])
            return iter([{"message": {"content": "Follow-up answer."}}])

    monkeypatch.setattr(ai_bp_mod, "_get_ollama_client", lambda settings: FakeClient())

    r = client.post("/ai/api/research/round", json={"messages": [
        {"role": "user", "content": "Research this topic thoroughly: x"},
        {"role": "assistant", "content": "Searching for x.", "tool_calls": [
            {"function": {"name": "web_search", "arguments": {"query": "x"}}},
        ]},
        {"role": "tool", "content": '{"results": []}', "tool_name": "web_search"},
        {"role": "assistant", "content": "Interim findings about x."},
        {"role": "user", "content": "Redirect instruction: focus on y"},
    ]})
    assert r.status_code == 200
    events = _sse_events(r)
    assert "error" not in events[0]
    msgs = seen_messages[0]
    assert [m["role"] for m in msgs] == ["system", "user", "assistant", "tool", "assistant", "user"]
    assert msgs[2]["tool_calls"][0]["function"]["name"] == "web_search"


def test_ai_page_fragment_includes_research_flag(auth_client):
    client, _ = auth_client
    u = _enable_ai(auth_client)
    _enable_research(u)
    r = client.get("/ai?_fragment=1")
    assert r.status_code == 200
    body = r.data.decode()
    assert "aiResearchAllowed" in body
    assert "ai-research-chip" in body
    assert "ai-research-modal" in body


def test_ai_page_fragment_hides_research_when_gate_off(auth_client):
    client, _ = auth_client
    _enable_ai(auth_client)
    r = client.get("/ai?_fragment=1")
    assert r.status_code == 200
    assert b"ai-research-chip" not in r.data
    assert b"ai-research-modal" not in r.data


def test_settings_persist_research_gate_and_rounds(auth_client):
    client, _ = auth_client
    _enable_ai(auth_client)
    r = client.post("/settings", data={
        "update-ai-research-settings": "1",
        "ai-research-allowed": "1",
        "ai-research-max-rounds": "15",
    })
    assert r.status_code in (200, 302)
    from flasky.models import User
    from flasky.ui_settings import get_setting
    u = User.query.filter_by(username="testuser").first()
    assert get_setting(u, "ai_research_allowed") is True
    assert get_setting(u, "ai_research_max_rounds") == 15


def test_research_defaults():
    from flasky.ui_settings import get_setting
    from flasky.models import User
    u = User(username="defaults_probe")
    assert get_setting(u, "ai_research_allowed") is False
    assert get_setting(u, "ai_research_max_rounds") == 10