"""Provider abstraction: OpenAI-compatible chat-completions client.

Replaces the Ollama SDK. Any OpenAI-compatible provider works: point
``ollama_base_url`` (the existing settings column) at the provider's base
URL and set ``ollama_api_key`` to the provider API key. Both the blocking
and streaming helpers return/emit OpenAI-style message dicts, translated
into the ollama-shaped ``{"message": {...}}`` parts the rest of the app
already consumes.
"""

import json

import requests


def _headers(settings):
    headers = {"Content-Type": "application/json"}
    if getattr(settings, "ollama_api_key", None):
        headers["Authorization"] = "Bearer " + settings.ollama_api_key
    return headers


def _base_url(settings):
    base_url = (getattr(settings, "ollama_base_url", "") or "").rstrip("/")
    if not base_url:
        raise ValueError("No AI provider base URL configured.")
    return base_url


def build_chat_messages(messages):
    """Normalize client messages into OpenAI-style plain dicts."""
    return [
        {
            "role": m.get("role", "user"),
            "content": m.get("content", ""),
        }
        if isinstance(m, dict)
        else {"role": getattr(m, "role", "user"), "content": getattr(m, "content", "")}
        for m in messages
    ]


def _payload(model, messages, tools=None, stream=False):
    payload = {"model": model, "messages": build_chat_messages(messages)}
    if stream:
        payload["stream"] = True
    if tools:
        payload["tools"] = tools
    return payload


def chat_completion(settings, model, messages, tools=None, timeout=60):
    """Blocking chat completion. Returns an ollama-shaped response dict:
    ``{"message": {"role": "assistant", "content": ...}}``."""
    resp = requests.post(
        _base_url(settings) + "/chat/completions",
        headers=_headers(settings),
        json=_payload(model, messages, tools),
        timeout=timeout,
    )
    resp.raise_for_status()
    data = resp.json()
    choice = (data.get("choices") or [{}])[0]
    message = choice.get("message") or {}
    return {"message": {"role": message.get("role", "assistant"),
                        "content": message.get("content", "")}}


def chat_stream(settings, model, messages, tools=None, timeout=120):
    """Streaming chat completion. Yields ollama-shaped parts:
    ``{"message": {"content": ..., "tool_calls": [...]}}``."""
    resp = requests.post(
        _base_url(settings) + "/chat/completions",
        headers=_headers(settings),
        json=_payload(model, messages, tools, stream=True),
        stream=True,
        timeout=timeout,
    )
    resp.raise_for_status()
    tool_calls = []
    for line in resp.iter_lines(decode_unicode=True):
        if not line or not line.startswith("data: "):
            continue
        data = line[6:]
        if data.strip() == "[DONE]":
            break
        chunk = json.loads(data)
        delta = ((chunk.get("choices") or [{}])[0].get("delta")) or {}
        content = delta.get("content") or ""
        for tc in delta.get("tool_calls") or []:
            fn = tc.get("function", {}) or {}
            name = fn.get("name", "")
            args = fn.get("arguments", "")
            if isinstance(args, str):
                try:
                    args = json.loads(args) if args.strip() else {}
                except ValueError:
                    args = {"_raw": args}
            tool_calls.append({"function": {"name": name, "arguments": args}})
        if content or tool_calls:
            part = {"message": {"role": "assistant", "content": content}}
            if tool_calls:
                part["message"]["tool_calls"] = list(tool_calls)
            yield part


class OpenAICompatClient:
    """Client-compatible facade over any OpenAI-compatible provider.

    Exposes the same ``chat()`` / ``list()`` surface the blueprint already
    consumes, so call sites and tests are provider-agnostic.
    """

    def __init__(self, settings):
        self._settings = settings

    def chat(self, model, messages, stream=False, tools=None, **kwargs):
        if stream:
            return chat_stream(self._settings, model, messages, tools=tools)
        return chat_completion(self._settings, model, messages, tools=tools)

    def list(self):
        """Return ``{"models": [{"name": ...}]}`` from the provider's
        /models endpoint (OpenAI ``{"data": [{"id": ...}]}`` format)."""
        resp = requests.get(
            _base_url(self._settings) + "/models",
            headers=_headers(self._settings),
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        raw = data.get("data") if isinstance(data, dict) else None
        if raw is None and isinstance(data, dict):
            raw = data.get("models")
        names = []
        for m in raw or []:
            if isinstance(m, dict):
                names.append(m.get("id") or m.get("name") or m.get("model"))
            else:
                names.append(getattr(m, "id", None) or getattr(m, "name", None))
        return {"models": [{"name": n} for n in names if n]}
