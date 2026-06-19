import re
import secrets
import hashlib
import time
import threading
from functools import wraps

from flask import request, jsonify, g, redirect, url_for


# ============ In-memory rate limiter ============


class RateLimiter:
    """Simple in-memory rate limiter keyed by IP address."""

    def __init__(self, max_attempts, window_seconds):
        self.max_attempts = max_attempts
        self.window = window_seconds
        self._attempts = {}  # ip -> [timestamp, ...]
        self._lock = threading.Lock()

    def _cleanup(self, key):
        cutoff = time.monotonic() - self.window
        self._attempts[key] = [t for t in self._attempts.get(key, []) if t > cutoff]

    def is_limited(self, key=None):
        if key is None:
            key = request.remote_addr or "0.0.0.0"
        with self._lock:
            self._cleanup(key)
            return len(self._attempts.get(key, [])) >= self.max_attempts

    def record(self, key=None):
        if key is None:
            key = request.remote_addr or "0.0.0.0"
        with self._lock:
            self._cleanup(key)
            self._attempts.setdefault(key, []).append(time.monotonic())


# 5 attempts per 15 minutes for recovery endpoints
recovery_limiter = RateLimiter(max_attempts=5, window_seconds=900)
# 10 attempts per 5 minutes for login
login_limiter = RateLimiter(max_attempts=10, window_seconds=300)
# 20 failed attempts per 15 minutes for sync API token auth
sync_token_limiter = RateLimiter(max_attempts=20, window_seconds=900)


def has_banned_chars(text):
    if text.isalnum():
        return False
    else:
        return True


def valid_email(email):
    reg = r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b"
    if re.fullmatch(reg, email):
        return True
    else:
        return False


def generate_api_token():
    plaintext = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(plaintext.encode("utf-8")).hexdigest()
    return plaintext, token_hash


def content_hash(content):
    if content is None:
        content = ""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def format_utc_iso(dt_val):
    if dt_val is None:
        return None
    return dt_val.strftime("%Y-%m-%dT%H:%M:%SZ")


def require_sync_token(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        from flasky.models import ApiToken
        from flasky import db

        if sync_token_limiter.is_limited():
            return jsonify(error="Too many failed attempts. Try again later."), 429
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            sync_token_limiter.record()
            return jsonify(error="Missing or invalid Authorization header"), 401
        token = auth_header[7:]
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        api_token = ApiToken.query.filter_by(token_hash=token_hash).first()
        if api_token is None:
            sync_token_limiter.record()
            return jsonify(error="Invalid token"), 401
        from datetime import datetime

        api_token.last_used_at = datetime.utcnow()
        db.session.commit()
        g.sync_user = api_token.user
        return f(*args, **kwargs)

    return decorated


def login_required(f):
    """Decorator for API routes: returns 401 JSON if not authenticated."""

    @wraps(f)
    def decorated(*args, **kwargs):
        if not g.user:
            return jsonify(error="Not logged in."), 401
        return f(*args, **kwargs)

    return decorated


def login_required_page(f):
    """Decorator for page routes: redirects to login if not authenticated."""

    @wraps(f)
    def decorated(*args, **kwargs):
        if not g.user:
            return redirect(url_for("web.login_page"))
        return f(*args, **kwargs)

    return decorated


def require_note_owner(f):
    """Decorator that loads a note by <note_id> path arg and verifies ownership.

    Use on routes with an <int:note_id> path parameter. On success, the note is
    passed to the handler as `note=` (and the original note_id kwarg is kept).
    Returns 404 JSON if the note doesn't exist, 403 if not owned.
    """

    @wraps(f)
    def decorated(*args, **kwargs):
        from flasky.services.notes import NoteNotFound, NotOwner, get_owned_note

        note_id = kwargs.get("note_id")
        if note_id is None:
            return jsonify(error="Missing note_id"), 400
        try:
            note = get_owned_note(g.user, note_id)
        except NoteNotFound:
            return jsonify(error="Note not found."), 404
        except NotOwner:
            return jsonify(error="Not allowed."), 403
        kwargs["note"] = note
        return f(*args, **kwargs)

    return decorated


def register_error_handlers(app):
    """Register central JSON error handlers on the app. Routes that raise
    service-layer exceptions (NoteNotFound, NotOwner, CategoryNotFound, etc.)
    get a consistent JSON response without each route needing its own try/except.
    """

    @app.errorhandler(400)
    def _bad_request(err):
        return jsonify(error=str(err) or "Bad request."), 400

    @app.errorhandler(403)
    def _forbidden(err):
        return jsonify(error=str(err) or "Forbidden."), 403

    @app.errorhandler(404)
    def _not_found(err):
        return jsonify(error=str(err) or "Not found."), 404

    @app.errorhandler(422)
    def _unprocessable(err):
        # flask-smorest / marshmallow validation errors carry .messages
        # (a dict of field -> error list). Surface them in the response.
        messages = getattr(err, "messages", None)
        if messages is None:
            # Some flask-smorest versions wrap the validation error in a
            # .data attribute or .args[0]; try those too.
            data = getattr(err, "data", None)
            if data and isinstance(data, dict):
                messages = data.get("messages") or data.get("errors")
            if messages is None and err.args:
                messages = err.args[0]
        return jsonify(error="Validation failed.", details=messages), 422

    @app.errorhandler(500)
    def _server_error(err):
        return jsonify(error="Internal server error."), 500


def verify_recaptcha(token):
    """Verify a reCAPTCHA v2/v3 token with Google's API. Returns True if valid."""
    if not token:
        return False
    try:
        import requests as req_lib
        from flask import current_app

        secret = current_app.config.get("RECAPTCHA_SECRET_KEY", "")
        if not secret:
            return False
        resp = req_lib.post(
            "https://www.google.com/recaptcha/api/siteverify",
            data={"secret": secret, "response": token},
            timeout=10,
        )
        return resp.json().get("success", False)
    except Exception:
        return False