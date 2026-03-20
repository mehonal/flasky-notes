from flask import Blueprint, request, g, jsonify, send_from_directory, current_app
import os
import hashlib
import mimetypes

from flasky import db
from flasky.models import UserNote, SyncConflict, Attachment
from flasky.utils import require_sync_token, content_hash, format_utc_iso

sync_api_bp = Blueprint('sync_api', __name__, url_prefix='/api/sync')


@sync_api_bp.route("/manifest", methods=['GET'])
@require_sync_token
def sync_manifest():
    notes = UserNote.query.filter_by(userid=g.sync_user.id).order_by(UserNote.date_last_changed.desc()).all()
    encrypted = g.sync_user.encryption_enabled
    manifest = []
    for note in notes:
        if encrypted:
            # E2EE: hash the ciphertext, return encrypted title/category
            manifest.append({
                "id": note.id,
                "title": note.title,
                "category": note.get_category_name(),
                "content_hash": content_hash(note.content or ''),
                "properties_hash": content_hash(note.properties or ''),
                "icon": note.icon,
                "icon_color": note.icon_color,
                "date_added_utc": format_utc_iso(note.date_added),
                "date_last_changed_utc": format_utc_iso(note.date_last_changed),
                "encrypted": True
            })
        else:
            full = note.get_full_content()
            manifest.append({
                "id": note.id,
                "title": note.title,
                "category": note.get_category_name(),
                "content_hash": content_hash(full),
                "icon": note.icon,
                "icon_color": note.icon_color,
                "date_added_utc": format_utc_iso(note.date_added),
                "date_last_changed_utc": format_utc_iso(note.date_last_changed)
            })
    return jsonify(manifest)

@sync_api_bp.route("/note/<int:note_id>", methods=['GET'])
@require_sync_token
def sync_get_note(note_id):
    note = UserNote.query.filter_by(userid=g.sync_user.id, id=note_id).first()
    if note is None:
        return jsonify(error="Note not found"), 404
    encrypted = g.sync_user.encryption_enabled
    if encrypted:
        # E2EE: return encrypted content as-is (no frontmatter reconstruction)
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
            "encrypted": True
        })
    full = note.get_full_content()
    return jsonify({
        "id": note.id,
        "title": note.title,
        "content": full,
        "category": note.get_category_name(),
        "content_hash": content_hash(full),
        "icon": note.icon,
        "icon_color": note.icon_color,
        "date_added_utc": format_utc_iso(note.date_added),
        "date_last_changed_utc": format_utc_iso(note.date_last_changed)
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
    encrypted = g.sync_user.encryption_enabled
    note = g.sync_user.add_note(title, content, category, encrypted=encrypted)
    if not note:
        return jsonify(error="Could not create note"), 500
    if data.get('icon'):
        note.icon = data['icon']
    if data.get('icon_color'):
        note.icon_color = data['icon_color']
    if encrypted:
        if data.get('properties'):
            note.properties = data['properties']
        db.session.commit()
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
            "encrypted": True
        }), 201
    db.session.commit()
    full = note.get_full_content()
    return jsonify({
        "id": note.id,
        "title": note.title,
        "content": full,
        "category": note.get_category_name(),
        "content_hash": content_hash(full),
        "icon": note.icon,
        "icon_color": note.icon_color,
        "date_added_utc": format_utc_iso(note.date_added),
        "date_last_changed_utc": format_utc_iso(note.date_last_changed)
    }), 201

@sync_api_bp.route("/note/<int:note_id>", methods=['PUT'])
@require_sync_token
def sync_update_note(note_id):
    note = UserNote.query.filter_by(userid=g.sync_user.id, id=note_id).first()
    if note is None:
        return jsonify(error="Note not found"), 404
    data = request.get_json()
    if data is None:
        return jsonify(error="Request body must be JSON"), 400
    encrypted = g.sync_user.encryption_enabled
    if 'title' in data:
        note.change_title(data['title'])
    if 'content' in data:
        note.change_content(data['content'], encrypted=encrypted)
    if 'category' in data:
        note.change_category(data['category'])
    if 'icon' in data:
        note.icon = data['icon']
    if 'icon_color' in data:
        note.icon_color = data['icon_color']
    if encrypted:
        if 'properties' in data:
            note.properties = data['properties']
        db.session.commit()
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
            "encrypted": True
        })
    db.session.commit()
    full = note.get_full_content()
    return jsonify({
        "id": note.id,
        "title": note.title,
        "content": full,
        "category": note.get_category_name(),
        "content_hash": content_hash(full),
        "icon": note.icon,
        "icon_color": note.icon_color,
        "date_added_utc": format_utc_iso(note.date_added),
        "date_last_changed_utc": format_utc_iso(note.date_last_changed)
    })

@sync_api_bp.route("/note/<int:note_id>", methods=['DELETE'])
@require_sync_token
def sync_delete_note(note_id):
    success = g.sync_user.delete_note(note_id)
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
        category=data.get('category', '')
    )
    db.session.add(conflict)
    db.session.commit()
    return jsonify({"id": conflict.id}), 201

@sync_api_bp.route("/conflicts", methods=['GET'])
@require_sync_token
def sync_list_conflicts():
    conflicts = SyncConflict.query.filter_by(user_id=g.sync_user.id, resolved=False).order_by(SyncConflict.conflict_date.desc()).all()
    result = []
    for c in conflicts:
        result.append({
            "id": c.id,
            "note_id": c.note_id,
            "local_title": c.local_title,
            "server_title": c.server_title,
            "category": c.category,
            "conflict_date": format_utc_iso(c.conflict_date),
            "resolved": c.resolved
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
    return send_from_directory(os.path.dirname(disk), os.path.basename(disk),
                               mimetype=a.content_type,
                               as_attachment=True,
                               download_name=a.filename)

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
    # Deduplicate: if same hash+filename exists, return existing
    existing = Attachment.query.filter_by(user_id=g.sync_user.id, file_hash=file_hash, filename=f.filename).first()
    if existing:
        return jsonify({"id": existing.id, "filename": existing.filename, "file_hash": existing.file_hash, "file_size": existing.file_size}), 200
    content_type = f.content_type or mimetypes.guess_type(f.filename)[0] or "application/octet-stream"
    attachment = Attachment(
        user_id=g.sync_user.id,
        filename=f.filename,
        content_type=content_type,
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
    return jsonify({"id": attachment.id, "filename": attachment.filename, "file_hash": attachment.file_hash, "file_size": attachment.file_size}), 201

@sync_api_bp.route("/encryption_info", methods=['GET'])
@require_sync_token
def sync_encryption_info():
    """Return encryption status and wrapped key for sync client."""
    return jsonify({
        "encryption_enabled": g.sync_user.encryption_enabled,
        "encrypted_sym_key": g.sync_user.encrypted_symmetric_key,
        "encryption_version": g.sync_user.encryption_version
    })


@sync_api_bp.route("/resolve-link", methods=['GET'])
@require_sync_token
def sync_resolve_link():
    title = request.args.get('title', '').strip()
    if not title:
        return jsonify(error="Missing 'title' parameter"), 400
    notes = UserNote.query.filter_by(userid=g.sync_user.id).all()
    for note in notes:
        if note.title and note.title.lower() == title.lower():
            return jsonify({"id": note.id, "title": note.title, "category": note.get_category_name()})
    return jsonify(error="Note not found"), 404
