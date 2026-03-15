from flask import Blueprint, request, jsonify
import bcrypt

from flasky.models import User, UserNote

external_api_bp = Blueprint('external_api', __name__, url_prefix='/api/external')


@external_api_bp.route("/get-notes", methods=['POST'])
def get_notes_external_api():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    try:
        limit = int(data.get('limit'))
    except:
        limit = None
    if username is None or password is None:
        return jsonify(success=False,reason="Missing username or password.")
    user = User.query.filter_by(username=username).first()
    if user:
        if not bcrypt.checkpw(str(password).encode('utf-8'),user.password):
            return jsonify(success=False,reason="Incorrect password.")
    else:
        return jsonify(success=False,reason="User does not exist.")
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
    username = data.get('username')
    password = data.get('password')
    try:
        note_id = int(data.get('note-id'))
    except:
        return jsonify(success=False,reason="Invalid or missing note id.")
    if username is None or password is None:
        return jsonify(success=False,reason="Missing username or password.")
    user = User.query.filter_by(username=username).first()
    if user:
        if not bcrypt.checkpw(str(password).encode('utf-8'),user.password):
            return jsonify(success=False,reason="Incorrect password.")
    else:
        return jsonify(success=False,reason="User does not exist.")
    note = UserNote.query.filter_by(userid=user.id,id=note_id).first()
    if note:
        return jsonify(success=True, note=note.return_json())
    else:
        return jsonify(success=False,reason="Note does not exist.")

@external_api_bp.route("/add-note", methods=['POST'])
def add_note_external_api():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    title = data.get('title')
    content = data.get('content')
    category = data.get('category')
    if username is None or password is None:
        return jsonify(success=False,reason="Missing username or password.")
    user = User.query.filter_by(username=username).first()
    if user:
        if not bcrypt.checkpw(str(password).encode('utf-8'),user.password):
            return jsonify(success=False,reason="Incorrect password.")
    else:
        return jsonify(success=False,reason="User does not exist.")
    if title is None:
        title = ""
    if content is None:
        content = ""
    if category is None:
        category = ""
    note = user.add_note(title,content,category)
    if note:
        return jsonify(success=True, note=note.return_json())
    else:
        return jsonify(success=False, reason="Could not add note.")

@external_api_bp.route("/edit-note", methods=['POST'])
def edit_note_external_api():
    data = request.get_json()
    username = data.get('username', None)
    password = data.get('password', None)
    note_id = data.get('note-id', None)
    title = data.get('title', None)
    content = data.get('content', None)
    category = data.get('category', None)
    if username is None or password is None:
        return jsonify(success=False,reason="Missing username or password.")
    if note_id is None:
        return jsonify(success=False,reason="Missing note id.")
    user = User.query.filter_by(username=username).first()
    if user:
        if not bcrypt.checkpw(str(password).encode('utf-8'),user.password):
            return jsonify(success=False,reason="Incorrect password.")
    else:
        return jsonify(success=False,reason="User does not exist.")
    note = UserNote.query.filter_by(userid=user.id,id=note_id).first()
    if note and note is not None:
        if title is not None:
            note.change_title(title)
        if content is not None:
            if note.content != content:
                note.change_content(content)
        if category is not None:
            note.change_category(category)
        return jsonify(success=True, note=note.return_json())
    else:
        return jsonify(success=False,reason="Note does not exist.")
