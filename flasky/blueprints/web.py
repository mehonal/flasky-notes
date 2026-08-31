from flask import (
    Blueprint,
    render_template,
    request,
    session,
    redirect,
    url_for,
    g,
    jsonify,
    make_response,
    current_app,
)
from datetime import datetime, timedelta
import base64
import bcrypt
import hashlib
import json
import re

import config as CONFIG
from flasky import db
from flasky.models import (
    User,
    UserNote,
    UserNoteCategory,
    UserTodo,
    UserEvent,
    ApiToken,
    SyncConflict,
    Attachment,
    NoteTemplate,
)
import os
import secrets
from flasky.utils import (
    has_banned_chars,
    valid_email,
    generate_api_token,
    recovery_limiter,
    login_limiter,
    login_required,
    login_required_page,
    verify_recaptcha,
)
from flasky.ui_settings import (
    get_all_settings,
    get_setting,
    set_setting,
    get_panel_widgets,
    set_panel_widgets,
    get_topbar_items,
    set_topbar_items,
    get_effective_colors,
)

# Paths exempt from CSRF validation (pre-auth or token-auth endpoints)
_CSRF_EXEMPT = (
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/salt",
    "/api/auth/recovery_info",
    "/api/auth/recover",
    "/api/sync/",
    "/api/external/",
)
from zoneinfo import available_timezones

web_bp = Blueprint("web", __name__)

# Pre-computed dummy hash for constant-time login response when user not found
_DUMMY_BCRYPT_HASH = bcrypt.hashpw(b"dummy", bcrypt.gensalt())

# ============ E2EE Auth API ============


@web_bp.route("/api/auth/register", methods=["POST"])
def api_auth_register():
    """E2EE registration: accepts auth_key (derived hash) instead of raw password."""
    data = request.get_json()
    if not data:
        return jsonify(success=False, reason="Missing request body."), 400
    # Honeypot: if 'website' field is present and filled, it's a bot
    if data.get("website"):
        return jsonify(success=False, reason="Registration failed."), 400
    # reCAPTCHA verification (when enabled)
    if CONFIG.RECAPTCHA_ENABLED:
        if not verify_recaptcha(data.get("recaptcha_token", "")):
            return jsonify(success=False, reason="reCAPTCHA verification failed."), 400
    username = (data.get("username") or "").lower().strip()
    email = (data.get("email") or "").lower().strip()
    auth_key = data.get("auth_key")
    encrypted_sym_key = data.get("encrypted_sym_key")
    recovery_encrypted_key = data.get("recovery_encrypted_key")

    if not username or not email or not auth_key or not encrypted_sym_key:
        return jsonify(success=False, reason="Missing required fields."), 400
    if len(auth_key) < 16:
        return jsonify(success=False, reason="Auth key too short."), 400
    if has_banned_chars(username) or " " in username:
        return jsonify(success=False, reason="Illegal username."), 400
    if not valid_email(email):
        return jsonify(success=False, reason="Illegal email."), 400
    if len(username) < 4:
        return jsonify(
            success=False, reason="Username must be at least 4 characters."
        ), 400
    if len(username) > 30:
        return jsonify(
            success=False, reason="Username must be at most 30 characters."
        ), 400
    if User.query.filter_by(username=username).first():
        return jsonify(success=False, reason="Username already taken."), 400
    if User.query.filter_by(email=email).first():
        return jsonify(success=False, reason="Email already in use."), 400

    # Create user + key material + default category via the auth service.
    from flasky.services.auth import register_e2ee_user

    try:
        register_e2ee_user(
            username=username,
            email=email,
            auth_key=auth_key,
            encrypted_sym_key=encrypted_sym_key,
            recovery_encrypted_key=recovery_encrypted_key,
            recovery_key_hash=data.get("recovery_key_hash"),
            key_salt=data.get("key_salt"),
            password_hint=data.get("password_hint", ""),
            encrypted_main_category=data.get("encrypted_main_category"),
        )
    except ValueError as e:
        return jsonify(success=False, reason=str(e)), 400

    return jsonify(success=True)


@web_bp.route("/api/auth/salt")
def api_auth_salt():
    """Return the PBKDF2 salt for a user (needed before key derivation). Rate-limited."""
    if login_limiter.is_limited():
        return jsonify(key_salt=None, reason="Too many attempts."), 429
    username = (request.args.get("username") or "").lower().strip()
    if not username:
        return jsonify(key_salt=None)
    user = User.query.filter_by(username=username).first()
    # Always return a deterministic fake salt for unknown users to prevent enumeration
    if not user or not user.key_salt:
        fake = hashlib.sha256(("flasky-salt-" + username).encode()).hexdigest()
        return jsonify(key_salt=fake)
    return jsonify(key_salt=user.key_salt)


@web_bp.route("/api/auth/login", methods=["POST"])
def api_auth_login():
    """E2EE login: accepts auth_key (derived hash)."""
    data = request.get_json()
    if not data:
        return jsonify(success=False, reason="Missing request body."), 400
    username = (data.get("username") or "").lower().strip()
    auth_key = data.get("auth_key")
    if not username or not auth_key:
        return jsonify(success=False, reason="Missing username or auth_key."), 400

    if login_limiter.is_limited():
        return jsonify(
            success=False, reason="Too many login attempts. Try again later."
        ), 429

    user = User.query.filter_by(username=username).first()
    if not user:
        bcrypt.checkpw(auth_key.encode("utf-8"), _DUMMY_BCRYPT_HASH)
        login_limiter.record()
        return jsonify(success=False, reason="Invalid credentials."), 401
    if not bcrypt.checkpw(auth_key.encode("utf-8"), user.password):
        login_limiter.record()
        return jsonify(success=False, reason="Invalid credentials."), 401

    session.clear()
    session["user_id"] = user.id
    session.permanent = True

    return jsonify(
        success=True,
        encrypted_sym_key=user.encrypted_symmetric_key,
    )


@web_bp.route("/api/auth/change_password", methods=["POST"])
@login_required
def api_auth_change_password():
    """Change password for E2EE user. Client re-wraps symmetric key with new KEK."""
    data = request.get_json()
    if not data:
        return jsonify(success=False, reason="Missing request body."), 400
    new_auth_key = data.get("new_auth_key")
    new_encrypted_sym_key = data.get("new_encrypted_sym_key")
    if not new_auth_key or not new_encrypted_sym_key:
        return jsonify(success=False, reason="Missing required fields."), 400

    from flasky.services.auth import change_password

    change_password(
        g.user, new_auth_key, new_encrypted_sym_key,
        new_recovery_encrypted_key=data.get("new_recovery_encrypted_key"),
        new_recovery_key_hash=data.get("new_recovery_key_hash"),
        new_key_salt=data.get("new_key_salt"),
    )
    return jsonify(success=True)


@web_bp.route("/api/auth/update_recovery_key", methods=["POST"])
@login_required
def api_auth_update_recovery_key():
    """Update the recovery-encrypted symmetric key."""
    data = request.get_json()
    if not data or not data.get("recovery_encrypted_key"):
        return jsonify(success=False, reason="Missing recovery_encrypted_key."), 400
    from flasky.services.auth import update_recovery_key

    update_recovery_key(
        g.user, data["recovery_encrypted_key"],
        recovery_key_hash=data.get("recovery_key_hash"),
    )
    return jsonify(success=True)


@web_bp.route("/api/auth/recover", methods=["POST"])
def api_auth_recover():
    """Account recovery using recovery key. Client unwraps with recovery key, sets new password."""
    if recovery_limiter.is_limited():
        return jsonify(
            success=False, reason="Too many recovery attempts. Try again later."
        ), 429
    recovery_limiter.record()

    data = request.get_json()
    if not data:
        return jsonify(success=False, reason="Missing request body."), 400
    username = (data.get("username") or "").lower().strip()
    new_auth_key = data.get("new_auth_key")
    new_encrypted_sym_key = data.get("new_encrypted_sym_key")

    recovery_key_hash = data.get("recovery_key_hash")
    if (
        not username
        or not new_auth_key
        or not new_encrypted_sym_key
        or not recovery_key_hash
    ):
        return jsonify(success=False, reason="Missing required fields."), 400

    from flasky.services.auth import recover_account

    user = recover_account(
        username, new_auth_key, new_encrypted_sym_key, recovery_key_hash,
        new_recovery_encrypted_key=data.get("new_recovery_encrypted_key"),
        new_recovery_key_hash=data.get("new_recovery_key_hash"),
        new_key_salt=data.get("new_key_salt"),
    )
    if not user:
        return jsonify(success=False, reason="Recovery failed."), 400
    if data.get("new_key_salt"):
        user.key_salt = data["new_key_salt"]
    db.session.commit()

    session.clear()
    session["user_id"] = user.id
    session.permanent = True

    return jsonify(success=True)


@web_bp.route("/api/auth/recovery_info")
def api_auth_recovery_info():
    """Return recovery-wrapped key for account recovery. Rate-limited."""
    if recovery_limiter.is_limited():
        return jsonify(
            recovery_encrypted_key=None, reason="Too many attempts. Try again later."
        ), 429
    recovery_limiter.record()
    username = (request.args.get("username") or "").lower().strip()
    if not username:
        return jsonify(recovery_encrypted_key=None)
    user = User.query.filter_by(username=username).first()
    if not user or not user.recovery_encrypted_key:
        # Return a fake key that looks like a real wrapped key to prevent enumeration.
        # The client will fail to unwrap it (AES-GCM auth tag check), giving a generic error.
        fake_bytes = hashlib.sha256(("flasky-recovery-" + username).encode()).digest()
        fake_bytes += hashlib.sha256(
            fake_bytes
        ).digest()  # 64 bytes total (12 IV + wrapped + tag)
        return jsonify(recovery_encrypted_key=base64.b64encode(fake_bytes).decode())
    return jsonify(recovery_encrypted_key=user.recovery_encrypted_key)


@web_bp.route("/unlock")
@login_required_page
def unlock_page():
    """Password re-entry page for E2EE users whose sessionStorage key was lost."""
    if request.args.get("_fragment") == "1":
        return render_template(
            "_unlock_view.html",
            encrypted_sym_key=g.user.encrypted_symmetric_key,
            password_hint=g.user.password_hint or "",
            username=g.user.username,
            key_salt=g.user.key_salt or "",
        )
    return render_template(
        "unlock.html",
        encrypted_sym_key=g.user.encrypted_symmetric_key,
        password_hint=g.user.password_hint or "",
        username=g.user.username,
        key_salt=g.user.key_salt or "",
    )


@web_bp.before_app_request
def before_request():
    if CONFIG.ENFORCE_SSL:
        if not request.is_secure:
            url = request.url.replace("http://", "https://", 1)
            code = 301
            return redirect(url, code=code)
    session.modified = True
    g.user = None
    if "user_id" in session:
        user = User.query.filter_by(id=session["user_id"]).first()
        if user is not None:
            if user.id == session["user_id"]:
                g.user = user

    # CSRF validation for state-changing requests
    if request.method in (
        "POST",
        "PUT",
        "DELETE",
        "PATCH",
    ) and not current_app.config.get("TESTING"):
        if not any(request.path.startswith(p) for p in _CSRF_EXEMPT):
            csrf_token = session.get("csrf_token")
            header_token = request.headers.get("X-CSRFToken") or request.form.get(
                "csrf_token", ""
            )
            if (
                not csrf_token
                or not header_token
                or not secrets.compare_digest(csrf_token, header_token)
            ):
                return jsonify(error="CSRF token missing or invalid."), 403

    # Ensure CSRF token exists in session
    if "csrf_token" not in session:
        session["csrf_token"] = secrets.token_hex(32)


@web_bp.route("/")
@login_required_page
def index_page():
    # Compute the daily flag here so we skip the /notes hop and redirect
    # straight to the editor shell.
    if get_setting(g.user, "daily_note_enabled") and get_setting(
        g.user, "daily_note_open_on_start"
    ):
        return redirect(url_for("web.note_single_page", note_id=0, daily=1))
    return redirect(url_for("web.note_single_page", note_id=0))


def _render_shell(initial_view=None):
    """Render the SPA shell (note_single.html) with a blank note.

    Used by /agenda, /settings, /ai, /export when accessed directly (no
    _fragment). The router reads initialView from _pageData and auto-
    navigates to the correct view after the shell loads.
    """
    ui_settings = get_all_settings(g.user)
    default_category = g.user.get_default_category()
    panel_widgets = get_panel_widgets(g.user)
    topbar_items = get_topbar_items(g.user)
    return render_template(
        "note_single.html",
        note=None,
        note_id=0,
        font_size=ui_settings.font_size,
        category=default_category.name if default_category else None,
        category_id=default_category.id if default_category else None,
        ui_settings=ui_settings,
        custom_colors=get_effective_colors(ui_settings.custom_colors),
        custom_css=ui_settings.custom_css,
        default_template=None,
        default_category_id=(default_category.id if default_category else 0),
        panel_widgets=panel_widgets,
        topbar_items=topbar_items,
        encrypted_note_data=None,
        ai_settings=g.user.settings if g.user else None,
        ai_models=_ai_models(g.user),
        timezone=g.user.get_timezone(as_str=True),
        daily=0,
        initial_view=initial_view,
    )


def _ai_models(user):
    """Return the user's persisted AI model list, falling back to the
    Ollama Cloud hardcoded list when empty. Lazy import avoids a circular
    import (ai.py imports from web.py at module level)."""
    from flasky.blueprints.ai import _get_models

    return _get_models(user)


@web_bp.route("/settings", methods=["GET", "POST"])
@login_required_page
def settings_page():
    settings = g.user.return_settings()
    is_fragment = request.args.get("_fragment") == "1" or request.form.get("_fragment") == "1"
    if request.method == "POST":
        if "update-timezone" in request.form:
            timezone = request.form["timezone"]
            from flasky.services.settings import set_timezone
            set_timezone(g.user, timezone)
        elif "update-ui-settings" in request.form:
            if "font-family" in request.form:
                set_setting(g.user, "font", request.form["font-family"])
            if "font-size" in request.form:
                try:
                    set_setting(g.user, "font_size", int(request.form["font-size"]))
                except (ValueError, TypeError):
                    pass
            if "dark-mode" in request.form:
                set_setting(g.user, "dark_mode", request.form["dark-mode"] == "1")
            else:
                set_setting(g.user, "dark_mode", False)
            if "compact-mode" in request.form:
                set_setting(g.user, "compact_mode", request.form["compact-mode"] == "1")
            else:
                set_setting(g.user, "compact_mode", False)
            if "spotlight-mode" in request.form:
                set_setting(g.user, "spotlight_mode", request.form["spotlight-mode"] == "1")
            else:
                set_setting(g.user, "spotlight_mode", False)
            # Daily notes settings
            if "daily-note-enabled" in request.form:
                set_setting(g.user, "daily_note_enabled", True)
            else:
                set_setting(g.user, "daily_note_enabled", False)
            fmt = (request.form.get("daily-note-title-format") or "").strip()
            if fmt:
                set_setting(g.user, "daily_note_title_format", fmt)
            if "daily-note-open-on-start" in request.form:
                set_setting(g.user, "daily_note_open_on_start", True)
            else:
                set_setting(g.user, "daily_note_open_on_start", False)
            placement = request.form.get("calendar-placement", "left")
            if placement not in ("left", "right"):
                placement = "left"
            set_setting(g.user, "calendar_placement", placement)
            # Template id: validate ownership, clear (0) if missing/foreign.
            tmpl_id = 0
            raw_tmpl = request.form.get("daily-note-template-id", "0")
            try:
                tmpl_id = int(raw_tmpl)
            except (ValueError, TypeError):
                tmpl_id = 0
            if tmpl_id and not NoteTemplate.query.filter_by(
                id=tmpl_id, user_id=g.user.id
            ).first():
                tmpl_id = 0
            set_setting(g.user, "daily_note_template_id", tmpl_id)
            # Category id: validate ownership, clear (0) if missing/foreign.
            cat_id = 0
            raw_cat = request.form.get("daily-note-category-id", "0")
            try:
                cat_id = int(raw_cat)
            except (ValueError, TypeError):
                cat_id = 0
            if cat_id and not UserNoteCategory.query.filter_by(
                id=cat_id, user_id=g.user.id
            ).first():
                cat_id = 0
            set_setting(g.user, "daily_note_category_id", cat_id)
            set_setting(g.user, "drawing_enabled", "drawing-enabled" in request.form)
            set_setting(g.user, "attachments_folder_enabled", "attachments-folder-enabled" in request.form)
            set_setting(g.user, "attachments_folder_subcategories", "attachments-folder-subcategories" in request.form)
            for field in ("attachment_max_width", "drawing_max_width"):
                form_key = field.replace("_", "-")
                set_setting(g.user, field, request.form.get(form_key, ""))
            embed_bg_mode = request.form.get("embed-bg-mode", "theme")
            if embed_bg_mode not in ("theme", "solid", "dynamic"):
                embed_bg_mode = "theme"
            set_setting(g.user, "embed_bg_mode", embed_bg_mode)
            embed_bg_color = (request.form.get("embed-bg-color") or "#ffffff").strip()
            if not re.fullmatch(r"#[0-9a-fA-F]{6}", embed_bg_color):
                embed_bg_color = "#ffffff"
            set_setting(g.user, "embed_bg_color", embed_bg_color)
            # Audio recording settings
            set_setting(g.user, "audio_recording_enabled", "audio-recording-enabled" in request.form)
            set_setting(g.user, "audio_echo_cancellation", "audio-echo-cancellation" in request.form)
            set_setting(g.user, "audio_noise_suppression", "audio-noise-suppression" in request.form)
            set_setting(g.user, "audio_auto_gain_control", "audio-auto-gain-control" in request.form)
            device_id = (request.form.get("audio-device-id") or "").strip()
            if len(device_id) <= 200:
                set_setting(g.user, "audio_device_id", device_id)
            try:
                set_setting(g.user, "audio_max_duration_min", int(request.form.get("audio-max-duration-min", "5")))
            except (TypeError, ValueError):
                pass
            mime_pref = request.form.get("audio-mime-preference", "auto")
            if mime_pref not in ("auto", "webm-opus", "mp4-aac"):
                mime_pref = "auto"
            set_setting(g.user, "audio_mime_preference", mime_pref)
            # Text-to-speech settings
            set_setting(g.user, "tts_enabled", "tts-enabled" in request.form)
            set_setting(g.user, "tts_autoplay_ai", "tts-autoplay-ai" in request.form)
            voice_uri = (request.form.get("tts-voice-uri") or "").strip()
            if len(voice_uri) <= 200:
                set_setting(g.user, "tts_voice_uri", voice_uri)
            try:
                tts_rate = float(request.form.get("tts-rate", "1.0"))
                if 0.5 <= tts_rate <= 2.0:
                    set_setting(g.user, "tts_rate", tts_rate)
            except (TypeError, ValueError):
                pass
            try:
                tts_volume = float(request.form.get("tts-volume", "1.0"))
                if 0.0 <= tts_volume <= 1.0:
                    set_setting(g.user, "tts_volume", tts_volume)
            except (TypeError, ValueError):
                pass
            db.session.commit()
        elif "save-editing" in request.form:
            for field in (
                "preview_mode",
                "render_embeds_in_edit_mode",
                "live_preview",
                "hide_title",
                "auto_save",
            ):
                form_key = field.replace("_", "-")
                set_setting(g.user, field, form_key in request.form and request.form[form_key] == "1")
            # Default folder for new notes (validate ownership, clear 0 if
            # missing/foreign).
            def_cat_id = 0
            raw_def_cat = request.form.get("default-category-id", "0")
            try:
                def_cat_id = int(raw_def_cat)
            except (ValueError, TypeError):
                def_cat_id = 0
            if def_cat_id and not UserNoteCategory.query.filter_by(
                id=def_cat_id, user_id=g.user.id
            ).first():
                def_cat_id = 0
            set_setting(g.user, "default_category_id", def_cat_id)
            db.session.commit()
        elif "save-links" in request.form:
            set_setting(
                g.user, "autosuggest_note_links",
                "autosuggest-note-links" in request.form
                and request.form["autosuggest-note-links"] == "1",
            )
            for field, low, high in (
                ("autosuggest_min_chars", 2, 10),
                ("autosuggest_result_cap", 1, 30),
            ):
                form_key = field.replace("_", "-")
                try:
                    v = int(request.form.get(form_key, str(low)))
                except (TypeError, ValueError):
                    v = low
                if not (low <= v <= high):
                    v = low
                set_setting(g.user, field, v)
            set_setting(
                g.user, "autosuggest_show_category",
                "autosuggest-show-category" in request.form
                and request.form["autosuggest-show-category"] == "1",
            )
            set_setting(
                g.user, "autosuggest_ghost_notes",
                "autosuggest-ghost-notes" in request.form
                and request.form["autosuggest-ghost-notes"] == "1",
            )
            set_setting(
                g.user, "autosuggest_ghost_create",
                "autosuggest-ghost-create" in request.form
                and request.form["autosuggest-ghost-create"] == "1",
            )
            algo = request.form.get("autosuggest-algorithm", "title_prefix")
            if algo not in ("title_prefix", "title_substring", "full_search"):
                algo = "title_prefix"
            set_setting(g.user, "autosuggest_algorithm", algo)
            db.session.commit()
        elif "save-layout" in request.form:
            for field in (
                "sidebar_collapsed",
                "right_panel_collapsed",
                "properties_collapsed",
            ):
                form_key = field.replace("_", "-")
                set_setting(g.user, field, form_key in request.form and request.form[form_key] == "1")
            db.session.commit()
        elif "save-widgets" in request.form:
            widgets = get_panel_widgets(g.user)
            for w in widgets:
                w["visible"] = ("widget-" + w["id"]) in request.form
            set_panel_widgets(g.user, widgets)
            db.session.commit()
        elif "save-topbar" in request.form:
            items = get_topbar_items(g.user)
            for it in items:
                it["visible"] = ("topbar-" + it["id"]) in request.form
            set_topbar_items(g.user, items)
            db.session.commit()
        elif "generate-api-token" in request.form:
            token_name = request.form.get("token-name", "").strip()
            if not token_name:
                token_name = "Unnamed Token"
            plaintext, token_hash = generate_api_token()
            new_token = ApiToken(
                user_id=g.user.id, token_hash=token_hash, name=token_name
            )
            db.session.add(new_token)
            db.session.commit()
            if is_fragment:
                tokens = ApiToken.query.filter_by(user_id=g.user.id).all()
                conflicts = (
                    SyncConflict.query.filter_by(user_id=g.user.id, resolved=False)
                    .order_by(SyncConflict.conflict_date.desc())
                    .all()
                )
                ui_settings = get_all_settings(g.user)
                return render_template(
                    "_settings_view.html",
                    timezones=available_timezones(),
                    tokens=tokens,
                    new_token=plaintext,
                    conflicts=conflicts,
                    sync_enabled=settings.obsidian_sync_enabled,
                    ui_settings=ui_settings,
                    custom_colors=get_effective_colors(ui_settings.custom_colors),
                    custom_css=ui_settings.custom_css,
                    panel_widgets=get_panel_widgets(g.user),
                    topbar_items=get_topbar_items(g.user),
                    ai_enabled=settings.ai_enabled,
                    ai_settings=settings,
                    ai_models=_ai_models(g.user),
                    drawing_enabled=get_setting(g.user, "drawing_enabled"),
                )
            return redirect(url_for("web.settings_page") + "?saved=1")
        elif "revoke-api-token" in request.form:
            token_id = request.form.get("token-id")
            token = ApiToken.query.filter_by(id=token_id, user_id=g.user.id).first()
            if token:
                db.session.delete(token)
                db.session.commit()
        elif "toggle-obsidian-sync" in request.form:
            settings.obsidian_sync_enabled = "sync-enabled" in request.form
            db.session.commit()
        elif "toggle-ai" in request.form:
            settings.ai_enabled = "ai-enabled" in request.form
            if not settings.ai_enabled:
                settings.ollama_api_key = None
            db.session.commit()
        elif "update-ai-settings" in request.form:
            api_key = request.form.get("ollama-api-key", "").strip()
            model = request.form.get("ollama-model", "").strip()
            base_url = request.form.get("ollama-base-url", "").strip()
            if api_key:
                settings.ollama_api_key = api_key
            if model:
                settings.ollama_model = model
            if base_url:
                settings.ollama_base_url = base_url
            db.session.commit()
        elif "remove-ai-api-key" in request.form:
            settings.ollama_api_key = None
            db.session.commit()
        elif "update-vault-context-settings" in request.form:
            allowed = "vault-context-allowed" in request.form
            set_setting(g.user, "vault_context_allowed", allowed)
            try:
                top_k = int(request.form.get("vault-context-top-k", "8"))
            except (TypeError, ValueError):
                top_k = 8
            set_setting(g.user, "ai_vault_context_top_k", top_k)
            try:
                max_chars = int(request.form.get("vault-context-max-chars", "20000"))
            except (TypeError, ValueError):
                max_chars = 20000
            set_setting(g.user, "ai_vault_context_max_chars", max_chars)
            db.session.commit()
        elif "resolve-conflict" in request.form:
            conflict_id = request.form.get("conflict-id")
            resolution = request.form.get("resolution")
            conflict = SyncConflict.query.filter_by(
                id=conflict_id, user_id=g.user.id
            ).first()
            if conflict and resolution in ("local", "server"):
                if conflict.note_id:
                    from flasky.services.notes import update_note
                    note = UserNote.query.filter_by(
                        userid=g.user.id, id=conflict.note_id
                    ).first()
                    if note:
                        if resolution == "local":
                            update_note(g.user, note.id,
                                        title=conflict.local_title,
                                        content=conflict.local_content)
                        else:
                            update_note(g.user, note.id,
                                        title=conflict.server_title,
                                        content=conflict.server_content)
                conflict.resolved = True
                db.session.commit()
    if is_fragment:
        tokens = ApiToken.query.filter_by(user_id=g.user.id).all()
        conflicts = (
            SyncConflict.query.filter_by(user_id=g.user.id, resolved=False)
            .order_by(SyncConflict.conflict_date.desc())
            .all()
        )
        ui_settings = get_all_settings(g.user)
        return render_template(
            "_settings_view.html",
            timezones=available_timezones(),
            tokens=tokens,
            conflicts=conflicts,
            sync_enabled=settings.obsidian_sync_enabled,
            ui_settings=ui_settings,
            custom_colors=get_effective_colors(ui_settings.custom_colors),
            custom_css=ui_settings.custom_css,
            panel_widgets=get_panel_widgets(g.user),
            topbar_items=get_topbar_items(g.user),
            ai_enabled=settings.ai_enabled,
            ai_settings=settings,
            ai_models=_ai_models(g.user),
            drawing_enabled=get_setting(g.user, "drawing_enabled"),
        )
    return _render_shell(initial_view="/settings")


@web_bp.route("/register", methods=["GET"])
def register_page():
    return render_template(
        "register.html",
        recaptcha_enabled=CONFIG.RECAPTCHA_ENABLED,
        recaptcha_site_key=current_app.config.get("RECAPTCHA_SITE_KEY", ""),
    )


@web_bp.route("/login", methods=["GET"])
def login_page():
    return render_template("login.html")


@web_bp.route("/logout")
@login_required_page
def logout():
    session.pop("user_id", None)
    return redirect(url_for("web.login_page"))


@web_bp.route("/notes")
@login_required_page
def notes_page():
    # Single UI: no notes listing page — always go straight to the editor.
    # If daily notes are enabled with open-on-start, signal the client to open
    # today's daily note instead of a blank note.
    if get_setting(g.user, "daily_note_enabled") and get_setting(
        g.user, "daily_note_open_on_start"
    ):
        return redirect(url_for("web.note_single_page", note_id=0, daily=1))
    return redirect(url_for("web.note_single_page", note_id=0))


@web_bp.route("/daily")
@login_required_page
def daily_page():
    # Bookmarkable route: redirect into the editor with the daily flag set so
    # the client opens (or creates) today's daily note. Note lookup is
    # client-side because titles are E2EE ciphertext the server can't read.
    return redirect(url_for("web.note_single_page", note_id=0, daily=1))


@web_bp.route("/note/<int:note_id>", methods=["GET"])
@login_required_page
def note_single_page(note_id):
    ui_settings = get_all_settings(g.user)
    font_size = ui_settings.font_size
    note = UserNote.query.filter_by(id=note_id).first()
    if note and note is not None:
        if g.user != note.user:
            return "You do not own this note. Click here to go to your <a href='/notes'>notes</a>."
    category = request.args.get("category")
    category_id = request.args.get("category_id", type=int)
    default_template = None
    if note_id == 0 and (category or category_id):
        if category_id:
            cat_obj = UserNoteCategory.query.filter_by(
                user_id=g.user.id, id=category_id
            ).first()
        else:
            cat_obj = UserNoteCategory.query.filter_by(
                user_id=g.user.id, name=category
            ).first()
        if cat_obj:
            category = cat_obj.name
            if cat_obj.default_template_id:
                default_template = NoteTemplate.query.get(cat_obj.default_template_id)
    # For a new note with no explicit folder, fall back to the user's default
    # category so the breadcrumb shows the folder new notes will land in.
    default_category = g.user.get_default_category()
    if note_id == 0 and not category and not category_id:
        if default_category:
            category = default_category.name
            category_id = default_category.id
    panel_widgets = get_panel_widgets(g.user)
    topbar_items = get_topbar_items(g.user)
    # Embed encrypted note data as JSON for client-side decryption.
    # With mandatory E2EE this is always ciphertext; build it whenever a note exists.
    encrypted_note_data = None
    if note:
        encrypted_note_data = json.dumps(
            {
                "title": note.title,
                "content": note.content,
                "properties": note.properties,
                "previous_content": note.previous_content,
                "category_id": note.category_id,
            }
        )
    return render_template(
        "note_single.html",
        note=note,
        note_id=note_id,
        font_size=font_size,
        category=category,
        category_id=category_id,
        ui_settings=ui_settings,
        custom_colors=get_effective_colors(ui_settings.custom_colors),
        custom_css=ui_settings.custom_css,
        default_template=default_template,
        default_category_id=(default_category.id if default_category else 0),
        panel_widgets=panel_widgets,
        topbar_items=topbar_items,
        encrypted_note_data=encrypted_note_data,
        ai_settings=g.user.settings if g.user else None,
        ai_models=_ai_models(g.user),
        timezone=g.user.get_timezone(as_str=True),
        daily=request.args.get("daily", type=int) or 0,
        initial_view=None,
    )


@web_bp.route("/search")
@login_required_page
def search_page():
    # Search is client-side for E2EE; the server cannot read ciphertext to
    # search. The search modal lives inside the note editor UI, so redirect
    # there. (Keep the route for clients that hit /search directly.)
    return redirect(url_for("web.note_single_page", note_id=0))


@web_bp.route("/agenda")
@login_required_page
def agenda_page():
    if request.args.get("_fragment") == "1":
        settings = g.user.return_settings()
        ai_enabled = settings.ai_enabled if settings else False
        events = (
            UserEvent.query.filter_by(userid=g.user.id)
            .filter(UserEvent.date_of_event > (datetime.utcnow() - timedelta(days=1)))
            .order_by(UserEvent.date_of_event.asc())
            .all()
        )
        events += UserEvent.query.filter_by(userid=g.user.id, date_of_event=None).all()
        todos = (
            UserTodo.query.filter_by(userid=g.user.id, archived=False)
            .filter(UserTodo.date_due != None)
            .order_by(UserTodo.date_due.asc())
            .all()
        )
        todos += (
            UserTodo.query.filter_by(userid=g.user.id, archived=False)
            .filter(UserTodo.date_due == None)
            .all()
        )
        return render_template(
            "_agenda_view.html",
            todos=todos,
            events=events,
            ai_enabled=ai_enabled,
            ai_settings=settings,
            ai_models=_ai_models(g.user),
        )
    return _render_shell(initial_view="/agenda")


@web_bp.route("/manifest.json")
def manifest_json():
    return redirect("/static/script/manifest.json")


@web_bp.route("/attachment/<int:attachment_id>/<filename>")
@login_required
def serve_attachment(attachment_id, filename):
    """Serve an attachment. With mandatory E2EE, files are always stored as
    encrypted blobs on disk; the server returns opaque bytes and the client
    decrypts them.
    """
    a = Attachment.query.filter_by(id=attachment_id, user_id=g.user.id).first()
    if a is None:
        return "Not found", 404
    disk = a.disk_path()
    if not os.path.exists(disk):
        return "Not found", 404
    with open(disk, "rb") as f:
        data = f.read()
    response = make_response(data)
    response.headers["Content-Type"] = "application/octet-stream"
    response.headers["X-Encrypted"] = "true"
    return response


@web_bp.route("/export")
@login_required_page
def export_page():
    if request.args.get("_fragment") == "1":
        return render_template("_export_view.html")
    return _render_shell(initial_view="/export")


@web_bp.route("/api/export/notes")
@login_required
def export_notes_api():
    """Return all notes with full content for export.

    With mandatory E2EE, content/title/properties are always opaque ciphertext;
    the client decrypts after download. The encrypted flag is always True and
    kept for client compatibility.
    """
    notes = UserNote.query.filter_by(userid=g.user.id).all()
    attachments = Attachment.query.filter_by(user_id=g.user.id).all()
    result = []
    for note in notes:
        result.append(
            {
                "id": note.id,
                "title": note.title,
                "content": note.content,
                "properties": note.properties,  # opaque ciphertext
                "category": note.get_category_name(),
            }
        )
    att_list = [{"id": a.id, "filename": a.filename} for a in attachments]
    return jsonify(notes=result, attachments=att_list, encrypted=True)