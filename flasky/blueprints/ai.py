from flask import (
    Blueprint,
    render_template,
    request,
    g,
    jsonify,
    Response,
    stream_with_context,
)
import json
import logging

from flasky import db
from flasky.models import AiConversation, AiMessage

logger = logging.getLogger(__name__)

ai_bp = Blueprint("ai", __name__, url_prefix="/ai")

OLLAMA_CLOUD_MODELS = [
    "gpt-oss:120b",
    "gpt-oss:20b",
    "deepseek-v3.2",
    "deepseek-v4-flash",
    "deepseek-v4-pro",
    "glm-5.1",
    "glm-5",
    "glm-4.7",
    "kimi-k2-thinking",
    "kimi-k2.6",
    "kimi-k2.5",
    "minimax-m2.7",
    "minimax-m2.5",
    "minimax-m2.1",
    "mistral-large-3:675b",
    "qwen3.5:397b",
    "qwen3-coder:480b",
    "qwen3-next:80b",
    "qwen3-vl:235b",
    "gemini-3-flash-preview",
    "gemma4:31b",
    "gemma3:27b",
    "gemma3:12b",
    "gemma3:4b",
    "cogito-2.1:671b",
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
    encryption_enabled = g.user.encryption_enabled if g.user else False
    if not ai_enabled:
        font_size = g.user.get_current_theme_font_size() if g.user else 15
        return render_template(
            "ai.html",
            ai_enabled=False,
            ai_settings=settings,
            conversations_json="[]",
            current_conversation_id="null",
            current_conversation_json="null",
            current_theme_dark=g.user.get_current_theme_dark_mode(),
            font_size=font_size,
            models=OLLAMA_CLOUD_MODELS,
            encryption_enabled=encryption_enabled,
        )
    conversations = (
        AiConversation.query.filter_by(user_id=g.user.id)
        .order_by(AiConversation.updated_at.desc())
        .all()
    )
    conv_id = request.args.get("conversation_id", type=int)
    current_conversation = None
    if conv_id:
        current_conversation = AiConversation.query.filter_by(
            id=conv_id, user_id=g.user.id
        ).first()
    font_size = g.user.get_current_theme_font_size() if g.user else 15
    conversations_json = json.dumps([c.return_json() for c in conversations])
    current_conversation_id = (
        str(current_conversation.id) if current_conversation else "null"
    )
    current_conversation_json = (
        json.dumps(current_conversation.return_json())
        if current_conversation
        else "null"
    )
    return render_template(
        "ai.html",
        ai_enabled=True,
        ai_settings=settings,
        conversations_json=conversations_json,
        current_conversation_id=current_conversation_id,
        current_conversation_json=current_conversation_json,
        current_theme_dark=g.user.get_current_theme_dark_mode(),
        font_size=font_size,
        models=OLLAMA_CLOUD_MODELS,
        encryption_enabled=encryption_enabled,
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
    encrypted = g.user.encryption_enabled
    data = request.get_json(silent=True) or {}
    user_content = data.get("message", "").strip()
    if not user_content:
        return jsonify(error="Message cannot be empty."), 400
    user_msg = AiMessage(conversation_id=conv.id, role="user", content=user_content)
    db.session.add(user_msg)
    if not encrypted and (not conv.title or conv.title == "Untitled"):
        conv.title = user_content[:100]
    from datetime import datetime

    conv.updated_at = datetime.utcnow()
    db.session.commit()
    if encrypted:
        client_messages = data.get("messages")
        if not client_messages:
            return jsonify(
                error="Encrypted conversations require client-provided message history."
            ), 400
        ollama_messages = client_messages
    else:
        history = (
            AiMessage.query.filter_by(conversation_id=conv.id)
            .order_by(AiMessage.created_at.asc())
            .all()
        )
        ollama_messages = []
        for m in history:
            ollama_messages.append({"role": m.role, "content": m.content})
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
                yield f"data: {json.dumps({'done': True, 'encrypted': encrypted, 'message_id': assistant_msg.id})}\n\n"
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
    if not g.user.encryption_enabled:
        return jsonify(error="Encryption is not enabled."), 400
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
