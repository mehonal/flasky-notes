from flask import Blueprint, request, g, jsonify, send_from_directory, current_app
import os
import hashlib

from flasky import db
from flasky.models import UserNote, SyncConflict, Attachment
from flasky.utils import require_sync_token, content_hash, format_utc_iso

sync_api_bp = Blueprint('sync_api', __name__, url_prefix='/api/sync')


def _note_manifest_entry(note):
    """Build a manifest entry for a note. With mandatory E2EE the server hashes
    the ciphertext (not reconstructed frontmatter) and returns the encrypted
    title/category as-is. The client decrypts and compares after download.
    """
    return {
        "id": note.id,
        "title": note.title,
        "category": note.get_category_name(),
        "content_hash": content_hash(note.content or ''),
        "properties_hash": content_hash(note.properties or ''),
        "icon": note.icon,
        "icon_color": note.icon_color,
        "date_added_utc": format_utc_iso(note.date_added),
        "date_last_changed_utc": format_utc_iso(note.date_last_changed),
        "encrypted": True,
    }


@sync_api_bp.route("/manifest", methods=['GET'])
@require_sync_token
def sync_manifest():
    notes = UserNote.query.filter_by(
        userid=g.sync_user.id
    ).order_by(UserNote.date_last_changed.desc()).all()
    return jsonify([_note_manifest_entry(n) for n in notes])


@sync_api_bp.route("/note/<int:note_id>", methods=['GET'])
@require_sync_token
def sync_get_note(note_id):
    note = UserNote.query.filter_by(userid=g.sync_user.id, id=note_id).first()
    if note is None:
        return jsonify(error="Note not found"), 404
    return jsonify({
        "id": note.id,
        "title": note.title,
        "content": note.content,
        "properties": note.properties,
        "category": note.get_category_name(),
        "content_hash": content_hash(note.content or ''),
        "icon": note.icon,
        "icon_color": note.icon_color,
        "date_added_utc": format_utc_iso(note.date_added),
        "date_last_changed_utc": format_utc_iso(note.date_last_changed),
        "encrypted": True,
    })


@sync_api_bp.route("/note", methods=['POST'])
@require_sync_token
def sync_create_note():
    data = request.get_json()
    if data is None:
        return jsonify(error="Request body must be JSON"), 400
    title = data.get('title', '')
    content = data.get('content', '')
    category = data.get('category', '')
    from flasky.services.notes import create_note
    from flasky.services.categories import get_or_create_main_category
    if not category:
        category = get_or_create_main_category(g.sync_user).id
    try:
        note = create_note(
            g.sync_user, title, content, category,
            properties=data.get('properties'),
            icon=data.get('icon'),
            icon_color=data.get('icon_color'),
        )
    except ValueError:
        return jsonify(error="Could not create note"), 500
    return jsonify({
        "id": note.id,
        "title": note.title,
        "content": note.content,
        "properties": note.properties,
        "category": note.get_category_name(),
        "content_hash": content_hash(note.content or ''),
        "icon": note.icon,
        "icon_color": note.icon_color,
        "date_added_utc": format_utc_iso(note.date_added),
        "date_last_changed_utc": format_utc_iso(note.date_last_changed),
        "encrypted": True,
    }), 201


@sync_api_bp.route("/note/<int:note_id>", methods=['PUT'])
@require_sync_token
def sync_update_note(note_id):
    data = request.get_json()
    if data is None:
        return jsonify(error="Request body must be JSON"), 400
    from flasky.services.notes import update_note, NoteNotFound, NotOwner
    try:
        note = update_note(
            g.sync_user, note_id,
            title=data.get('title') if 'title' in data else None,
            content=data.get('content') if 'content' in data else None,
            category=data.get('category') if 'category' in data else None,
            properties=data.get('properties') if 'properties' in data else None,
            icon=data.get('icon') if 'icon' in data else None,
            icon_color=data.get('icon_color') if 'icon_color' in data else None,
        )
    except NoteNotFound:
        return jsonify(error="Note not found"), 404
    except NotOwner:
        return jsonify(error="Note not found"), 404
    return jsonify({
        "id": note.id,
        "title": note.title,
        "content": note.content,
        "properties": note.properties,
        "category": note.get_category_name(),
        "content_hash": content_hash(note.content or ''),
        "icon": note.icon,
        "icon_color": note.icon_color,
        "date_added_utc": format_utc_iso(note.date_added),
        "date_last_changed_utc": format_utc_iso(note.date_last_changed),
        "encrypted": True,
    })


@sync_api_bp.route("/note/<int:note_id>", methods=['DELETE'])
@require_sync_token
def sync_delete_note(note_id):
    from flasky.services.notes import delete_note
    success = delete_note(g.sync_user, note_id)
    if success:
        return jsonify(success=True)
    else:
        return jsonify(error="Note not found"), 404


@sync_api_bp.route("/conflict", methods=['POST'])
@require_sync_token
def sync_report_conflict():
    data = request.get_json()
    if data is None:
        return jsonify(error="Request body must be JSON"), 400
    conflict = SyncConflict(
        user_id=g.sync_user.id,
        note_id=data.get('note_id'),
        local_title=data.get('local_title', ''),
        local_content=data.get('local_content', ''),
        server_title=data.get('server_title', ''),
        server_content=data.get('server_content', ''),
        category=data.get('category', ''),
    )
    db.session.add(conflict)
    db.session.commit()
    return jsonify({"id": conflict.id}), 201


@sync_api_bp.route("/conflicts", methods=['GET'])
@require_sync_token
def sync_list_conflicts():
    conflicts = (
        SyncConflict.query
        .filter_by(user_id=g.sync_user.id, resolved=False)
        .order_by(SyncConflict.conflict_date.desc())
        .all()
    )
    result = []
    for c in conflicts:
        result.append({
            "id": c.id,
            "note_id": c.note_id,
            "local_title": c.local_title,
            "server_title": c.server_title,
            "category": c.category,
            "conflict_date": format_utc_iso(c.conflict_date),
            "resolved": c.resolved,
        })
    return jsonify(result)


@sync_api_bp.route("/attachments", methods=['GET'])
@require_sync_token
def sync_attachment_manifest():
    attachments = Attachment.query.filter_by(user_id=g.sync_user.id).all()
    result = []
    for a in attachments:
        result.append({
            "id": a.id,
            "filename": a.filename,
            "content_type": a.content_type,
            "file_hash": a.file_hash,
            "file_size": a.file_size,
        })
    return jsonify(result)


@sync_api_bp.route("/attachment/<int:attachment_id>", methods=['GET'])
@require_sync_token
def sync_download_attachment(attachment_id):
    a = Attachment.query.filter_by(id=attachment_id, user_id=g.sync_user.id).first()
    if a is None:
        return jsonify(error="Attachment not found"), 404
    disk = a.disk_path()
    if not os.path.exists(disk):
        return jsonify(error="Attachment file missing"), 404
    # With mandatory E2EE the on-disk bytes are an opaque encrypted blob; the
    # sync client fetches them and decrypts locally.
    return send_from_directory(
        os.path.dirname(disk),
        os.path.basename(disk),
        mimetype="application/octet-stream",
        as_attachment=True,
        download_name=a.filename,
    )


@sync_api_bp.route("/attachment", methods=['POST'])
@require_sync_token
def sync_upload_attachment():
    if 'file' not in request.files:
        return jsonify(error="No file part"), 400
    f = request.files['file']
    if not f.filename:
        return jsonify(error="No filename"), 400
    data = f.read()
    file_hash = hashlib.sha256(data).hexdigest()
    # Deduplicate by (hash, filename). With E2EE the filename is itself
    # opaque ciphertext, so the same plaintext file uploaded twice with the
    # same client produces the same (encrypted) filename and bytes.
    existing = Attachment.query.filter_by(
        user_id=g.sync_user.id, file_hash=file_hash, filename=f.filename
    ).first()
    if existing:
        return jsonify({
            "id": existing.id,
            "filename": existing.filename,
            "file_hash": existing.file_hash,
            "file_size": existing.file_size,
        }), 200
    # With mandatory E2EE, the bytes and filename are opaque ciphertext; the
    # server never interprets content_type. Store a generic type so the column
    # is populated and downstream tools can recognize it as encrypted.
    attachment = Attachment(
        user_id=g.sync_user.id,
        filename=f.filename,
        content_type="application/octet-stream",
        file_hash=file_hash,
        file_size=len(data),
    )
    db.session.add(attachment)
    db.session.commit()
    attachment_dir = current_app.config['ATTACHMENT_DIR']
    user_dir = os.path.join(attachment_dir, str(g.sync_user.id))
    os.makedirs(user_dir, exist_ok=True)
    disk = attachment.disk_path()
    with open(disk, 'wb') as out:
        out.write(data)
    return jsonify({
        "id": attachment.id,
        "filename": attachment.filename,
        "file_hash": attachment.file_hash,
        "file_size": attachment.file_size,
    }), 201


@sync_api_bp.route("/encryption_info", methods=['GET'])
@require_sync_token
def sync_encryption_info():
    """Return the wrapped symmetric key + version for the sync client.

    Encryption is mandatory, so encryption_enabled is always True and is not
    included in the response. The client derives the KEK from the user's
    password + key_salt and unwraps encrypted_sym_key to recover the
    symmetric key.
    """
    return jsonify({
        "encrypted_sym_key": g.sync_user.encrypted_symmetric_key,
        "encryption_version": g.sync_user.encryption_version,
    })


@sync_api_bp.route("/resolve-link", methods=['GET'])
@require_sync_token
def sync_resolve_link():
    title = request.args.get('title', '').strip()
    if not title:
        return jsonify(error="Missing 'title' parameter"), 400
    # With mandatory E2EE the client sends the already-encrypted title it wants
    # resolved; the server does a byte-equal comparison (case-insensitive) to
    # find the matching note.
    notes = UserNote.query.filter_by(userid=g.sync_user.id).all()
    lowered = title.lower()
    for note in notes:
        if note.title and note.title.lower() == lowered:
            return jsonify({
                "id": note.id,
                "title": note.title,
                "category": note.get_category_name(),
            })
    return jsonify(error="Note not found"), 404