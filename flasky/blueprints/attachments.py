"""Attachments blueprint — upload endpoint (download is on web.py /serve_attachment)."""
from flask import Blueprint, request, g, jsonify

from flasky.utils import login_required
from flasky.services import attachments as att_service
from flasky.services.attachments import AttachmentNotFound


attachments_bp = Blueprint("attachments", __name__, url_prefix="/api")


@attachments_bp.route("/upload_attachment", methods=["POST"])
@login_required
def upload_attachment():
    if "file" not in request.files:
        return jsonify(error="No file part"), 400
    f = request.files["file"]
    if not f.filename:
        return jsonify(error="No filename"), 400
    display_filename = request.form.get("filename", f.filename)
    try:
        attachment, created = att_service.upload_attachment(g.user, f, display_filename)
    except Exception as e:
        return jsonify(error=str(e)), 500
    status = 201 if created else 200
    return jsonify({
        "id": attachment.id,
        "filename": attachment.filename,
        "file_hash": attachment.file_hash,
        "file_size": attachment.file_size,
    }), status


@attachments_bp.route("/attachment/<int:attachment_id>", methods=["PUT"])
@login_required
def replace_attachment(attachment_id):
    """Replace an existing attachment's bytes (round-trip editing)."""
    if "file" not in request.files:
        return jsonify(error="No file part"), 400
    f = request.files["file"]
    if not f.filename:
        return jsonify(error="No filename"), 400
    display_filename = request.form.get("filename", None)
    try:
        attachment = att_service.replace_attachment(g.user, attachment_id, f, display_filename)
    except AttachmentNotFound:
        return jsonify(error="Not found"), 404
    except Exception as e:
        return jsonify(error=str(e)), 500
    return jsonify({
        "id": attachment.id,
        "filename": attachment.filename,
        "file_hash": attachment.file_hash,
        "file_size": attachment.file_size,
    }), 200