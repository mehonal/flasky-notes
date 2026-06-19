from datetime import datetime, timezone
import logging
import math
import os

logger = logging.getLogger(__name__)

import bcrypt
from werkzeug.utils import secure_filename
from zoneinfo import ZoneInfo, available_timezones

from flasky import db


class UserSettings(db.Model):
    __tablename__ = "user_settings"
    id = db.Column(db.Integer, primary_key=True)
    timezone = db.Column(db.String(100), default="UTC")
    obsidian_sync_enabled = db.Column(db.Boolean, default=False)
    ai_enabled = db.Column(db.Boolean, default=False)
    ollama_api_key = db.Column(db.String(500), nullable=True)
    ollama_model = db.Column(db.String(200), default="gpt-oss:120b")
    ollama_base_url = db.Column(db.String(500), default="https://ollama.com")
    # Single JSON blob for all per-user UI preferences (font, dark_mode,
    # panel_widgets, etc.). See flasky/ui_settings.py for the registry — adding
    # a new setting requires no schema migration, only a new SettingDef entry.
    ui_settings = db.Column(db.Text, default="{}")


class ApiToken(db.Model):
    __tablename__ = "api_token"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.ForeignKey("user.id"), nullable=False)
    token_hash = db.Column(db.String(64), unique=True, nullable=False)
    name = db.Column(db.String(100), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_used_at = db.Column(db.DateTime)
    user = db.relationship("User", backref="api_tokens")


class SyncConflict(db.Model):
    __tablename__ = "sync_conflict"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.ForeignKey("user.id"), nullable=False)
    note_id = db.Column(db.Integer, nullable=True)
    local_title = db.Column(db.Text)
    local_content = db.Column(db.Text)
    server_title = db.Column(db.Text)
    server_content = db.Column(db.Text)
    category = db.Column(db.Text)
    conflict_date = db.Column(db.DateTime, default=datetime.utcnow)
    resolved = db.Column(db.Boolean, default=False)
    user = db.relationship("User", backref="sync_conflicts")


class Attachment(db.Model):
    __tablename__ = "attachment"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.ForeignKey("user.id"), nullable=False)
    filename = db.Column(db.Text, nullable=False)
    content_type = db.Column(db.String(200))
    file_hash = db.Column(db.String(64), nullable=False)
    file_size = db.Column(db.Integer)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    user = db.relationship("User", backref="attachments")

    def disk_path(self):
        from flask import current_app

        attachment_dir = current_app.config["ATTACHMENT_DIR"]
        user_dir = os.path.join(attachment_dir, str(self.user_id))
        return os.path.join(
            user_dir, f"{self.file_hash}_{secure_filename(self.filename)}"
        )


class User(db.Model):
    __tablename__ = "user"
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    settingsid = db.Column(db.Integer, db.ForeignKey("user_settings.id"), unique=True)
    username = db.Column(db.String(30), unique=True)
    password = db.Column(db.String(280))
    email = db.Column(db.String(300), unique=True)
    plan = db.Column(db.Integer, default=0)
    user_type = db.Column(db.Integer, default=0)
    # E2EE key material. Encryption is mandatory; the server never sees
    # plaintext note content. The symmetric key is wrapped by a KEK derived
    # from the user's password; the same key is wrapped by a recovery key as
    # an escape hatch if the password is lost.
    encrypted_symmetric_key = db.Column(db.Text)  # base64 AES-GCM wrapped key
    recovery_encrypted_key = db.Column(db.Text)  # base64 recovery-key wrapped key
    recovery_key_hash = db.Column(
        db.String(64)
    )  # SHA-256 hash of raw recovery key bytes
    encryption_version = db.Column(db.Integer, default=1)  # 1=AES-256-GCM
    key_salt = db.Column(db.String(64))  # hex-encoded random PBKDF2 salt
    password_hint = db.Column(db.Text)  # encrypted by client
    settings = db.relationship("UserSettings", uselist=False, backref="user")

    # ---- Read accessors only ----

    def get_timezone(self, as_str=False):
        try:
            settings = self.return_settings()
            if settings.timezone is None or settings.timezone == "":
                if as_str:
                    return "UTC"
                return ZoneInfo("UTC")
            if as_str:
                return settings.timezone
            return ZoneInfo(settings.timezone)
        except Exception:
            if as_str:
                return "UTC"
            return ZoneInfo("UTC")

    def get_main_category(self):
        """Return the user's primary category (first by id), or None if the
        user has no categories. Callers that need a fallback should create one
        via the categories service.
        """
        return (
            UserNoteCategory.query.filter_by(user_id=self.id)
            .order_by(UserNoteCategory.id)
            .first()
        )

    def get_category(self, category):
        """Resolve a category reference to a UserNoteCategory instance.

        With mandatory encryption, categories are always referenced by int id.
        The string form is parsed to int; if it can't be, None is returned.
        """
        if category is None:
            return self.get_main_category()
        if isinstance(category, int):
            return UserNoteCategory.query.filter_by(
                user_id=self.id, id=category
            ).first()
        if isinstance(category, str):
            try:
                return UserNoteCategory.query.filter_by(
                    user_id=self.id, id=int(category)
                ).first()
            except (ValueError, TypeError):
                return None
        return None

    def get_category_tree(self):
        """Build a nested dict tree from path-based category names.
        Returns {name: {_category, _notes, _children: {name: ...}}}

        Category names are encrypted ciphertext; the tree is keyed by those
        opaque strings. The client decrypts labels after receiving the tree.
        """
        tree = {}
        for cat in sorted(self.categories, key=lambda c: c.name):
            parts = cat.name.split("/")
            node = tree
            for i, part in enumerate(parts):
                if part not in node:
                    node[part] = {"_children": {}, "_category": None, "_notes": []}
                if i == len(parts) - 1:
                    node[part]["_category"] = cat
                    node[part]["_notes"] = sorted(
                        cat.notes, key=lambda n: (n.title or "").lower()
                    )
                node = node[part]["_children"]
        return tree

    def return_settings(self):
        return self.settings

    def return_notes(self, limit=None):
        if limit:
            return (
                UserNote.query.filter_by(userid=self.id)
                .order_by(UserNote.date_last_changed.desc())
                .limit(limit)
                .all()
            )
        return (
            UserNote.query.filter_by(userid=self.id)
            .order_by(UserNote.date_last_changed.desc())
            .all()
        )

    def has_notes(self):
        return bool(self.notes)


class UserNote(db.Model):
    __tablename__ = "user_note"
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    userid = db.Column(db.ForeignKey("user.id"))
    category_id = db.Column(db.ForeignKey("user_note_category.id"))
    title = db.Column(db.Text)
    content = db.Column(db.Text)
    properties = db.Column(db.Text)  # opaque ciphertext (E2EE) or "{}" if empty
    previous_content = db.Column(db.Text)
    date_added = db.Column(db.DateTime, default=datetime.utcnow)
    date_last_changed = db.Column(db.DateTime, default=datetime.utcnow)
    icon = db.Column(db.String(100), nullable=True)
    icon_color = db.Column(db.String(20), nullable=True)
    user = db.relationship("User", backref="notes")
    category = db.relationship("UserNoteCategory", backref="notes")

    # ---- Read accessors only ----

    def get_category_name(self):
        try:
            return self.category.name
        except Exception:
            return ""

    def return_time_ago(self):
        now = datetime.utcnow()
        time = (now - self.date_last_changed).total_seconds()  # seconds
        time = round(time)
        if time < 5:
            return "just now"
        if time > 60:  # mins
            time = time / 60
            if time > 60:
                time = time / 60
                if time > 24:
                    time = time / 24
                    time = round(time)
                    return f"{time}d"
                else:
                    time = round(time)
                    return f"{time}h"
            else:
                time = round(time)
                return f"{time}m"
        else:
            time = round(time)
            return f"{time}s"

    def return_description(self, max=100):
        if self.content:
            return self.content[0:max]
        else:
            return ""

    def get_properties(self):
        """Return the raw properties string (always opaque ciphertext for
        E2EE users). Returns {} when the column is empty/None.
        """
        if self.properties:
            return self.properties
        return {}

    def get_resolved_icon(self):
        """note.icon -> category.default_note_icon -> None"""
        if self.icon:
            return self.icon
        if self.category and self.category.default_note_icon:
            return self.category.default_note_icon
        return None

    def get_resolved_icon_color(self):
        if self.icon:
            return self.icon_color
        if self.category and self.category.default_note_icon:
            return self.category.default_note_icon_color
        return None

    def return_json(self):
        return {
            "id": self.id,
            "title": self.title,
            "content": self.content,
            "properties": self.get_properties(),
            "category": self.get_category_name(),
            "category_id": self.category_id,
            "icon": self.icon,
            "icon_color": self.icon_color,
            "resolved_icon": self.get_resolved_icon(),
            "resolved_icon_color": self.get_resolved_icon_color(),
            "date_added": self.date_added,
            "date_last_changed": self.date_last_changed,
        }


class UserNoteCategory(db.Model):
    __tablename__ = "user_note_category"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.ForeignKey("user.id"))
    name = db.Column(db.String(500))
    icon = db.Column(db.String(100), nullable=True)
    icon_color = db.Column(db.String(20), nullable=True)
    default_note_icon = db.Column(db.String(100), nullable=True)
    default_note_icon_color = db.Column(db.String(20), nullable=True)
    default_template_id = db.Column(db.ForeignKey("note_template.id"), nullable=True)
    user = db.relationship("User", backref="categories")
    default_template = db.relationship("NoteTemplate")


class NoteTemplate(db.Model):
    __tablename__ = "note_template"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.ForeignKey("user.id"), nullable=False)
    name = db.Column(db.Text, nullable=False)
    content = db.Column(db.Text)
    properties = db.Column(db.Text)
    icon = db.Column(db.String(100), nullable=True)
    icon_color = db.Column(db.String(20), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    user = db.relationship("User", backref="templates")

    def get_properties(self):
        """Return the raw properties string (always opaque ciphertext)."""
        if self.properties:
            return self.properties
        return {}

    def return_json(self):
        return {
            "id": self.id,
            "name": self.name,
            "content": self.content or "",
            "properties": self.get_properties(),
            "icon": self.icon,
            "icon_color": self.icon_color,
        }


class UserTodo(db.Model):
    __tablename__ = "user_todo"
    id = db.Column(db.Integer, primary_key=True)
    userid = db.Column(db.ForeignKey("user.id"))
    title = db.Column(db.Text)
    content = db.Column(db.Text)
    date_due = db.Column(db.DateTime)
    date_added = db.Column(db.DateTime, default=datetime.utcnow)
    date_completed = db.Column(db.DateTime)
    date_last_changed = db.Column(db.DateTime, default=datetime.utcnow)
    completed = db.Column(db.Boolean, default=False)
    archived = db.Column(db.Boolean, default=False)
    user = db.relationship("User", backref="todos")

    def has_content(self):
        return bool(self.content and self.content != "")

    def return_json(self):
        return {
            "id": self.id,
            "title": self.title,
            "content": self.content,
            "date_due": self.date_due.isoformat() if self.date_due else None,
            "formatted_due_time": self.get_formatted_due_time(),
            "date_added": self.date_added,
            "date_completed": self.date_completed,
            "completed": self.completed,
            "archived": self.archived,
            "time_until_due": self.get_time_until_due(),
            "due_css_class": self.get_due_css_class(),
            "has_content": self.has_content(),
        }

    def get_formatted_due_time(self):
        if not self.date_due:
            return None
        tz = self.user.get_timezone() if self.user else timezone.utc
        local_dt = self.date_due.replace(tzinfo=timezone.utc).astimezone(tz)
        return local_dt.strftime("%I:%M %p").lstrip("0")

    def get_seconds_until_due(self):
        if not self.date_due:
            return None
        now = datetime.utcnow().astimezone(self.user.get_timezone())
        date_due = self.date_due.replace(tzinfo=timezone.utc)
        return (date_due - now).total_seconds()

    def get_time_until_due(self):
        if not self.date_due:
            return None
        time = self.get_seconds_until_due()
        days = math.ceil(time / 60 / 60 / 24)
        if days <= 0:
            return "Today" if days > -1 else "Overdue"
        return "1 day" if days == 1 else f"{days} days"

    def get_due_css_class(self):
        if not self.date_due:
            return ""
        time = self.get_seconds_until_due()
        days = math.ceil(time / 60 / 60 / 24)
        if days <= -1:
            return "secondary"
        if days <= 0:
            return "info"
        if days <= 1:
            return "danger"
        if days <= 3:
            return "warning"
        return "primary"


class UserEvent(db.Model):
    __tablename__ = "user_event"
    id = db.Column(db.Integer, primary_key=True)
    userid = db.Column(db.ForeignKey("user.id"))
    title = db.Column(db.Text)
    content = db.Column(db.Text)
    date_of_event = db.Column(db.DateTime)
    date_added = db.Column(db.DateTime, default=datetime.utcnow)
    date_last_changed = db.Column(db.DateTime, default=datetime.utcnow)
    user = db.relationship("User", backref="events")

    def has_content(self):
        return bool(self.content and self.content != "")

    def return_json(self):
        return {
            "id": self.id,
            "title": self.title,
            "content": self.content,
            "date_of_event": self.date_of_event.isoformat() if self.date_of_event else None,
            "formatted_event_time": self.get_formatted_event_time(),
            "date_added": self.date_added,
            "date_last_changed": self.date_last_changed,
            "time_until_event": self.get_time_until_event(),
            "event_css_class": self.get_event_css_class(),
            "has_content": self.has_content(),
        }

    def get_formatted_event_time(self):
        if not self.date_of_event:
            return None
        tz = self.user.get_timezone() if self.user else timezone.utc
        local_dt = self.date_of_event.replace(tzinfo=timezone.utc).astimezone(tz)
        return local_dt.strftime("%I:%M %p").lstrip("0")

    def get_seconds_until_event(self):
        if not self.date_of_event:
            return None
        now = datetime.utcnow().astimezone(self.user.get_timezone())
        date_of_event = self.date_of_event.replace(tzinfo=timezone.utc)
        return (date_of_event - now).total_seconds()

    def get_time_until_event(self):
        if not self.date_of_event:
            return None
        time = self.get_seconds_until_event()
        days = math.ceil(time / 60 / 60 / 24)
        if days <= 0:
            return "Today" if days >= -1 else "Overdue"
        return "1 day" if days == 1 else f"{days} days"

    def get_event_css_class(self):
        if not self.date_of_event:
            return ""
        time = self.get_seconds_until_event()
        days = math.ceil(time / 60 / 60 / 24)
        if days <= -1:
            return "secondary"
        if days <= 0:
            return "info"
        if days <= 1:
            return "danger"
        if days <= 3:
            return "warning"
        return "primary"


class UserAgendaNotes(db.Model):
    __tablename__ = "user_agenda_notes"
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.Text)
    userid = db.Column(db.ForeignKey("user.id"))
    date_last_changed = db.Column(db.DateTime, default=datetime.utcnow)
    user = db.relationship("User", backref=db.backref("agenda_notes", uselist=False))


class AiConversation(db.Model):
    __tablename__ = "ai_conversation"
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.ForeignKey("user.id"), nullable=False)
    title = db.Column(db.String(500), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow)
    user = db.relationship("User", backref="ai_conversations")

    def return_json(self):
        return {
            "id": self.id,
            "title": self.title or "Untitled",
            "created_at": self.created_at.isoformat() + "Z" if self.created_at else None,
            "updated_at": self.updated_at.isoformat() + "Z" if self.updated_at else None,
        }


class AiMessage(db.Model):
    __tablename__ = "ai_message"
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    conversation_id = db.Column(db.ForeignKey("ai_conversation.id"), nullable=False)
    role = db.Column(db.String(20), nullable=False)
    content = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    conversation = db.relationship("AiConversation", backref="messages")