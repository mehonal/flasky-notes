from flask import (
    Blueprint,
    render_template,
    request,
    g,
    jsonify,
    Response,
    stream_with_context,
    redirect,
    url_for,
)
import json
import logging
import re

from flasky import db
from flasky.models import AiConversation, AiMessage
from flasky.ui_settings import (
    get_setting, get_all_settings, get_effective_colors,
    DEFAULT_COLORS, CUSTOMIZABLE_VARS,
)

logger = logging.getLogger(__name__)

ai_bp = Blueprint("ai", __name__, url_prefix="/ai")

OLLAMA_CLOUD_MODELS = [
    "gpt-oss:120b",
    "gpt-oss:20b",
    "deepseek-v3.2",
    "deepseek-v4-flash",
    "deepseek-v4-pro",
    "glm-5.2",
    "glm-5.1",
    "glm-5",
    "glm-4.7",
    "kimi-k2.7-code",
    "kimi-k2.6",
    "kimi-k2.5",
    "minimax-m3",
    "minimax-m2.7",
    "minimax-m2.5",
    "minimax-m2.1",
    "mistral-large-3:675b",
    "qwen3.5:397b",
    "qwen3-coder:480b",
    "gemini-3-flash-preview",
    "gemma4:31b",
    "gemma3:27b",
    "gemma3:12b",
    "gemma3:4b",
    "devstral-2:123b",
    "devstral-small-2:24b",
    "nemotron-3-super",
    "nemotron-3-nano:30b",
    "ministral-3:14b",
    "ministral-3:8b",
    "ministral-3:3b",
    "rnj-1:8b",
]


def _ai_disabled_response():
    return jsonify(error="AI integration is disabled. Enable it in Settings."), 403


def _check_ai_enabled():
    if not g.user:
        return jsonify(error="Not logged in."), 401
    settings = g.user.return_settings()
    if not settings or not settings.ai_enabled:
        return _ai_disabled_response()
    return None


def _get_ollama_client(settings):
    from ollama import Client

    base_url = settings.ollama_base_url or "https://ollama.com"
    headers = {}
    if settings.ollama_api_key:
        headers["Authorization"] = "Bearer " + settings.ollama_api_key
    return Client(host=base_url, headers=headers)


@ai_bp.route("")
def ai_page():
    if not g.user:
        return "You must be logged in to access this page.", 401
    settings = g.user.return_settings()
    ai_enabled = settings.ai_enabled if settings else False
    font_size = get_setting(g.user, "font_size") if g.user else 15
    dark_mode = get_setting(g.user, "dark_mode") if g.user else False
    if not ai_enabled:
        ui_settings = get_all_settings(g.user) if g.user else None
        return render_template(
            "ai.html",
            ai_enabled=False,
            ai_settings=settings,
            conversations_json="[]",
            current_conversation_id="null",
            current_conversation_json="null",
            current_theme_dark=dark_mode,
            font_size=font_size,
            models=OLLAMA_CLOUD_MODELS,
            custom_colors=get_effective_colors(ui_settings.custom_colors) if ui_settings else {},
            custom_css=ui_settings.custom_css if ui_settings else "",
        )
    conversations = (
        AiConversation.query.filter_by(user_id=g.user.id)
        .order_by(AiConversation.updated_at.desc())
        .all()
    )
    conv_id = request.args.get("conversation_id", type=int)
    current_conversation = None
    if conv_id:
        current_conversation = AiConversation.query.filter_by(id=conv_id, user_id=g.user.id).first()
    conversations_json = json.dumps([c.return_json() for c in conversations])
    current_conversation_id = str(current_conversation.id) if current_conversation else "null"
    current_conversation_json = (
        json.dumps(current_conversation.return_json()) if current_conversation else "null"
    )
    ui_settings = get_all_settings(g.user)
    return render_template(
        "ai.html",
        ai_enabled=True,
        ai_settings=settings,
        conversations_json=conversations_json,
        current_conversation_id=current_conversation_id,
        current_conversation_json=current_conversation_json,
        current_theme_dark=dark_mode,
        font_size=font_size,
        models=OLLAMA_CLOUD_MODELS,
        custom_colors=get_effective_colors(ui_settings.custom_colors),
        custom_css=ui_settings.custom_css,
    )


@ai_bp.route("/api/conversations", methods=["GET"])
def list_conversations():
    err = _check_ai_enabled()
    if err:
        return err
    conversations = (
        AiConversation.query.filter_by(user_id=g.user.id)
        .order_by(AiConversation.updated_at.desc())
        .all()
    )
    return jsonify([c.return_json() for c in conversations])


@ai_bp.route("/api/conversations", methods=["POST"])
def create_conversation():
    err = _check_ai_enabled()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    title = data.get("title", "").strip() or None
    conv = AiConversation(user_id=g.user.id, title=title)
    db.session.add(conv)
    db.session.commit()
    return jsonify(conv.return_json())


@ai_bp.route("/api/conversations/<int:conv_id>", methods=["DELETE"])
def delete_conversation(conv_id):
    err = _check_ai_enabled()
    if err:
        return err
    conv = AiConversation.query.filter_by(id=conv_id, user_id=g.user.id).first()
    if not conv:
        return jsonify(error="Conversation not found."), 404
    AiMessage.query.filter_by(conversation_id=conv.id).delete()
    db.session.delete(conv)
    db.session.commit()
    return jsonify(success=True)


@ai_bp.route("/api/conversations/<int:conv_id>/rename", methods=["PUT"])
def rename_conversation(conv_id):
    err = _check_ai_enabled()
    if err:
        return err
    conv = AiConversation.query.filter_by(id=conv_id, user_id=g.user.id).first()
    if not conv:
        return jsonify(error="Conversation not found."), 404
    data = request.get_json(silent=True) or {}
    title = data.get("title", "").strip()
    if not title:
        return jsonify(error="Title cannot be empty."), 400
    conv.title = title[:500]
    db.session.commit()
    return jsonify(conv.return_json())


@ai_bp.route("/api/conversations/<int:conv_id>/messages", methods=["GET"])
def get_messages(conv_id):
    err = _check_ai_enabled()
    if err:
        return err
    conv = AiConversation.query.filter_by(id=conv_id, user_id=g.user.id).first()
    if not conv:
        return jsonify(error="Conversation not found."), 404
    messages = (
        AiMessage.query.filter_by(conversation_id=conv.id)
        .order_by(AiMessage.created_at.asc())
        .all()
    )
    return jsonify(
        [
            {
                "id": m.id,
                "role": m.role,
                "content": m.content,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in messages
        ]
    )


@ai_bp.route("/api/conversations/<int:conv_id>/chat", methods=["POST"])
def chat(conv_id):
    err = _check_ai_enabled()
    if err:
        return err
    settings = g.user.return_settings()
    if not settings.ollama_api_key:
        return jsonify(error="Ollama API key not configured. Set it in Settings."), 400
    conv = AiConversation.query.filter_by(id=conv_id, user_id=g.user.id).first()
    if not conv:
        return jsonify(error="Conversation not found."), 404
    data = request.get_json(silent=True) or {}
    user_content = data.get("message", "").strip()
    if not user_content:
        return jsonify(error="Message cannot be empty."), 400
    user_msg = AiMessage(conversation_id=conv.id, role="user", content=user_content)
    db.session.add(user_msg)
    from datetime import datetime

    conv.updated_at = datetime.utcnow()
    db.session.commit()
    # With mandatory E2EE, the server cannot read its own stored ciphertext to
    # build history for the model — the client must send the full decrypted-
    # then-re-encrypted-elsewhere message history is NOT what we want here;
    # actually the client sends the messages it wants to feed the model
    # (already decrypted by the client for the model call, but the server
    # stores only the user's ciphertext). The server passes the client-provided
    # messages straight through to Ollama.
    client_messages = data.get("messages")
    if not client_messages:
        return jsonify(
            error="Encrypted conversations require client-provided message history."
        ), 400
    ollama_messages = client_messages
    model = settings.ollama_model or "gpt-oss:120b"
    conv_id = conv.id
    user_id = g.user.id

    def generate():
        full_response = []
        try:
            client = _get_ollama_client(settings)
            stream = client.chat(model=model, messages=ollama_messages, stream=True)
            for part in stream:
                chunk = part.get("message", {}).get("content", "")
                if chunk:
                    full_response.append(chunk)
                    yield f"data: {json.dumps({'chunk': chunk})}\n\n"
            complete_text = "".join(full_response)
            conv_obj = db.session.get(AiConversation, conv_id)
            if conv_obj and conv_obj.user_id == user_id:
                assistant_msg = AiMessage(
                    conversation_id=conv_id, role="assistant", content=complete_text
                )
                db.session.add(assistant_msg)
                conv_obj.updated_at = datetime.utcnow()
                db.session.commit()
                yield f"data: {json.dumps({'done': True, 'encrypted': True, 'message_id': assistant_msg.id})}\n\n"
            else:
                yield f"data: {json.dumps({'error': 'Conversation not found.'})}\n\n"
        except Exception as e:
            logger.error("Ollama chat error: %s", e)
            yield f"data: {json.dumps({'error': 'An error occurred while generating a response. Please try again.'})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@ai_bp.route("/api/messages/<int:message_id>/encrypt", methods=["PUT"])
def encrypt_message(message_id):
    err = _check_ai_enabled()
    if err:
        return err
    msg = AiMessage.query.get(message_id)
    if not msg or msg.conversation.user_id != g.user.id:
        return jsonify(error="Message not found."), 404
    data = request.get_json(silent=True) or {}
    encrypted_content = data.get("content", "").strip()
    if not encrypted_content:
        return jsonify(error="Content cannot be empty."), 400
    msg.content = encrypted_content
    db.session.commit()
    return jsonify(success=True)


@ai_bp.route("/api/settings", methods=["POST"])
def update_settings():
    err = _check_ai_enabled()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    settings = g.user.return_settings()
    if not settings:
        return jsonify(error="Settings not found."), 404
    if "model" in data:
        model = data["model"].strip()
        if model:
            settings.ollama_model = model
            db.session.commit()
            return jsonify(success=True, model=settings.ollama_model)
    return jsonify(error="No valid settings provided."), 400


@ai_bp.route("/api/models", methods=["GET"])
def list_models():
    err = _check_ai_enabled()
    if err:
        return err
    settings = g.user.return_settings()
    try:
        client = _get_ollama_client(settings)
        models_resp = client.list()
        remote_models = []
        for m in models_resp.get("models", []):
            name = m.get("name", "")
            if name:
                remote_models.append(name)
        if remote_models:
            remote_models.sort()
            return jsonify({"models": remote_models, "source": "api"})
    except Exception:
        pass
    return jsonify({"models": OLLAMA_CLOUD_MODELS, "source": "fallback"})


@ai_bp.route("/api/create_note", methods=["POST"])
def create_note_from_ai():
    err = _check_ai_enabled()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    source = data.get("source", "")
    title = (data.get("title") or "").strip()
    content = (data.get("content") or "").strip()

    if source == "message":
        message_id = data.get("message_id")
        if not message_id:
            return jsonify(error="message_id is required."), 400
        msg = AiMessage.query.filter_by(id=message_id).first()
        if not msg or msg.conversation.user_id != g.user.id:
            return jsonify(error="Message not found."), 404
        if content:
            note_content = content
            note_title = title or content[:100].split("\n")[0] or "AI Chat Note"
        else:
            note_content = msg.content
            note_title = title or msg.content[:100].split("\n")[0] or "AI Chat Note"

    elif source == "conversation":
        conv_id = data.get("conversation_id")
        if not conv_id:
            return jsonify(error="conversation_id is required."), 400
        conv = AiConversation.query.filter_by(id=conv_id, user_id=g.user.id).first()
        if not conv:
            return jsonify(error="Conversation not found."), 404
        if not content:
            return jsonify(
                error="Content is required for conversation export. Send the assembled conversation text as content."
            ), 400
        note_title = title or conv.title or "AI Chat Export"
        note_content = content

    elif source == "custom":
        if not content:
            return jsonify(error="content is required."), 400
        note_title = title or "AI Chat Note"
        note_content = content

    else:
        return jsonify(error="source must be 'message', 'conversation', or 'custom'."), 400

    from flasky.services.notes import create_note

    note = create_note(g.user, note_title, note_content, None)
    return jsonify(success=True, note_id=note.id, title=note_title)


# ---------------------------------------------------------------------------
# AI CSS generation (non-streaming). Used by the Customize modal to generate
# custom CSS from a natural-language prompt. CSS is UI state (not E2EE note
# content), so it is not encrypted and does not require a conversation.
# ---------------------------------------------------------------------------

AI_CSS_SYSTEM_PROMPT = (
    "You are a CSS expert helping a user redesign the appearance of their "
    "note-taking app. You will be given the current CSS custom property "
    "values for the active theme and a minimal HTML skeleton of the app "
    "layout with the real class names.\n\n"
    "Rules:\n"
    "1. Return ONLY valid CSS. No explanations, no markdown fences, no HTML.\n"
    "2. You may override the provided CSS custom properties (e.g. "
    "``--accent: #ff0000;``) and/or write rules targeting the provided class "
    "names (e.g. ``.sidebar { ... }``).\n"
    "3. Do NOT use @import, url(), expression(), javascript:, or any "
    "external resource fetch. Do not include <style> tags.\n"
    "4. Keep the output concise and focused on the user's request.\n"
    "5. Prefer overriding the CSS custom properties for color/background "
    "changes; use class-based rules only for layout/spacing/borders.\n"
)

_CSS_SKELETON = """\
<div class="app">
  <aside class="sidebar">
    <div class="sidebar-header">...</div>
    <div class="sidebar-nav">
      <a class="nav-item">...</a>
      <button class="nav-item nav-item-btn">...</button>
    </div>
    <div class="sidebar-footer">...</div>
  </aside>
  <div class="main">
    <div class="toolbar">
      <button class="icon-btn">...</button>
      <span class="breadcrumb">...</span>
      <button class="icon-btn" id="theme-toggle">...</button>
    </div>
    <div class="editor-area">
      <div class="editor-wrap">
        <div class="cm-editor">CodeMirror editor</div>
        <div class="editor-preview">markdown preview</div>
      </div>
      <aside class="right-panel">
        <div class="right-panel-top-bar">...</div>
        <div class="right-panel-widgets">
          <div class="panel-widget">...</div>
        </div>
      </aside>
    </div>
    <div class="status-bar">
      <span class="status-item">...</span>
    </div>
  </div>
</div>"""

# Patterns that must never appear in generated CSS (CSP/safety guards).
_FORBIDDEN_CSS_RE = re.compile(
    r"@import|expression\(|url\(|javascript:|<script|</script|<style|</style",
    re.IGNORECASE,
)


def _build_css_context(
    theme: str,
    current_css: str = "",
    color_overrides: dict | None = None,
) -> str:
    """Build the minimal context string sent to the model.

    By default only the theme defaults are sent (so the model knows the
    baseline). When ``color_overrides`` is provided, the user's actual
    overrides are merged on top of the defaults so the model sees the
    current effective palette. When ``current_css`` is provided, the
    user's existing custom CSS is included so the model can modify or
    extend it instead of starting from scratch.
    """
    defaults = DEFAULT_COLORS.get(theme, DEFAULT_COLORS["dark"])
    effective = dict(defaults)
    if color_overrides:
        theme_overrides = color_overrides.get(theme, {})
        if isinstance(theme_overrides, dict):
            for var in CUSTOMIZABLE_VARS:
                val = theme_overrides.get(var)
                if isinstance(val, str) and val.strip():
                    effective[var] = val.strip()
    var_lines = "\n".join(
        f"  {var}: {effective.get(var, 'unset')};"
        for var in CUSTOMIZABLE_VARS
    )
    parts = [
        f"Active theme: {theme}",
        f"Current CSS custom properties ({theme}):",
        f":root {{\n{var_lines}\n}}",
        f"HTML skeleton (use these class names):\n{_CSS_SKELETON}",
    ]
    if current_css:
        parts.append(
            "User's current custom CSS (modify/extend this as requested, "
            "do not repeat unchanged rules):\n" + current_css
        )
    return "\n\n".join(parts) + "\n"


def _strip_code_fence(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    return text


def _validate_css(css: str) -> bool:
    if not css or not css.strip():
        return False
    if _FORBIDDEN_CSS_RE.search(css):
        return False
    # "<" has no valid use in CSS and can break out of a <style> element; the
    # HTML auto-escaping in the template neutralizes it, but reject anyway as
    # a defense-in-depth guard. ">" (child combinator) is valid CSS, so allow it.
    if "<" in css:
        return False
    open_braces = css.count("{")
    close_braces = css.count("}")
    if open_braces != close_braces:
        return False
    return True


@ai_bp.route("/api/generate_css", methods=["POST"])
def generate_css():
    err = _check_ai_enabled()
    if err:
        return err
    settings = g.user.return_settings()
    if not settings.ollama_api_key:
        return jsonify(error="Ollama API key not configured. Set it in Settings."), 400
    data = request.get_json(silent=True) or {}
    prompt = (data.get("prompt") or "").strip()
    if not prompt:
        return jsonify(error="Prompt is required."), 400
    theme = data.get("theme", "dark")
    if theme not in ("dark", "light"):
        theme = "dark"
    model = (data.get("model") or "").strip() or settings.ollama_model or "gpt-oss:120b"
    include_current_css = bool(data.get("include_current_css"))
    include_color_overrides = bool(data.get("include_color_overrides"))

    ui_settings = get_all_settings(g.user)
    current_css = ui_settings.custom_css if (include_current_css and ui_settings) else ""
    color_overrides = (
        get_effective_colors(ui_settings.custom_colors)
        if (include_color_overrides and ui_settings)
        else None
    )

    context = _build_css_context(theme, current_css, color_overrides)
    messages = [
        {"role": "system", "content": AI_CSS_SYSTEM_PROMPT},
        {"role": "user", "content": f"Prompt: {prompt}\n\nContext:\n{context}"},
    ]
    try:
        client = _get_ollama_client(settings)
        resp = client.chat(
            model=model,
            messages=messages,
            stream=False,
        )
    except Exception as e:
        logger.error("Ollama generate_css error: %s", e)
        return jsonify(
            error="An error occurred while generating CSS. Please try again."
        ), 500
    css = ""
    try:
        css = resp.get("message", {}).get("content", "") or ""
    except (AttributeError, TypeError):
        css = ""
    css = _strip_code_fence(css)
    valid = _validate_css(css)
    return jsonify(css=css, valid=valid)
