import re
import secrets
import hashlib
import json
import datetime as dt
from functools import wraps

import yaml
from flask import request, jsonify, g


_FRONTMATTER_RE = re.compile(r'^---\n(.*?)\n---\n', re.DOTALL)

# Keys the sync script uses locally — never stored in server properties
_SYNC_META_KEYS = {'flasky_id', 'flasky_hash', 'conflict_source'}


def has_banned_chars(text):
    if text.isalnum():
        return False
    else:
        return True

def valid_email(email):
    reg = r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'
    if(re.fullmatch(reg, email)):
        return True
    else:
        return False

def generate_api_token():
    plaintext = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(plaintext.encode('utf-8')).hexdigest()
    return plaintext, token_hash

def content_hash(content):
    if content is None:
        content = ""
    return hashlib.sha256(content.encode('utf-8')).hexdigest()

def _make_json_safe(val):
    """Convert YAML-parsed values to JSON-safe types."""
    if isinstance(val, (dt.date, dt.datetime)):
        return val.isoformat()
    if isinstance(val, list):
        return [_make_json_safe(v) for v in val]
    if isinstance(val, dict):
        return {k: _make_json_safe(v) for k, v in val.items()}
    return val

def parse_note_frontmatter(text):
    """Split text into (properties_dict, body). Strips sync-only keys."""
    if not text:
        return {}, text or ""
    m = _FRONTMATTER_RE.match(text)
    if not m:
        return {}, text
    try:
        raw = yaml.safe_load(m.group(1))
        if not isinstance(raw, dict):
            return {}, text
    except yaml.YAMLError:
        return {}, text
    props = {k: _make_json_safe(v) for k, v in raw.items() if k not in _SYNC_META_KEYS}
    body = text[m.end():]
    return props, body

def build_note_frontmatter(props):
    """Build a YAML frontmatter string from a dict."""
    if not props:
        return ""
    # Use yaml.dump for proper list/nested value formatting
    dumped = yaml.dump(props, default_flow_style=False, allow_unicode=True, sort_keys=False)
    return f"---\n{dumped}---\n"

def content_with_frontmatter(content, properties_json):
    """Reconstruct full text with frontmatter prepended."""
    props = {}
    if properties_json:
        try:
            props = json.loads(properties_json)
        except (json.JSONDecodeError, TypeError):
            pass
    fm = build_note_frontmatter(props)
    return fm + (content or "")

def format_utc_iso(dt_val):
    if dt_val is None:
        return None
    return dt_val.strftime('%Y-%m-%dT%H:%M:%SZ')

def require_sync_token(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        from flasky.models import ApiToken
        from flasky import db
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return jsonify(error="Missing or invalid Authorization header"), 401
        token = auth_header[7:]
        token_hash = hashlib.sha256(token.encode('utf-8')).hexdigest()
        api_token = ApiToken.query.filter_by(token_hash=token_hash).first()
        if api_token is None:
            return jsonify(error="Invalid token"), 401
        from datetime import datetime
        api_token.last_used_at = datetime.utcnow()
        db.session.commit()
        g.sync_user = api_token.user
        return f(*args, **kwargs)
    return decorated
