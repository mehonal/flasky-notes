"""Attachment service. With mandatory E2EE the file bytes and the display
filename are already encrypted by the client; the server stores opaque blobs
and never interprets content_type.
"""
import hashlib
import os

from flasky import db
from flasky.models import Attachment
from flasky.services import notes as notes_service
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


def replace_attachment(user, attachment_id, file_storage, display_filename=None):
    """Replace an existing attachment's bytes in place, keeping its id and
    filename stable. Used for round-trip editing of .fldraw drawings (and any
    other attachment the client wants to overwrite). No dedup — overwrite
    semantics. Raises AttachmentNotFound if the attachment doesn't exist or
    isn't owned by `user`.
    """
    a = get_attachment(user, attachment_id)
    old_disk = a.disk_path()
    data = file_storage.read()
    file_hash = hashlib.sha256(data).hexdigest()
    a.file_hash = file_hash
    a.file_size = len(data)
    if display_filename:
        a.filename = display_filename
    db.session.commit()
    if os.path.exists(old_disk):
        try:
            os.remove(old_disk)
        except OSError:
            pass
    _write_to_disk(user.id, a, data)
    return a


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


def _remove_disk_file(attachment):
    disk = attachment.disk_path()
    if os.path.exists(disk):
        try:
            os.remove(disk)
        except OSError:
            pass


def delete_attachment(user, attachment_id):
    """Delete a single attachment: DB row + on-disk blob. Raises
    AttachmentNotFound if the row is missing or not owned by `user`."""
    a = get_attachment(user, attachment_id)
    _remove_disk_file(a)
    db.session.delete(a)
    db.session.commit()
    return a


def delete_attachments(user, ids):
    """Bulk-delete attachments by id. Only rows owned by `user` are touched.
    Returns the number of attachments actually deleted."""
    if not ids:
        return 0
    attachments = Attachment.query.filter(
        Attachment.id.in_(ids), Attachment.user_id == user.id
    ).all()
    for a in attachments:
        _remove_disk_file(a)
        db.session.delete(a)
    db.session.commit()
    return len(attachments)


def list_attachments(user):
    return Attachment.query.filter_by(user_id=user.id).all()


def rename_attachment(user, attachment_id, new_filename, note_updates):
    """Rename an attachment and update the encrypted content of every note that
    references it, in a single transaction. `new_filename` is the E2EE
    ciphertext of the new display name; `note_updates` is a list of dicts
    with a note id (`note_id` or `noteId`) and `content` (re-encrypted note body
    with the new embed name substituted for the old). The on-disk blob is
    moved after the commit (its path includes the filename). Raises
    AttachmentNotFound if the attachment is missing or not owned by `user`,
    NoteNotFound/NotOwner if a referenced note is missing or unowned.

    Returns `(attachment, updated_note_ids)`.
    """
    a = get_attachment(user, attachment_id)
    old_disk = a.disk_path()
    data = None
    if os.path.exists(old_disk):
        with open(old_disk, "rb") as f:
            data = f.read()
    a.filename = new_filename
    updated_ids = []
    for upd in note_updates:
        note_id = upd.get("note_id", upd.get("noteId"))
        notes_service.update_note(
            user, note_id, content=upd["content"], commit=False
        )
        updated_ids.append(note_id)
    db.session.commit()
    if data is not None:
        new_disk = a.disk_path()
        _write_to_disk(user.id, a, data)
        if old_disk != new_disk and os.path.exists(old_disk):
            try:
                os.remove(old_disk)
            except OSError:
                pass
    return a, updated_ids
