from datetime import datetime, timezone
import math
import json
import os

import bcrypt
from werkzeug.utils import secure_filename
from zoneinfo import ZoneInfo, available_timezones

from flasky import db
from flasky.utils import parse_note_frontmatter, content_with_frontmatter


class Theme(db.Model):
    __tablename__ = "theme"
    id = db.Column(db.Integer, primary_key = True)
    name = db.Column(db.String(100), unique = True)
    has_settings_page = db.Column(db.Boolean, default = False)
    has_categories_page = db.Column(db.Boolean, default = False)
    has_notes_page = db.Column(db.Boolean, default = False)
    slug = db.Column(db.String(100), unique = True)

class UserTheme(db.Model):
    __tablename__ = "user_theme"
    id = db.Column(db.Integer, primary_key = True)
    user_id = db.Column(db.ForeignKey('user.id'))
    theme_id = db.Column(db.ForeignKey('theme.id'))
    font = db.Column(db.String(250), default = "sans-serif")
    font_size = db.Column(db.Integer, default = 16)
    mobile_font_size = db.Column(db.Integer, default = 16)
    dark_mode = db.Column(db.Boolean, default = False)
    hide_title = db.Column(db.Boolean, default = False)
    notes_row_count = db.Column(db.Integer, default = 3)
    notes_height = db.Column(db.Integer, default = 150)
    auto_save = db.Column(db.Boolean, default = False)
    sidebar_collapsed = db.Column(db.Boolean, default = False)
    right_panel_collapsed = db.Column(db.Boolean, default = True)
    properties_collapsed = db.Column(db.Boolean, default = True)
    preview_mode = db.Column(db.Boolean, default = False)
    panel_widgets = db.Column(db.Text, default = None)  # JSON: widget order + visibility
    user = db.relationship('User', backref="themes")
    theme = db.relationship('Theme', backref="users")

    DEFAULT_PANEL_WIDGETS = [
        {"id": "outline", "label": "Outline", "visible": True},
        {"id": "backlinks", "label": "Backlinks", "visible": True},
        {"id": "outbound_links", "label": "Outbound Links", "visible": True},
        {"id": "properties", "label": "Properties", "visible": True},
        {"id": "todos", "label": "To-dos", "visible": False},
        {"id": "events", "label": "Events", "visible": False},
        {"id": "quick_settings", "label": "Quick Settings", "visible": False},
    ]

    def get_panel_widgets(self):
        import json
        if self.panel_widgets:
            try:
                saved = json.loads(self.panel_widgets)
                # Remove retired widget ids
                saved = [w for w in saved if w['id'] != 'agenda']
                # Merge with defaults to pick up newly added widgets
                saved_ids = [w['id'] for w in saved]
                for default_w in self.DEFAULT_PANEL_WIDGETS:
                    if default_w['id'] not in saved_ids:
                        saved.append(dict(default_w))
                return saved
            except (json.JSONDecodeError, KeyError):
                pass
        return [dict(w) for w in self.DEFAULT_PANEL_WIDGETS]

    def set_panel_widgets(self, widgets):
        import json
        self.panel_widgets = json.dumps(widgets)

class UserSettings(db.Model):
    __tablename__ = "user_settings"
    id = db.Column(db.Integer, primary_key = True)
    theme_preference = db.Column(db.String(100), default = "cozy")
    timezone = db.Column(db.String(100), default = "UTC")
    obsidian_sync_enabled = db.Column(db.Boolean, default = False)

class ApiToken(db.Model):
    __tablename__ = "api_token"
    id = db.Column(db.Integer, primary_key = True)
    user_id = db.Column(db.ForeignKey('user.id'), nullable=False)
    token_hash = db.Column(db.String(64), unique=True, nullable=False)
    name = db.Column(db.String(100), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_used_at = db.Column(db.DateTime)
    user = db.relationship('User', backref="api_tokens")

class SyncConflict(db.Model):
    __tablename__ = "sync_conflict"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.ForeignKey('user.id'), nullable=False)
    note_id = db.Column(db.Integer, nullable=True)
    local_title = db.Column(db.Text)
    local_content = db.Column(db.Text)
    server_title = db.Column(db.Text)
    server_content = db.Column(db.Text)
    category = db.Column(db.Text)
    conflict_date = db.Column(db.DateTime, default=datetime.utcnow)
    resolved = db.Column(db.Boolean, default=False)
    user = db.relationship('User', backref="sync_conflicts")

class Attachment(db.Model):
    __tablename__ = "attachment"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.ForeignKey('user.id'), nullable=False)
    filename = db.Column(db.Text, nullable=False)
    content_type = db.Column(db.String(200))
    file_hash = db.Column(db.String(64), nullable=False)
    file_size = db.Column(db.Integer)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    user = db.relationship('User', backref="attachments")

    def disk_path(self):
        from flask import current_app
        attachment_dir = current_app.config['ATTACHMENT_DIR']
        user_dir = os.path.join(attachment_dir, str(self.user_id))
        return os.path.join(user_dir, f"{self.file_hash}_{secure_filename(self.filename)}")

class User(db.Model):
    __tablename__ = "user"
    id = db.Column(db.Integer, primary_key = True, autoincrement = True)
    settingsid = db.Column(db.Integer, db.ForeignKey('user_settings.id'), unique = True)
    username = db.Column(db.String(30), unique = True)
    password = db.Column(db.String(280))
    email = db.Column(db.String(300), unique = True)
    plan = db.Column(db.Integer, default = 0)
    user_type = db.Column(db.Integer, default = 0)
    # E2EE columns
    encryption_enabled = db.Column(db.Boolean, default=False)
    encrypted_symmetric_key = db.Column(db.Text)         # base64 AES-GCM wrapped key
    recovery_encrypted_key = db.Column(db.Text)           # base64 recovery-key wrapped key
    recovery_key_hash = db.Column(db.String(64))            # SHA-256 hash of raw recovery key bytes
    encryption_version = db.Column(db.Integer, default=0) # 0=none, 1=AES-256-GCM
    key_salt = db.Column(db.String(64))                   # hex-encoded random PBKDF2 salt
    password_hint = db.Column(db.Text)                    # encrypted by client
    settings = db.relationship('UserSettings', uselist = False, backref= "user")

    def get_timezone(self, as_str = False):
        try:
            settings = self.return_settings()
            if settings.timezone is None or settings.timezone == "":
                if as_str:
                    return "UTC"
                return ZoneInfo("UTC")
            if as_str:
                return settings.timezone
            return ZoneInfo(settings.timezone)
        except:
            if as_str:
                return "UTC"
            return ZoneInfo("UTC")

    def set_timezone(self, timezone):
        try:
            if timezone is None or timezone == "" or timezone not in available_timezones():
                print("Invalid timezone. Using UTC.")
                timezone = "UTC"
            settings = self.return_settings()
            settings.timezone = timezone
            db.session.commit()
            return True
        except:
            print("Could not set timezone.")
            return False

    def edit_agenda_notes(self, content):
        print("Editing agenda")
        if not self.agenda_notes:
            print("No agenda notes found. Creating new.")
            UserAgendaNotes(userid=self.id,content=content)
            db.session.commit()
            print("New agenda notes created.")
            return True
        try:
            print("Editing existing agenda notes.")
            self.agenda_notes.content = content
            self.agenda_notes.date_last_changed = datetime.utcnow()
            db.session.commit()
            print("Agenda notes edited.")
            return True
        except:
            print("Could not edit agenda notes.")
            return False

    def get_main_category(self):
        try:
            category = UserNoteCategory.query.filter_by(user_id=self.id,name="Main").first()
            if category:
                return category
            else:
                category = UserNoteCategory.query.filter_by(user_id=self.id,name="main").first()
                if category is None:
                    category = UserNoteCategory(user_id=self.id,name="Main")
                    db.session.add(category)
                    db.session.commit()
            return category
        except:
            return None

    def get_category(self,category,create = False):
        category_obj = None
        if category is not None:
            if isinstance(category, int):
                category_obj = UserNoteCategory.query.filter_by(user_id=self.id,id=category).first()
            elif isinstance(category, str):
                category_obj = UserNoteCategory.query.filter_by(user_id=self.id,name=category).first()
        if category_obj is None and create and isinstance(category, str):
            category_obj = UserNoteCategory(user_id=self.id,name=category)
            db.session.add(category_obj)
            db.session.commit()
        if category is None:
            return self.get_main_category()
        return category_obj

    def get_category_tree(self):
        """Build a nested dict tree from path-based category names.
        Returns {name: {_category, _notes, _children: {name: ...}}}"""
        tree = {}
        for cat in sorted(self.categories, key=lambda c: c.name):
            parts = cat.name.split('/')
            node = tree
            for i, part in enumerate(parts):
                if part not in node:
                    node[part] = {'_children': {}, '_category': None, '_notes': []}
                if i == len(parts) - 1:
                    node[part]['_category'] = cat
                    node[part]['_notes'] = sorted(cat.notes, key=lambda n: (n.title or '').lower())
                node = node[part]['_children']
        return tree

    def generate_theme_settings(self):
        for theme in Theme.query.all():
            if UserTheme.query.filter_by(user_id=self.id, theme_id=theme.id).first() is None:
                user_theme = UserTheme(user_id=self.id, theme_id=theme.id)
                db.session.add(user_theme)
        db.session.commit()
        return True

    def get_theme_settings(self, theme_slug: str = None): # gets current theme's settings
        if theme_slug is not None:
            theme = Theme.query.filter_by(slug=theme_slug).first()
            if theme and theme is not None:
                user_theme = UserTheme.query.filter_by(user_id=self.id, theme_id=theme.id).first()
                if user_theme:
                    return user_theme
                else:
                    self.generate_theme_settings()
                    return UserTheme.query.filter_by(user_id=self.id, theme_id=theme.id).first()
            else:
                self.generate_theme_settings()
                return UserTheme.query.filter_by(user_id=self.id, theme_id=theme.id).first()
        theme_preference = self.return_settings().theme_preference
        theme = Theme.query.filter_by(slug=theme_preference).first()
        user_theme = UserTheme.query.filter_by(user_id=self.id, theme_id=theme.id).first()
        if user_theme and user_theme is not None:
            return user_theme
        else:
            self.generate_theme_settings()
            return UserTheme.query.filter_by(user_id=self.id, theme_id=theme.id).first()

    def get_current_theme_font(self):
        try:
            return self.get_theme_settings().font
        except:
            print("Could not retrieve font via User.get_current_theme_font. Using default (sans-serif)")
            return "sans-serif"

    def get_current_theme_notes_height(self):
        try:
            return self.get_theme_settings().notes_height
        except:
            print("Could not retrieve note height for notes via User.get_current_theme_notes_height. Using default (150)")
            return 150

    def get_current_theme_notes_row_count(self):
        try:
            return self.get_theme_settings().notes_row_count
        except:
            print("Could not retrieve row count preference for notes via User.get_current_theme_notes_row_count. Using default (3)")
            return 3

    def get_current_theme_dark_mode(self):
        try:
            return self.get_theme_settings().dark_mode
        except:
            print("Could not retrieve dark mode preference via User.get_current_theme_dark_mode. Using default (off)")
            return False

    def get_current_theme_font_size(self):
        try:
            return self.get_theme_settings().font_size
        except:
            print("Could not retrieve font size via User.return_current_theme_font_size. Using default (16)")
            return 16

    def update_theme_font(self, theme, new_font):
        try:
            theme_settings = self.get_theme_settings(theme)
            theme_settings.font = new_font
            db.session.commit()
            return True
        except:
            print("Could not update font via User.update_theme_font.")
            return False

    def update_theme_notes_height(self, theme, new_height):
        try:
            theme_settings = self.get_theme_settings(theme)
            theme_settings.notes_height = new_height
            db.session.commit()
            return True
        except:
            print("Could not update notes height via User.update_theme_notes_height.")
            return False

    def update_theme_notes_row_count(self, theme, new_row_count):
        try:
            theme_settings = self.get_theme_settings(theme)
            theme_settings.notes_row_count = new_row_count
            db.session.commit()
            return True
        except:
            print("Could not update notes row count via User.update_theme_notes_row_count.")
            return False

    def update_theme_dark_mode(self, theme, dark_mode):
        try:
            theme_settings = self.get_theme_settings(theme)
            theme_settings.dark_mode = dark_mode
            db.session.commit()
            return True
        except:
            print("Could not update dark mode via User.update_theme_dark_mode.")
            return False

    def update_theme_auto_save(self, theme, auto_save):
        try:
            theme_settings = self.get_theme_settings(theme)
            theme_settings.auto_save = auto_save
            db.session.commit()
            return True
        except:
            print("Could not update auto save via User.update_theme_auto_save.")
            return False

    def update_theme_font_size(self, theme, new_font_size):
        try:
            theme_settings = self.get_theme_settings(theme)
            theme_settings.font_size = new_font_size
            db.session.commit()
            return True
        except:
            print("Could not update font size via User.update_theme_font_size.")
            return False

    def update_theme_mobile_font_size(self, theme, new_font_size):
        try:
            theme_settings = self.get_theme_settings(theme)
            theme_settings.mobile_font_size = new_font_size
            db.session.commit()
            return True
        except:
            print("Could not update mobile font size via User.update_theme_mobile_font_size.")
            return False

    def update_theme_hide_title(self, theme, hide_title):
        try:
            theme_settings = self.get_theme_settings(theme)
            theme_settings.hide_title = hide_title
            db.session.commit()
            return True
        except:
            print("Could not update hide title via User.update_theme_hide_title.")
            return False

    def return_settings(self):
        try:
            return self.settings
        except:
            print("Could not return settings via User.return_settings.")
            print("Attempting to generate ")
            gen = self.generate_missing_settings()
            print(f"Attempt Status: {gen}")
            try:
                return self.settings
            except:
                print(f"It appears the settings were not able to be generated for the user {self.username}.")
                return None

    def delete_note(self,note_id):
        try:
            note = UserNote.query.filter_by(userid=self.id,id=note_id).first()
            if note:
                db.session.commit()
                db.session.delete(note)
                db.session.commit()
                return True
            else:
                return False
        except:
            return False

    def return_notes(self, limit = None):
        if limit:
            return UserNote.query.filter_by(userid=self.id).order_by(UserNote.date_last_changed.desc()).limit(limit).all()
        return UserNote.query.filter_by(userid=self.id).order_by(UserNote.date_last_changed.desc()).all()

    def has_notes(self):
        try:
            if self.notes:
                return True
            else:
                return False
        except:
            return False

    def add_note(self, title, content, category, encrypted=False):
        try:
            if encrypted:
                # For encrypted notes, category is an ID (not a name to look up)
                if isinstance(category, int):
                    cat_id = category
                else:
                    cat_obj = self.get_category(category, create=True)
                    cat_id = cat_obj.id
            else:
                cat_obj = self.get_category(category, create=True)
                cat_id = cat_obj.id
            note = UserNote(userid=self.id, title=title, content=content,
                           category_id=cat_id, encrypted=encrypted)
            return note
        except:
            print("Could not add note.")
            return False

    def generate_missing_settings(self):
        try:
            self.settings
            return True
        except:
            settings = UserSettings.query.filter_by(id=self.settingsid).first()
            if settings and settings is not None:
                return True
            else:
                settings = UserSettings(id=self.id)
                db.session.commit()
                return True

    def __init__(self,username,password,email):
        self.username = username
        hashed_pw = bcrypt.hashpw(password.encode('utf-8'),bcrypt.gensalt())
        self.password = hashed_pw
        self.email = email
        db.session.add(self)
        db.session.commit()
        settings = UserSettings(id=User.query.filter_by(username=self.username).first().id)
        db.session.commit()
        self.settings = settings
        db.session.commit()


class UserNote(db.Model):
    __tablename__ = "user_note"
    id = db.Column(db.Integer, primary_key = True, autoincrement = True)
    userid = db.Column(db.ForeignKey('user.id'))
    category_id = db.Column(db.ForeignKey('user_note_category.id'))
    title = db.Column(db.Text)
    content = db.Column(db.Text)
    properties = db.Column(db.Text)  # JSON string of frontmatter key-value pairs
    previous_content = db.Column(db.Text)
    date_added = db.Column(db.DateTime)
    date_last_changed = db.Column(db.DateTime)
    user = db.relationship('User', backref="notes")
    category = db.relationship('UserNoteCategory', backref="notes")

    def get_category_name(self):
        try:
            return self.category.name
        except:
            return "Main"

    def return_time_ago(self):
        now = datetime.utcnow()
        time = (now - self.date_last_changed).total_seconds() # seconds
        time = round(time)
        if time < 5:
            return "just now"
        if time > 60: # mins
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

    def return_description(self,max=100):
        if self.content:
            return self.content[0:max]
        else:
            return ""

    def change_content(self, new_content, encrypted=False):
        self.previous_content = self.content
        if encrypted:
            # Content is already encrypted — store as-is, skip frontmatter parsing
            self.content = new_content
        else:
            props, body = parse_note_frontmatter(new_content)
            if props:
                self.properties = json.dumps(props)
                self.content = body
            else:
                self.content = new_content
        self.date_last_changed = datetime.utcnow()
        db.session.commit()

    def change_category(self,new_category):
        if isinstance(new_category, UserNoteCategory):
            self.category_id = new_category.id
        elif isinstance(new_category, int):
            self.category_id = new_category
        elif isinstance(new_category, str):
            new_category = self.user.get_category(new_category,create=True)
            self.category_id = new_category.id
        db.session.commit()
        return True

    def change_title(self,new_title):
        self.title = new_title
        self.date_last_changed = datetime.utcnow()
        db.session.commit()

    def revert_to_last_version(self):
        try:
            if self.previous_content:
                c = self.content
                self.content = self.previous_content
                self.previous_content = c
                self.date_last_changed = datetime.utcnow()
                db.session.commit()
                return True
            return False
        except:
            return False

    def get_properties(self):
        if self.properties:
            try:
                return json.loads(self.properties)
            except (json.JSONDecodeError, TypeError):
                pass
        return {}

    def get_full_content(self):
        """Return content with frontmatter prepended (for sync/export)."""
        return content_with_frontmatter(self.content, self.properties)

    def return_json(self):
        return {
            "id": self.id,
            "title": self.title,
            "content": self.content,
            "properties": self.get_properties(),
            "category": self.get_category_name(),
            "date_added": self.date_added,
            "date_last_changed": self.date_last_changed
        }

    def __init__(self, userid, title, content, category_id, encrypted=False):
        self.userid = userid
        self.title = title
        self.category_id = category_id
        self.date_added = datetime.utcnow()
        self.date_last_changed = datetime.utcnow()
        if encrypted:
            # Content is already encrypted — store as-is
            self.content = content
        else:
            props, body = parse_note_frontmatter(content)
            if props:
                self.properties = json.dumps(props)
                self.content = body
            else:
                self.content = content
        db.session.add(self)
        db.session.commit()

class UserNoteCategory(db.Model):
    __tablename__ = "user_note_category"
    id = db.Column(db.Integer, primary_key = True)
    user_id = db.Column(db.ForeignKey('user.id'))
    name = db.Column(db.String(500))
    default_template_id = db.Column(db.ForeignKey('note_template.id'), nullable=True)
    user = db.relationship('User', backref="categories")
    default_template = db.relationship('NoteTemplate')

    def __init__(self, user_id,name):
        self.user_id = user_id
        self.name = name
        db.session.add(self)
        db.session.commit()

class NoteTemplate(db.Model):
    __tablename__ = "note_template"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.ForeignKey('user.id'), nullable=False)
    name = db.Column(db.Text, nullable=False)
    content = db.Column(db.Text)
    properties = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    user = db.relationship('User', backref="templates")

    def get_properties(self):
        if self.properties:
            try:
                return json.loads(self.properties)
            except (json.JSONDecodeError, TypeError):
                pass
        return {}

    def return_json(self):
        # For E2EE users, properties is encrypted ciphertext — return raw string
        props = self.get_properties()
        if not props and self.properties:
            props = self.properties  # encrypted ciphertext, couldn't parse as JSON
        return {
            "id": self.id,
            "name": self.name,
            "content": self.content or "",
            "properties": props,
        }

    def __init__(self, user_id, name, content="", properties=None):
        self.user_id = user_id
        self.name = name
        self.content = content
        self.properties = properties
        self.created_at = datetime.utcnow()
        db.session.add(self)
        db.session.commit()

class UserTodo(db.Model):
    __tablename__ = "user_todo"
    id = db.Column(db.Integer, primary_key = True)
    userid = db.Column(db.ForeignKey('user.id'))
    title = db.Column(db.Text)
    content = db.Column(db.Text)
    date_due = db.Column(db.DateTime)
    date_added = db.Column(db.DateTime)
    date_completed = db.Column(db.DateTime)
    date_last_changed = db.Column(db.DateTime)
    completed = db.Column(db.Boolean, default = False)
    archived = db.Column(db.Boolean, default = False)
    user = db.relationship('User', backref="todos")

    def has_content(self):
        if self.content and self.content != "" and self.content != None:
            return True
        else:
            return False

    def return_json(self):
        return {
            "id": self.id,
            "title": self.title,
            "content": self.content,
            "date_due": self.date_due,
            "date_added": self.date_added,
            "date_completed": self.date_completed,
            "completed": self.completed,
            "archived": self.archived,
            "time_until_due": self.get_time_until_due(),
            "due_css_class": self.get_due_css_class(),
            "has_content": self.has_content()
        }

    def get_seconds_until_due(self):
        if not self.date_due or self.date_due is None:
            return None
        now = datetime.utcnow().astimezone(self.user.get_timezone())
        date_due = self.date_due.replace(tzinfo=timezone.utc)
        time = (date_due - now).total_seconds()
        return time

    def get_time_until_due(self):
        if not self.date_due or self.date_due is None:
            return None
        time = self.get_seconds_until_due()
        days = math.ceil(time / 60 / 60 / 24)
        if days <= 0:
            if days > -1:
                return "Today"
            return "Overdue"
        else:
            if days == 1:
                return "1 day"
            return f"{days} days"

    def get_due_css_class(self):
        if not self.date_due or self.date_due is None:
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

    def __init__(self,userid,title,content="",date_due=None):
        self.userid = userid
        self.title = title
        self.content = content
        self.date_due = date_due
        self.date_added = datetime.utcnow()
        self.date_last_changed = datetime.utcnow()
        db.session.add(self)
        db.session.commit()

class UserEvent(db.Model):
    __tablename__ = "user_event"
    id = db.Column(db.Integer, primary_key = True)
    userid = db.Column(db.ForeignKey('user.id'))
    title = db.Column(db.Text)
    content = db.Column(db.Text)
    date_of_event = db.Column(db.DateTime)
    date_added = db.Column(db.DateTime)
    date_last_changed = db.Column(db.DateTime)
    user = db.relationship('User', backref="events")

    def has_content(self):
        if self.content and self.content != "" and self.content != None:
            return True
        else:
            return False

    def return_json(self):
        return {
            "id": self.id,
            "title": self.title,
            "content": self.content,
            "date_of_event": self.date_of_event,
            "date_added": self.date_added,
            "date_last_changed": self.date_last_changed,
            "time_until_event": self.get_time_until_event(),
            "event_css_class": self.get_event_css_class(),
            "has_content": self.has_content()
        }

    def get_seconds_until_event(self):
        if not self.date_of_event or self.date_of_event is None:
            return None
        now = datetime.utcnow().astimezone(self.user.get_timezone())
        date_of_event = self.date_of_event.replace(tzinfo=timezone.utc)
        time = (date_of_event - now).total_seconds()
        return time

    def get_time_until_event(self):
        if not self.date_of_event or self.date_of_event is None:
            return None
        time = self.get_seconds_until_event()
        days = math.ceil(time / 60 / 60 / 24)
        if days <= 0:
            if days >= -1:
                return "Today"
            return "Overdue"
        else:
            if days == 1:
                return "1 day"
            return f"{days} days"

    def get_event_css_class(self):
        if not self.date_of_event or self.date_of_event is None:
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

    def __init__(self,userid,title,content="",date_of_event=None):
        self.userid = userid
        self.title = title
        self.content = content
        self.date_of_event = date_of_event
        self.date_added = datetime.utcnow()
        self.date_last_changed = datetime.utcnow()
        db.session.add(self)
        db.session.commit()

class UserAgendaNotes(db.Model):
    __tablename__ = "user_agenda_notes"
    id = db.Column(db.Integer, primary_key = True)
    content = db.Column(db.Text)
    userid = db.Column(db.ForeignKey('user.id'))
    date_last_changed = db.Column(db.DateTime)
    user = db.relationship('User', backref=db.backref('agenda_notes', uselist=False))

    def __init__(self,userid, content=""):
        self.userid = userid
        self.content = content
        self.date_last_changed = datetime.utcnow()
        db.session.add(self)
        db.session.commit()
