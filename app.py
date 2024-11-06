from flask import Flask, render_template, request, session, redirect, url_for, g, jsonify
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, timedelta
import bcrypt # for encrypting/decrypting passwords
import logging
from flask_migrate import Migrate
import re
import config as CONFIG
from sqlalchemy import MetaData
import os

#=============================================================================================================#
#================================================APP SETTINGS=================================================#
#=============================================================================================================#

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URI')
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

app.permanent_session_lifetime = timedelta(days=CONFIG.SESSION_LIFETIME)

convention = {
    "ix": 'ix_%(column_0_label)s',
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s"
}

metadata = MetaData(naming_convention=convention)
db = SQLAlchemy(app, metadata=metadata)
migrate = Migrate(app, db, render_as_batch=True)

logging.basicConfig(filename = 'applog.log', level=logging.WARNING, format=f'%(asctime)s %(levelname)s %(name)s %(threadName)s : %(message)s')

#=============================================================================================================#
#=================================================FUNCTIONS===================================================#
#=============================================================================================================#

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

#=============================================================================================================#
#==================================================CLASSES====================================================#
#=============================================================================================================#

'''
Current Theme List:

- paper
- full
- dash

'''

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
    user = db.relationship('User', backref="themes")
    theme = db.relationship('Theme', backref="users")

class UserSettings(db.Model):
    __tablename__ = "user_settings"
    id = db.Column(db.Integer, primary_key = True)
    theme_preference = db.Column(db.String(100), default = "paper")

class User(db.Model):
    __tablename__ = "user"
    id = db.Column(db.Integer, primary_key = True, autoincrement = True)
    settingsid = db.Column(db.Integer, db.ForeignKey('user_settings.id'), unique = True)
    username = db.Column(db.String(30), unique = True)
    password = db.Column(db.String(280))
    email = db.Column(db.String(300), unique = True)
    plan = db.Column(db.Integer, default = 0)
    user_type = db.Column(db.Integer, default = 0)
    settings = db.relationship('UserSettings', uselist = False, backref= "user")

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
            self.agenda_notes.date_last_changed = datetime.now()
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

    def add_note(self,title,content,category):
        try:
            category = self.get_category(category,create=True)
            note = UserNote(userid=self.id,title=title,content=content,category_id=category.id)
            return note
        except:
            print("Could not add note.")
            return False

    def generate_missing_settings(self):
        try:
            self.settings
            return True
        except:
            settings = UserSettings.query.filter_by(self.settingsid).first()
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
    title = db.Column(db.String(1_000))
    content = db.Column(db.String(1_000_000))
    previous_content = db.Column(db.String(1_000_000))
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
        now = datetime.now()
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

    def change_content(self,new_content):
        self.previous_content = self.content
        self.content = new_content
        self.date_last_changed = datetime.now()
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
        self.date_last_changed = datetime.now()
        db.session.commit()

    def revert_to_last_version(self):
        try:
            if self.previous_content:
                c = self.content
                self.content = self.previous_content
                self.previous_content = c
                self.date_last_changed = datetime.now()
                db.session.commit()
                return True
            return False
        except:
            return False

    def return_json(self):
        return {
            "id": self.id,
            "title": self.title,
            "content": self.content,
            "category": self.get_category_name(),
            "date_added": self.date_added,
            "date_last_changed": self.date_last_changed
        }

    def __init__(self,userid,title,content,category_id):
        self.userid = userid
        self.title = title
        self.content = content
        self.category_id = category_id
        self.date_added = datetime.now()
        self.date_last_changed = datetime.now()
        db.session.add(self)
        db.session.commit()

class UserNoteCategory(db.Model):
    __tablename__ = "user_note_category"
    id = db.Column(db.Integer, primary_key = True)
    user_id = db.Column(db.ForeignKey('user.id'))
    name = db.Column(db.String(100))
    user = db.relationship('User', backref="categories")

    def __init__(self, user_id,name):
        self.user_id = user_id 
        self.name = name 
        db.session.add(self)
        db.session.commit()

class UserTodo(db.Model):
    __tablename__ = "user_todo"
    id = db.Column(db.Integer, primary_key = True)
    userid = db.Column(db.ForeignKey('user.id'))
    title = db.Column(db.String(100))
    content = db.Column(db.String(100_000))
    date_due = db.Column(db.DateTime)
    date_added = db.Column(db.DateTime)
    date_completed = db.Column(db.DateTime)
    date_last_changed = db.Column(db.DateTime)
    completed = db.Column(db.Boolean, default = False)
    archived = db.Column(db.Boolean, default = False)
    user = db.relationship('User', backref="todos")

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
            "due_css_class": self.get_due_css_class()
        }

    def get_time_until_due(self):
        if not self.date_due or self.date_due is None:
            return None
        now = datetime.now()
        time = (self.date_due - now).total_seconds()
        if time < 0:
            return "Overdue"
        if time < 60:
            return "1 minute"
        if time > 60:
            time = time / 60
            if time > 60:
                time = time / 60
                if time > 24:
                    time = time / 24
                    time = round(time)
                    return f"{time} days"
                else:
                    time = round(time)
                    return f"{time} hours"
            else:
                time = round(time)
                return f"{time} minutes"

    def get_due_css_class(self):
        if not self.date_due or self.date_due is None:
            return ""
        now = datetime.now()
        time = (self.date_due - now).total_seconds()
        hours = time / 60 / 60
        if hours < 24:
            return "danger"
        if hours < 72:
            return "warning"
        return "primary"

    def __init__(self,userid,title,content="",date_due=None):
        self.userid = userid
        self.title = title
        self.content = content
        self.date_due = date_due
        self.date_added = datetime.now()
        self.date_last_changed = datetime.now()
        db.session.add(self)
        db.session.commit()

class UserEvent(db.Model):
    __tablename__ = "user_event"
    id = db.Column(db.Integer, primary_key = True)
    userid = db.Column(db.ForeignKey('user.id'))
    title = db.Column(db.String(100))
    content = db.Column(db.String(100_000))
    date_of_event = db.Column(db.DateTime)
    date_added = db.Column(db.DateTime)
    date_last_changed = db.Column(db.DateTime)
    user = db.relationship('User', backref="events")

    def return_json(self):
        return {
            "id": self.id,
            "title": self.title,
            "content": self.content,
            "date_of_event": self.date_of_event,
            "date_added": self.date_added,
            "date_last_changed": self.date_last_changed,
            "time_until_event": self.get_time_until_event(),
            "event_css_class": self.get_event_css_class()
        }

    def get_time_until_event(self):
        if not self.date_of_event or self.date_of_event is None:
            return None
        now = datetime.now()
        time = (self.date_of_event - now).total_seconds()
        if time < 0:
            return "Past"
        if time < 60:
            return "1 minute"
        if time > 60:
            time = time / 60
            if time > 60:
                time = time / 60
                if time > 24:
                    time = time / 24
                    time = round(time)
                    return f"{time} days"
                else:
                    time = round(time)
                    return f"{time} hours"
            else:
                time = round(time)
                return f"{time} minutes"

    def get_event_css_class(self):
        if not self.date_of_event or self.date_of_event is None:
            return ""
        now = datetime.now()
        time = (self.date_of_event - now).total_seconds()
        hours = time / 60 / 60
        if hours < 24:
            return "danger"
        if hours < 72:
            return "warning"
        return "primary"
    
    def __init__(self,userid,title,content="",date_of_event=None):
        self.userid = userid
        self.title = title
        self.content = content
        self.date_of_event = date_of_event
        self.date_added = datetime.now()
        self.date_last_changed = datetime.now()
        db.session.add(self)
        db.session.commit()

class UserAgendaNotes(db.Model):
    __tablename__ = "user_agenda_notes"
    id = db.Column(db.Integer, primary_key = True)
    content = db.Column(db.String(1_000_000))
    userid = db.Column(db.ForeignKey('user.id'))
    date_last_changed = db.Column(db.DateTime)
    user = db.relationship('User', backref=db.backref('agenda_notes', uselist=False))

    def __init__(self,userid, content=""):
        self.userid = userid
        self.content = content
        self.date_last_changed = datetime.now()
        db.session.add(self)
        db.session.commit()

#=============================================================================================================#
#=================================================APP ROUTES==================================================#
#=============================================================================================================#

#=====================================================API=====================================================#

@app.route("/api/get_all_notes")
def get_all_notes_api():
    if g.user:
        notes = []
        for note in UserNote.query.filter_by(userid=g.user.id):
            notes.append(note.return_json())
        return jsonify(notes)
    else:
        return jsonify(success=False,reason="Note logged in.")


@app.route("/api/note/check_last_edited/<int:note_id>")
def check_last_edited_note_api(note_id):
    if g.user:
        note = UserNote.query.filter_by(id=note_id).first()
        if note and g.user == note.user:
            return jsonify(success=True,last_updated=f"Note last updated {note.return_time_ago()} ago.")
        else:
            return jsonify(success=False,reason="Note does not exist.")
    else:
        return jsonify(success=False,reason="Not logged in.")


@app.route("/api/save_font_size/<int:font_size>")
def save_font_size(font_size):
    if g.user:
        theme = g.user.return_settings().theme_preference
        g.user.update_theme_font_size(theme, font_size)
        return jsonify(success=True,theme=theme,font_size=font_size)
    else:
        return jsonify(success=False,reason="Not logged in.")

@app.route("/api/save_mobile_font_size/<int:font_size>")
def save_mobile_font_size(font_size):
    if g.user:
        theme = g.user.return_settings().theme_preference
        g.user.update_theme_mobile_font_size(theme, font_size)
        return jsonify(success=True,theme=theme,font_size=font_size)
    else:
        return jsonify(success=False,reason="Not logged in.")

@app.route("/api/save_auto_save", methods=['POST'])
def save_auto_save():
    if g.user:
        theme = g.user.return_settings().theme_preference
        auto_save = request.get_json().get('autoSave')
        if auto_save == 1:
            auto_save = True
        else:
            auto_save = False
        g.user.update_theme_auto_save(theme, auto_save)
        return jsonify(success=True,theme=theme,new_auto_save_setting=auto_save)
    else:
        return jsonify(success=False,reason="Not logged in.")

@app.route("/api/save_notes_row_count/<int:row_count>")
def save_notes_row_count(row_count):
    if g.user:
        theme = g.user.return_settings().theme_preference
        g.user.update_theme_notes_row_count(theme, row_count)
        return jsonify(success=True,theme=theme,new_row_count=row_count)
    else:
        return jsonify(success=False,reason="Not logged in.")

@app.route("/api/save_notes_height/<int:height>")
def save_notes_height(height):
    if g.user:
        theme = g.user.return_settings().theme_preference
        g.user.update_theme_notes_height(theme, height)
        return jsonify(success=True,theme=theme,new_height=height)
    else:
        return jsonify(success=False,reason="Not logged in.")

@app.route("/api/save_dark_mode/<int:dark_mode>")
def save_dark_mode(dark_mode):
    if g.user:
        if dark_mode == 1:
            dark_mode = True
        else:
            dark_mode = False
        theme = g.user.return_settings().theme_preference
        g.user.update_theme_dark_mode(theme, dark_mode)
        return jsonify(success=True,theme=theme,new_dark_mode_setting=dark_mode)
    else:
        return jsonify(success=False,reason="Not logged in.")

@app.route("/api/save_font", methods=['POST'])
def save_font():
    if g.user:
        new_font = request.data.decode('utf-8')
        if len(new_font) < 250:
            theme = g.user.return_settings().theme_preference
            g.user.update_theme_font(theme, new_font)
            return jsonify(success=True,theme=theme,new_font=new_font)
        else:
            return jsonify(success=False,reason="Font exceeds max allowed character limit of 250.")
    else:
        return jsonify(success=False,reason="Not logged in.")

@app.route("/api/save_hide_title", methods=['POST'])
def save_hide_title():
    if g.user:
        theme = g.user.return_settings().theme_preference
        hide_title = request.get_json().get('hideTitle')
        if hide_title == 1:
            hide_title = True
        else:
            hide_title = False
        g.user.update_theme_hide_title(theme, hide_title)
        return jsonify(success=True,theme=theme,new_hide_title_setting=hide_title)
    else:
        return jsonify(success=False,reason="Not logged in.")

@app.route("/api/save_note", methods=['POST'])
def save_note():
    if g.user:
        data = request.get_json()
        note_id = int(data.get('noteId'))
        title = data.get('title')
        content = data.get('content')
        category = data.get('category')
        try:
            category = int(category)
        except:
            pass
        if note_id == 0:
            note = g.user.add_note(title,content,category)
            return jsonify(success=True,note=note.return_json())
        else:
            note = UserNote.query.filter_by(id=note_id).first()
            if note and g.user == note.user:
                note.change_title(title)
                note.change_content(content)
                note.change_category(category)
                return jsonify(success=True,note=note.return_json())
            else:
                return jsonify(success=False,reason="Note does not exist.")
    else:
        return jsonify(success=False,reason="Not logged in.")

@app.route("/api/load_notes", methods=['POST'])
def load_notes():
    if g.user:
        page = request.get_json().get('page')
        notes = []
        for note in UserNote.query.filter_by(userid=g.user.id).order_by(UserNote.date_last_changed.desc()).paginate(page=page, per_page=5).items:
            notes.append(note.return_json())
        return jsonify(notes)
    else:
        return jsonify(success=False,reason="Not logged in.")

@app.route("/api/delete_note", methods=['POST'])
def delete_note():
    if g.user:
        data = request.get_json()
        note_id = data.get('noteId')
        note = UserNote.query.filter_by(id=note_id).first()
        if note and g.user == note.user:
            db.session.delete(note)
            db.session.commit()
            return jsonify(success=True)
        else:
            return jsonify(success=False,reason="Note does not exist.")
    else:
        return jsonify(success=False,reason="Not logged in.")

@app.route("/api/add_category", methods=['POST'])
def add_category():
    if g.user:
        data = request.get_json()
        category_name = data.get('categoryName')
        category = g.user.get_category(category_name,create=True)
        return jsonify(success=True,category=category.id)
    else:
        return jsonify(success=False,reason="Not logged in.")

@app.route("/api/edit_note_category", methods=['POST'])
def edit_note_category():
    if g.user:
        data = request.get_json()
        note_id = data.get('noteId')
        category = data.get('category')
        note = UserNote.query.filter_by(id=note_id).first()
        if note and g.user == note.user:
            note.change_category(category)
            return jsonify(success=True)
        else:
            return jsonify(success=False,reason="Note does not exist.")
    else:
        return jsonify(success=False,reason="Not logged in.")

@app.route("/api/delete_category", methods=['POST'])
def delete_category():
    if g.user:
        data = request.get_json()
        category_id = int(data.get('categoryId'))
        category = UserNoteCategory.query.filter_by(id=category_id).first()
        if category and g.user == category.user and category.name != "Main" and category.name != "main":
            for note in UserNote.query.filter_by(category_id=category_id):
                note.category_id = g.user.get_main_category().id
            db.session.commit()
            db.session.delete(category)
            db.session.commit()
            return jsonify(success=True)
        else:
            return jsonify(success=False,reason="Category does not exist.")
    else:
        return jsonify(success=False,reason="Not logged in.")

@app.route("/api/get_todos")
def get_todos():
    if g.user:
        todos = []
        query = None
        if request.args.get('archived') == "true":
            query = UserTodo.query.filter_by(userid=g.user.id, archived=True).all()
        else:
            query = UserTodo.query.filter_by(userid=g.user.id, archived=False).all()
        for todo in query:
            todos.append({
                "id": todo.id,
                "title": todo.title,
                "completed": todo.completed,
                "archived": todo.archived,
                "time_until_due": todo.get_time_until_due()
            })
        return jsonify(todos)
    else:
        return jsonify(success=False,reason="Not logged in.")

@app.route("/api/get_todo/<int:todo_id>")
def get_todo(todo_id):
    if g.user:
        todo = UserTodo.query.filter_by(id=todo_id).first()
        if todo and g.user == todo.user:
            return jsonify(success=True,todo=todo.return_json())
        else:
            return jsonify(success=False,reason="To do does not exist.")
    else:
        return jsonify(success=False,reason="Not logged in.")

@app.route("/api/get_event/<int:event_id>")
def get_event(event_id):
    if g.user:
        event = UserEvent.query.filter_by(id=event_id).first()
        if event and g.user == event.user:
            return jsonify(success=True,event=event.return_json())
        else:
            return jsonify(success=False,reason="Event does not exist.")
    else:
        return jsonify(success=False,reason="Not logged in.")

@app.route("/api/get_events")
def get_events():
    if g.user:
        events = []
        for event in UserEvent.query.filter_by(userid=g.user.id).all():
            events.append({
                "id": event.id,
                "title": event.title,
                "time_until_event": event.get_time_until_event()
            })
        return jsonify(events)
    else:
        return jsonify(success=False,reason="Not logged in.")

@app.route("/api/add_todo", methods=['POST'])
def add_todo():
    if g.user:
        data = request.get_json()
        title = data.get('title')
        content = data.get('content')
        date_due = data.get('dateDue')
        if date_due and date_due != "":
            date_due = datetime.strptime(date_due, "%Y-%m-%d")
        else:
            date_due = None
        todo = UserTodo(userid=g.user.id,title=title,content=content,date_due=date_due)
        return jsonify(success=True, todo=todo.return_json(), id=todo.id)
    else:
        return jsonify(success=False,reason="Not logged in.")

@app.route("/api/add_event", methods=['POST'])
def add_event():
    if g.user:
        data = request.get_json()
        title = data.get('title')
        content = data.get('content')
        date_of_event = data.get('dateOfEvent')
        if date_of_event and date_of_event != "":
            date_of_event = datetime.strptime(date_of_event, "%Y-%m-%d")
        else:
            date_of_event = None
        event = UserEvent(userid=g.user.id,title=title,content=content,date_of_event=date_of_event)
        return jsonify(success=True, event=event.return_json(), id=event.id)
    else:
        return jsonify(success=False,reason="Not logged in.")

@app.route("/api/edit_todo", methods=['POST'])
def edit_todo():
    if g.user:
        data = request.get_json()
        todo_id = data.get('toDoId')
        title = data.get('title')
        content = data.get('content')
        date_due = data.get('dateDue')
        if date_due and date_due != "":
            date_due = datetime.strptime(date_due, "%Y-%m-%d")
        else:
            date_due = None
        todo = UserTodo.query.filter_by(id=todo_id).first()
        if todo and g.user == todo.user:
            todo.title = title
            todo.content = content
            todo.date_due = date_due
            db.session.commit()
            return jsonify(success=True, todo=todo.return_json())
        else:
            return jsonify(success=False,reason="To do does not exist.")
    else:
        return jsonify(success=False,reason="Not logged in.")

@app.route("/api/edit_event", methods=['POST'])
def edit_event():
    if g.user:
        data = request.get_json()
        event_id = data.get('eventId')
        title = data.get('title')
        content = data.get('content')
        date_of_event = data.get('dateOfEvent')
        if date_of_event and date_of_event != "":
            date_of_event = datetime.strptime(date_of_event, "%Y-%m-%d")
        else:
            date_of_event = None
        event = UserEvent.query.filter_by(id=event_id).first()
        if event and g.user == event.user:
            event.title = title
            event.content = content
            event.date_of_event = date_of_event
            db.session.commit()
            return jsonify(success=True, event=event.return_json())
        else:
            return jsonify(success=False,reason="Event does not exist.")
    else:
        return jsonify(success=False,reason="Not logged in.")

@app.route("/api/delete_todo", methods=['POST'])
def delete_todo():
    if g.user:
        data = request.get_json()
        todo_id = data.get('toDoId')
        todo = UserTodo.query.filter_by(id=todo_id).first()
        if todo and g.user == todo.user:
            db.session.delete(todo)
            db.session.commit()
            return jsonify(success=True)
        else:
            return jsonify(success=False,reason="To do does not exist.")
    else:
        return jsonify(success=False,reason="Not logged in.")

@app.route("/api/delete_event", methods=['POST'])
def delete_event():
    if g.user:
        data = request.get_json()
        event_id = data.get('eventId')
        event = UserEvent.query.filter_by(id=event_id).first()
        if event and g.user == event.user:
            db.session.delete(event)
            db.session.commit()
            return jsonify(success=True)
        else:
            return jsonify(success=False,reason="Event does not exist.")
    else:
        return jsonify(success=False,reason="Not logged in.")

@app.route("/api/archive_todo", methods=['POST'])
def archive_todo():
    if g.user:
        data = request.get_json()
        todo_id = data.get('toDoId')
        todo = UserTodo.query.filter_by(id=todo_id).first()
        if todo and g.user == todo.user:
            todo.archived = True
            db.session.commit()
            return jsonify(success=True)
        else:
            return jsonify(success=False,reason="To do does not exist.")
    else:
        return jsonify(success=False,reason="Not logged in.")

@app.route("/api/unarchive_todo", methods=['POST'])
def unarchive_todo():
    if g.user:
        data = request.get_json()
        todo_id = data.get('toDoId')
        todo = UserTodo.query.filter_by(id=todo_id).first()
        if todo and g.user == todo.user:
            todo.archived = False
            db.session.commit()
            return jsonify(success=True, todo=todo.return_json())
        else:
            return jsonify(success=False,reason="To do does not exist.")
    else:
        return jsonify(success=False,reason="Not logged in.")

@app.route("/api/toggle_todo", methods=['POST'])
def toggle_todo():
    if g.user:
        data = request.get_json()
        todo_id = data.get('toDoId')
        status = data.get('status')
        todo = UserTodo.query.filter_by(id=todo_id).first()
        if todo and g.user == todo.user:
            if status == "1":
                todo.completed = True 
                todo.date_completed = datetime.now()
            elif status == "0":
                todo.completed = False
                todo.date_completed = None
            else:
                todo.completed = not todo.completed
                if todo.completed:
                    todo.date_completed = datetime.now()
                else:
                    todo.date_completed = None
            db.session.commit()
            return jsonify(success=True)
        else:
            return jsonify(success=False,reason="To do does not exist.")
    else:
        return jsonify(success=False,reason="Not logged in.")

@app.route("/api/save_agenda_notes", methods=['POST'])
def save_agenda_notes():
    if g.user:
        data = request.get_json()
        content = data.get('content')
        g.user.edit_agenda_notes(content)
        return jsonify(success=True)
    else:
        return jsonify(success=False,reason="Not logged in.")

#================================================EXTERNAL API=================================================#

@app.route("/api/external/get-notes", methods=['POST'])
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

@app.route("/api/external/get-note", methods=['POST'])
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

@app.route("/api/external/add-note", methods=['POST'])
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

@app.route("/api/external/edit-note", methods=['POST'])
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


#==============================================request handling===============================================#

@app.before_request
def before_request():
    if CONFIG.ENFORCE_SSL:
        "ENFORCING SSL"
        if not request.is_secure:
            url = request.url.replace('http://', 'https://', 1)
            code = 301
            return redirect(url, code=code)
    "CHECKING/SETTING GLOBAL USER"
    session.modified = True
    g.user = None
    if 'user_id' in session:
        user = User.query.filter_by(id=session['user_id']).first()
        if user is not None:
            if user.id == session['user_id']:
                g.user = user


if CONFIG.DISABLE_CACHING:
    @app.after_request
    def after_request(response):
        response.headers["Cache-Control"] = " no-store,  max-age=0"
        return response

#==============================================Public Endpoints===============================================#


@app.route("/")
def index_page():
    if g.user:
        return redirect(url_for('notes_page'))
    else:
        return redirect(url_for('login_page'))

@app.route("/settings", methods=['GET','POST'])
def settings_page():
    if g.user:
        g.user.generate_missing_settings()
        settings = g.user.return_settings()
        if request.method == "POST":
            if "update-theme" in request.form:
                theme = request.form['theme']
                g.user.settings.theme_preference = theme
                db.session.commit()
            return redirect(url_for('settings_page'))
        return render_template("settings.html", themes = Theme.query.all())
    return "You must be logged in to access this page."

@app.route("/register", methods = ['GET','POST'])
def register_page():
    if request.method == 'POST':
        # if recaptcha.verify(): # Use verify() method to see if ReCaptcha is filled out
        if True: # disable ReCaptcha
            user_username = request.form['username'].lower()
            user_email = request.form['email'].lower()
            user_pw = request.form['password']
            if has_banned_chars(user_username) or " " in user_username:
                return "Illegal username."
            if not valid_email(user_email):
                return "Illegal email."
            if len(user_username) < 4:
                return "Your username must be at least 4 characters."
            if User.query.filter_by(username=user_username).first() is None:
                if User.query.filter_by(email=user_email).first() is None:
                    new_user = User(user_username,user_pw,user_email)
                    db.session.commit()
                    return redirect(url_for('login_page'))
                else:
                    return "There is already an account with this email address."
            else:
                return "There is already an account with this username."
    return render_template("register.html")

@app.route("/login", methods = ['GET','POST'])
def login_page():
    if request.method == 'POST':
        session.pop('user_id', None)
        the_username = request.form['username'].lower()
        password = request.form['password']
        user = User.query.filter_by(username=the_username).first()
        if user and bcrypt.checkpw(str(password).encode('utf-8'),user.password):
            session['user_id'] = user.id
            session.permanent = True
            theme = user.return_settings().theme_preference
            return redirect(url_for('notes_page'))
        else:
            return 'The username or password is not correct. You can try again via the <a href="/login">Login Page</a>.'
    return render_template("login.html")

@app.route("/logout")
def logout():
    if g.user:
        session.pop('user_id', None)
        return redirect(url_for('login_page'))
    else:
        return redirect(url_for('login_page'))

@app.route("/notes")
def notes_page():
    if g.user:
        theme_settings = g.user.get_theme_settings()
        theme = theme_settings.theme
        if theme.has_notes_page:
            return render_template(f"themes/{theme_settings.theme.slug}/notes.html", notes = g.user.return_notes())
        else:
            return redirect(url_for('note_single_page', note_id = 0))
    else:
        return "You must log in."

@app.route("/categories")
def categories_page():
    if g.user:
        theme_settings = g.user.get_theme_settings()
        theme = theme_settings.theme
        if theme.has_categories_page:
            categories = g.user.categories
            return render_template(f"themes/{theme_settings.theme.slug}/categories.html", categories = categories)
        else:
            return render_template(f"themes/{theme_settings.theme.slug}/notes.html", categories = categories)
    return 'You are not logged in. Please login using the <a href="/login">Login Page</a>.'

@app.route("/categories/<int:category>")
def category_single_page(category):
    if g.user:
        theme_settings = g.user.get_theme_settings()
        theme = theme_settings.theme
        category = g.user.get_category(category)
        notes = UserNote.query.filter_by(userid=g.user.id,category_id=category.id).all()
        return render_template(f"themes/{theme_settings.theme.slug}/notes.html", category = category, notes_of_category = True, notes = notes)
    return 'You are not logged in. Please login using the <a href="/login">Login Page</a>.'

@app.route("/note/<int:note_id>", methods=['GET','POST'])
def note_single_page(note_id):
    if g.user:
        theme_settings = g.user.get_theme_settings()
        font_size = g.user.get_current_theme_font_size()
        note = UserNote.query.filter_by(id=note_id).first()
        if note and note is not None:
            if g.user != note.user:
                return "You do not own this note. Click here to go to your <a href='/notes'>notes</a>."
        if request.method == "POST":
            if note_id == 0:
                if "update-note" in request.form:
                    note_title = request.form['title']
                    note_content = request.form['content']
                    try:
                        note_category = request.form['category']
                    except:
                        note_category = ""
                    if len(note_title) < 1:
                        note_title = None
                    if len(note_content) < 1:
                        note_content = None
                    if len(note_category) < 1:
                        note_category = None
                    note = g.user.add_note(note_title,note_content,note_category)
                    return redirect(url_for('note_single_page', note_id = note.id))
            else:
                if "revert_to_last_version" in request.form:
                    note.revert_to_last_version()
                    return redirect(url_for('note_single_page', note_id = note.id))
                elif "delete_note" in request.form:
                    g.user.delete_note(note_id)
                    return redirect(url_for('notes_page'))
                elif "update-note" in request.form:
                    note_title = request.form['title']
                    note_content = request.form['content']
                    try:
                        note_category = request.form['category']
                    except:
                        note_category = ""
                    if len(note_title) < 1:
                        note_title = None
                    if len(note_content) < 1:
                        note_content = None
                    if len(note_category) < 1:
                        note_category = None
                    note.change_title(note_title)
                    note.change_content(note_content)
                    note.change_category(note_category)
                return redirect(url_for('note_single_page', note_id = note.id))
        category = request.args.get('category')
        return render_template(f"themes/{theme_settings.theme.slug}/note_single.html", note = note, note_id = note_id, font_size = font_size, category = category)
    return "You must log in."

@app.route("/search")
def search_page():
    if g.user:
        query = request.args.get('q')
        if query and query is not None:
            notes = UserNote.query.filter_by(userid=g.user.id).filter(UserNote.content.contains(query)).all()
            notes += UserNote.query.filter_by(userid=g.user.id).filter(UserNote.title.contains(query)).all()
            return render_template("search.html", query = query, notes = notes)
        return render_template("search.html", query = query)
    else:
        return "You must log in."

@app.route("/agenda")
def agenda_page():
    if g.user:
        events = UserEvent.query.filter_by(userid=g.user.id).filter(UserEvent.date_of_event != None).order_by(UserEvent.date_of_event.asc()).all()
        events += UserEvent.query.filter_by(userid=g.user.id, date_of_event = None).all()
        todos = UserTodo.query.filter_by(userid=g.user.id,archived=False).filter(UserTodo.date_due != None).order_by(UserTodo.date_due.asc()).all()
        todos += UserTodo.query.filter_by(userid=g.user.id,archived=False).filter(UserTodo.date_due == None).all()
        return render_template("agenda.html", todos = todos, events = events)
    else:
        return "You must log in."

@app.route("/cli")
def cli():
    if g.user:
        return render_template("themes/cli/cli.html")
    else:
        return "You must log in."

#=============================================================================================================#
#====================================================Other====================================================#
#=============================================================================================================#

if CONFIG.ENFORCE_SSL:
    @app.route("/.well-known/pki-validation/valid.txt")
    def ssl_validation():
        return "validate ssl here."

@app.route("/manifest.json")
def manifest_json():
    return redirect("/static/script/manifest.json")

with app.app_context():
    db.create_all()
    if Theme.query.filter_by(slug="paper").first() is None:
        paper = Theme(name="Paper",slug="paper", has_categories_page = True, has_notes_page = True)
        db.session.add(paper)
    if Theme.query.filter_by(slug="full").first() is None:
        full = Theme(name="Full",slug="full", has_categories_page = True, has_notes_page = True)
        db.session.add(full)
    if Theme.query.filter_by(slug="dash").first() is None:
        dash = Theme(name="Dash",slug="dash", has_categories_page = False, has_notes_page = False)
        db.session.add(dash)
    if Theme.query.filter_by(slug="cozy").first() is None:
        cozy = Theme(name="Cozy",slug="cozy", has_categories_page = False, has_notes_page = False)
        db.session.add(cozy)
    if Theme.query.filter_by(slug="sage").first() is None:
        sage = Theme(name="Sage",slug="sage", has_categories_page = False, has_notes_page = False)
        db.session.add(sage)
    if Theme.query.filter_by(slug="segment").first() is None:
        segment = Theme(name="Segment",slug="segment", has_categories_page = False, has_notes_page = False)
        db.session.add(segment)
    if Theme.query.filter_by(slug="tahta").first() is None:
        tahta = Theme(name="Tahta",slug="tahta", has_categories_page = False, has_notes_page = False)
        db.session.add(tahta)
    db.session.commit()

    
