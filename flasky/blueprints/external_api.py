from flask import Blueprint, request, jsonify
import bcrypt

from flasky.models import User, UserNote
from flasky.utils import login_limiter

external_api_bp = Blueprint('external_api', __name__, url_prefix='/api/external')

# Pre-computed dummy hash for constant-time response when user not found
_DUMMY_BCRYPT_HASH = bcrypt.hashpw(b'dummy', bcrypt.gensalt())


def _authenticate_user(data):
    """Authenticate user via auth_key (E2EE) or legacy password."""
    if login_limiter.is_limited():
        return None, "Too many login attempts. Try again later."
    username = (data.get('username') or '').lower().strip()
    # Support both auth_key (E2EE) and password (legacy)
    auth_key = data.get('auth_key') or data.get('password')
    if not username or not auth_key:
        return None, "Missing username or credentials."
    user = User.query.filter_by(username=username).first()
    if not user:
        bcrypt.checkpw(b'dummy', _DUMMY_BCRYPT_HASH)
        login_limiter.record()
        return None, "Invalid credentials."
    if not bcrypt.checkpw(str(auth_key).encode('utf-8'), user.password):
        login_limiter.record()
        return None, "Invalid credentials."
    return user, None


@external_api_bp.route("/get-notes", methods=['POST'])
def get_notes_external_api():
    data = request.get_json()
    user, err = _authenticate_user(data)
    if err:
        return jsonify(success=False, reason=err)
    try:
        limit = int(data.get('limit'))
    except:
        limit = None
    notes = []
    notes_q = UserNote.query.filter_by(userid=user.id).order_by(UserNote.date_last_changed.desc())
    if limit:
        notes_q = notes_q.limit(limit)
    for note in notes_q.all():
        notes.append(note.return_json())
    return jsonify(notes)

@external_api_bp.route("/get-note", methods=['POST'])
def get_note_external_api():
    data = request.get_json()
    user, err = _authenticate_user(data)
    if err:
        return jsonify(success=False, reason=err)
    try:
        note_id = int(data.get('note-id'))
    except:
        return jsonify(success=False, reason="Invalid or missing note id.")
    note = UserNote.query.filter_by(userid=user.id, id=note_id).first()
    if note:
        return jsonify(success=True, note=note.return_json())
    else:
        return jsonify(success=False, reason="Note does not exist.")

@external_api_bp.route("/add-note", methods=['POST'])
def add_note_external_api():
    data = request.get_json()
    user, err = _authenticate_user(data)
    if err:
        return jsonify(success=False, reason=err)
    title = data.get('title', '')
    content = data.get('content', '')
    category = data.get('category', '')
    # E2EE: caller must send pre-encrypted data
    note = user.add_note(title, content, category, encrypted=user.encryption_enabled)
    if note:
        return jsonify(success=True, note=note.return_json())
    else:
        return jsonify(success=False, reason="Could not add note.")

@external_api_bp.route("/edit-note", methods=['POST'])
def edit_note_external_api():
    data = request.get_json()
    user, err = _authenticate_user(data)
    if err:
        return jsonify(success=False, reason=err)
    note_id = data.get('note-id')
    if note_id is None:
        return jsonify(success=False, reason="Missing note id.")
    title = data.get('title')
    content = data.get('content')
    category = data.get('category')
    note = UserNote.query.filter_by(userid=user.id, id=note_id).first()
    if note:
        encrypted = user.encryption_enabled
        if title is not None:
            note.change_title(title)
        if content is not None:
            if note.content != content:
                note.change_content(content, encrypted=encrypted)
        if category is not None:
            note.change_category(category)
        return jsonify(success=True, note=note.return_json())
    else:
        return jsonify(success=False, reason="Note does not exist.")
