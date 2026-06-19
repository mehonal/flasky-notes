"""Attachment service. With mandatory E2EE the file bytes and the display
filename are already encrypted by the client; the server stores opaque blobs
and never interprets content_type.
"""
import hashlib
import os

from flasky import db
from flasky.models import Attachment
from flask import current_app


class AttachmentNotFound(LookupError):
    pass


def upload_attachment(user, file_storage, display_filename=None):
    """Upload an attachment. `file_storage` is a Werkzeug FileStorage. With
    mandatory E2EE the bytes and filename are opaque ciphertext; the server
    hashes the raw bytes for dedup, stores them on disk, and records a generic
    content_type. `display_filename` (if provided) overrides the file's
    filename — used when the client sends an encrypted filename via form field.

    Returns (attachment, created) where created is False if deduplicated.
    """
    data = file_storage.read()
    file_hash = hashlib.sha256(data).hexdigest()
    filename = display_filename or file_storage.filename

    existing = Attachment.query.filter_by(
        user_id=user.id, file_hash=file_hash
    ).first()
    if existing:
        return existing, False

    attachment = Attachment(
        user_id=user.id,
        filename=filename,
        content_type="application/octet-stream",
        file_hash=file_hash,
        file_size=len(data),
    )
    db.session.add(attachment)
    db.session.commit()

    _write_to_disk(user.id, attachment, data)
    return attachment, True


def upload_attachment_bytes(user, filename, data):
    """Upload raw bytes (used by the sync API). Returns (attachment, created)."""
    file_hash = hashlib.sha256(data).hexdigest()
    existing = Attachment.query.filter_by(
        user_id=user.id, file_hash=file_hash, filename=filename
    ).first()
    if existing:
        return existing, False

    attachment = Attachment(
        user_id=user.id,
        filename=filename,
        content_type="application/octet-stream",
        file_hash=file_hash,
        file_size=len(data),
    )
    db.session.add(attachment)
    db.session.commit()
    _write_to_disk(user.id, attachment, data)
    return attachment, True


def _write_to_disk(user_id, attachment, data):
    attachment_dir = current_app.config["ATTACHMENT_DIR"]
    user_dir = os.path.join(attachment_dir, str(user_id))
    os.makedirs(user_dir, exist_ok=True)
    disk = attachment.disk_path()
    with open(disk, "wb") as out:
        out.write(data)


def get_attachment(user, attachment_id):
    a = Attachment.query.filter_by(id=attachment_id, user_id=user.id).first()
    if a is None:
        raise AttachmentNotFound(attachment_id)
    return a


def read_attachment_bytes(user, attachment_id):
    """Return the raw on-disk bytes for an attachment. Raises AttachmentNotFound
    if the row is missing, or FileNotFoundError if the file was deleted out of band.
    """
    a = get_attachment(user, attachment_id)
    disk = a.disk_path()
    if not os.path.exists(disk):
        raise FileNotFoundError(disk)
    with open(disk, "rb") as f:
        return f.read()


def list_attachments(user):
    return Attachment.query.filter_by(user_id=user.id).all()