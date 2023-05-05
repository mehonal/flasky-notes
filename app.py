from flask import Flask, render_template, request, session, redirect, url_for, g, jsonify
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, timedelta
import supersecret # file containing sensitive info
import bcrypt # for encrypting/decrypting passwords
import logging
# from flask_migrate import Migrate # uncomment for migrations
# import urllib.parse # for parsing encoded URIComponents
import re
import config as CONFIG

#=============================================================================================================#
#================================================APP SETTINGS=================================================#
#=============================================================================================================#


app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = supersecret.db_uri
app.config['SECRET_KEY'] = supersecret.secret_key
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

app.permanent_session_lifetime = timedelta(days=CONFIG.SESSION_LIFETIME)

db = SQLAlchemy(app)

'''
migrate = Migrate(app, db, render_as_batch=True) # uncomment for migrations

TO RUN MIGRATIONS:
$ flask db init
$ flask db stamp head
$ flask db migrate
$ flask db upgrade

'''

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

class UserSettings(db.Model):
    id = db.Column(db.Integer, primary_key = True)
    theme_preference = db.Column(db.String(100), default = "paper")
    theme_paper_font_size = db.Column(db.Integer, default = 16)
    theme_paper_dark_theme = db.Column(db.Boolean, default = False) # not implemented yet
    theme_paper_font = db.Column(db.String(250), default = "sans-serif") # not implemented yet
    theme_full_font_size = db.Column(db.Integer, default = 16)
    theme_full_dark_theme = db.Column(db.Boolean, default = False)
    theme_full_notes_row_count = db.Column(db.Integer, default = 3)
    theme_full_notes_height = db.Column(db.Integer, default = 150)
    theme_full_font = db.Column(db.String(250), default = "sans-serif")
    theme_dash_font_size = db.Column(db.Integer, default = 16)
    theme_dash_dark_theme = db.Column(db.Boolean, default = False)
    theme_dash_font = db.Column(db.String(250), default = "sans-serif")


class User(db.Model):
    id = db.Column(db.Integer, primary_key = True, autoincrement = True)
    settingsid = db.Column(db.Integer, db.ForeignKey('user_settings.id'), unique = True)
    username = db.Column(db.String(30), unique = True)
    password = db.Column(db.String(280))
    email = db.Column(db.String(300), unique = True)
    plan = db.Column(db.Integer, default = 0)
    user_type = db.Column(db.Integer, default = 0)
    settings = db.relationship('UserSettings', uselist = False, backref= "user")

    def get_current_theme_font(self):
        try:
            settings = self.return_settings()
            theme = settings.theme_preference
            if theme == "paper":
                return settings.theme_paper_font
            elif theme == "full":
                return settings.theme_full_font
            elif theme == "dash":
                return settings.theme_dash_font
            print("Could not find theme to use to retrieve font via User.get_current_theme_font. Using default (sans-serif)")
            return "sans-serif"
        except:
            print("Could not retrieve font via User.get_current_theme_font. Using default (sans-serif)")
            return "sans-serif"

    def get_current_theme_notes_height(self):
        try:
            settings = self.return_settings()
            theme = settings.theme_preference
            if theme == "full":
                return settings.theme_full_notes_height
            print("Could not find theme to use to retrieve note height for notes via User.get_current_theme_notes_height. Using default (150)")
            return 150
        except:
            print("Could not retrieve note height for notes via User.get_current_theme_notes_height. Using default (150)")
            return 150

    def get_current_theme_notes_row_count(self):
        try:
            settings = self.return_settings()
            theme = settings.theme_preference
            if theme == "full":
                return settings.theme_full_notes_row_count
            print("Could not find theme to use to retrieve row count preference for notes via User.get_current_theme_notes_row_count. Using default (3)")
            return 3
        except:
            print("Could not retrieve row count preference for notes via User.get_current_theme_notes_row_count. Using default (3)")
            return 3

    def get_current_theme_dark_mode(self):
        try:
            settings = self.return_settings()
            theme = settings.theme_preference
            if theme == "paper":
                return settings.theme_paper_dark_theme
            elif theme == "full":
                return settings.theme_full_dark_theme
            elif theme == "dash":
                return settings.theme_dash_dark_theme
            print("Could not find theme to use to retrieve dark mode preference via User.get_current_theme_dark_mode. Using default (off)")
            return False
        except:
            print("Could not retrieve dark mode preference via User.get_current_theme_dark_mode. Using default (off)")
            return False

    def get_current_theme_font_size(self):
        try:
            settings = self.return_settings()
            theme = settings.theme_preference
            if theme == "paper":
                font_size = settings.theme_paper_font_size
                if font_size is None:
                    font_size = 16
                    db.session.commit()
                return font_size
            elif theme == "full":
                font_size = settings.theme_full_font_size
                if font_size is None:
                    font_size = 16
                    db.session.commit()
                return font_size
            elif theme == "dash":
                font_size = settings.theme_dash_font_size
                if font_size is None:
                    font_size = 16
                    db.session.commit()
                return font_size
            print("Could not find theme to use for font size via User.return_current_theme_font_size. Using default (16)")
            return 16
        except:
            print("Could not retrieve font size via User.return_current_theme_font_size. Using default (16)")
            return 16

    def update_theme_font(self, theme, new_font):
        settings = self.return_settings()
        if settings is None:
            print("Settings not found!")
            return False
        if theme == "paper":
            settings.theme_paper_font = new_font
        elif theme == "full":
            settings.theme_full_font = new_font
        elif theme == "dash":
            settings.theme_dash_font = new_font
        else:
            print("Could not find theme to update font via User.update_theme_font. No action was taken.")
            return False
        db.session.commit()
        return True

    def update_theme_notes_height(self, theme, new_height):
        settings = self.return_settings()
        if settings is None:
            print("Settings not found!")
            return False
        if theme == "full":
            settings.theme_full_notes_height = new_height
            db.session.commit()
        return True

    def update_theme_notes_row_count(self, theme, new_row_count):
        settings = self.return_settings()
        if settings is None:
            print("Settings not found!")
            return False
        if theme == "full":
            settings.theme_full_notes_row_count = new_row_count
            db.session.commit()
        return True

    def update_theme_dark_mode(self, theme, dark_mode):
        settings = self.return_settings()
        if settings is None:
            print("Settings not found!")
            return False
        if theme == "paper":
            settings.theme_paper_dark_theme = dark_mode
        elif theme == "full":
            settings.theme_full_dark_theme = dark_mode
        elif theme == "dash":
            settings.theme_dash_dark_theme = dark_mode
        db.session.commit()
        return True

    def update_theme_font_size(self, theme, new_font_size):
        settings = self.return_settings()
        if settings is None:
            print("Settings not found!")
            return False
        if theme == "paper":
            settings.theme_paper_font_size = new_font_size
        elif theme == "full":
            settings.theme_full_font_size = new_font_size
        elif theme == "dash":
            settings.theme_dash_font_size = new_font_size
        db.session.commit()
        return True

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

    def return_notes(self):
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
            if category is not None:
                category = category.strip()
            note = UserNote(self.id,title,content,category)
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
    id = db.Column(db.Integer, primary_key = True, autoincrement = True)
    userid = db.Column(db.ForeignKey('user.id'))
    title = db.Column(db.String(1_000))
    content = db.Column(db.String(1_000_000))
    previous_content = db.Column(db.String(1_000_000))
    category = db.Column(db.String(100))
    date_added = db.Column(db.DateTime)
    date_last_changed = db.Column(db.DateTime)
    user = db.relationship('User', backref="notes")

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
        if new_category is not None:
            self.category = new_category.strip()
        else:
            self.category = new_category
        self.date_last_changed = datetime.now()
        db.session.commit()

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

    def __init__(self,userid,title,content,category):
        self.userid = userid
        self.title = title
        self.content = content
        self.category = category
        self.date_added = datetime.now()
        self.date_last_changed = datetime.now()
        db.session.add(self)
        db.session.commit()


#=============================================================================================================#
#=================================================APP ROUTES==================================================#
#=============================================================================================================#

#=====================================================API=====================================================#


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
        theme = g.user.return_settings().theme_preference
        if theme == "paper":
            return redirect(url_for('paper_notes_page'))
        elif theme == "full":
                return redirect(url_for('full_notes_page'))
        else: # assuming it is "dash"
            return redirect(url_for('dash_note_single_page', note_id = 0))
    else:
        return redirect(url_for('login_page'))

@app.route("/settings", methods=['GET','POST'])
def settings_page():
    if g.user:
        if request.method == "POST":
            if "update_to_paper" in request.form:
                settings = g.user.return_settings()
                if settings is not None:
                    settings.theme_preference = "paper"
                    db.session.commit()
                else:
                    print("Could not update theme preference to full via route /settings")
            elif "update_to_full" in request.form:
                settings = g.user.return_settings()
                if settings is not None:
                    settings.theme_preference = "full"
                    db.session.commit()
                else:
                    print("Could not update theme preference to full via route /settings")
            elif "update_to_dash" in request.form:
                settings = g.user.return_settings()
                if settings is not None:
                    settings.theme_preference = "dash"
                    db.session.commit()
                else:
                    print("Could not update theme preference to full via route /settings")
            return redirect(url_for('settings_page'))
        return render_template("settings.html")
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
            if theme == "paper":
                return redirect(url_for('paper_notes_page'))
            elif theme == "full":
                return redirect(url_for('full_notes_page'))
            else: # assuming it is "dash"
                return redirect(url_for('dash_note_single_page', note_id = 0))
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
        if g.user.return_settings().theme_preference == "paper":
            return redirect(url_for('paper_notes_page'))
        elif g.user.return_settings().theme_preference == "full":
            return redirect(url_for('full_notes_page'))
        elif g.user.return_settings().theme_preference == "dash":
            return redirect(url_for('dash_note_single_page', note_id = 0))
        return "No theme found. Please select one from <a href='/settings'>Settings</a>."
    else:
        return "You must log in."

@app.route("/notes/paper")
def paper_notes_page():
    if g.user:
        if g.user.return_settings().theme_preference == "full":
            return redirect(url_for('full_notes_page'))
        elif g.user.return_settings().theme_preference == "dash":
            return redirect(url_for('dash_note_single_page', note_id = 0))
        return render_template("themes/paper/notes.html")
    else:
        return "You must log in."

@app.route("/notes/full")
def full_notes_page():
    if g.user:
        if g.user.return_settings().theme_preference == "paper":
            return redirect(url_for('paper_notes_page'))
        elif g.user.return_settings().theme_preference == "dash":
            return redirect(url_for('dash_note_single_page', note_id = 0))
        return render_template("themes/full/notes.html")
    else:
        return "You must log in."

@app.route("/categories")
def categories_page():
    if g.user:
        categories = []
        for note in UserNote.query.filter_by(userid=g.user.id).all():
            note_categories = note.category
            if note_categories is not None:
                categories.extend(note_categories.lower().split(","))
        categories = set(categories)
        return render_template("themes/paper/categories.html", categories = categories)
    else:
        return "You must log in."

@app.route("/notes/<category>")
def paper_notes_with_category_page(category):
    if g.user:
        notes = []
        for note in g.user.notes:
            if note.category is not None:
                for note_category in note.category.split(","):
                    if category.strip().lower() == note_category.strip().lower():
                        notes.append(note)
        return render_template("themes/paper/notes.html", category = category, notes_of_category = True, notes = notes)
    else:
        return "You must log in."

@app.route("/note/<int:note_id>")
def note_single_page(note_id):
    if g.user:
        if g.user.return_settings().theme_preference == "paper":
            return redirect(url_for('paper_note_single_page', note_id = note_id))
        elif g.user.return_settings().theme_preference == "full":
            return redirect(url_for('full_note_single_page', note_id = note_id))
        elif g.user.return_settings().theme_preference == "dash":
            return redirect(url_for('dash_note_single_page', note_id = note_id))
        return "No theme found. Please select one from <a href='/settings'>Settings</a>."
    return "Not Found."

@app.route("/note/<int:note_id>/paper", methods=['GET','POST'])
def paper_note_single_page(note_id):
    if g.user:
        if request.method == "GET":
            if g.user.return_settings().theme_preference == "full":
                return redirect(url_for('full_note_single_page', note_id = note_id))
            elif g.user.return_settings().theme_preference == "dash":
                return redirect(url_for('dash_note_single_page', note_id = note_id))
        font_size = g.user.get_current_theme_font_size()
        if note_id == 0:
            if request.method == "POST":
                note_title = request.form['title']
                note_content = request.form['content']
                note_category = request.form['category']
                if len(note_title) < 1:
                    note_title = None
                if len(note_content) < 1:
                    note_content = None
                if len(note_category) < 1:
                    note_category = None
                note = g.user.add_note(note_title,note_content,note_category)
                return redirect(url_for('paper_note_single_page', note_id = note.id))
            return render_template("themes/paper/note_single.html", font_size=font_size)
        note = UserNote.query.filter_by(id=note_id).first()
        if note and note is not None:
            if g.user == note.user:
                if request.method == "POST":
                    if "revert_to_last_version" in request.form:
                        note.revert_to_last_version()
                        return redirect(url_for('paper_note_single_page', note_id = note.id))
                    if "delete_note" in request.form:
                        g.user.delete_note(note_id)
                        return redirect(url_for('paper_notes_page'))
                    note_title = request.form['title']
                    note_content = request.form['content']
                    note_category = request.form['category']
                    if len(note_title) < 1:
                        note_title = None
                    if len(note_content) < 1:
                        note_content = None
                    if len(note_category) < 1:
                        note_category = None
                    note.change_title(note_title)
                    note.change_content(note_content)
                    note.change_category(note_category)
                    return redirect(url_for('paper_note_single_page', note_id = note.id))
                return render_template("themes/paper/note_single.html", note = note, font_size=font_size)
            else:
                return "You do not own this note. Click here to go to your <a href='/notes'>notes</a>."
    return "Not Found."

@app.route("/note/<int:note_id>/full", methods=['GET','POST'])
def full_note_single_page(note_id):
    if g.user:
        if request.method == "GET":
            if g.user.return_settings().theme_preference == "paper":
                return redirect(url_for('paper_note_single_page', note_id = note_id))
            elif g.user.return_settings().theme_preference == "dash":
                return redirect(url_for('dash_note_single_page', note_id = note_id))
        font_size = g.user.get_current_theme_font_size()
        if note_id != 0:
            note = UserNote.query.filter_by(id=note_id).first()
        else:
            note = None
        if note and note is not None:
            if g.user == note.user:
                if request.method == "POST":
                    if "delete_note" in request.form:
                        g.user.delete_note(note_id)
                        return redirect(url_for('full_notes_page'))
                    note_title = request.form['title']
                    note_content = request.form['content']
                    note.change_title(note_title)
                    note.change_content(note_content)
                    if len(note_title) < 1:
                        note_title = None
                    if len(note_content) < 1:
                        note_content = None
                    return redirect(url_for('full_note_single_page', note_id = note.id))
            else:
                return "You do not own this note. Click here to go to your <a href='/notes'>notes</a>."
        else:
            if request.method == "POST":
                note_title = request.form['title']
                note_content = request.form['content']
                if len(note_title) < 1:
                    note_title = None
                if len(note_content) < 1:
                    note_content = None
                note = g.user.add_note(note_title,note_content,None)
                return redirect(url_for('full_note_single_page', note_id = note.id))
        return render_template("themes/full/note_single.html", note = note, note_id = note_id, font_size = font_size)

@app.route("/note/<int:note_id>/dash", methods = ['GET','POST'])
def dash_note_single_page(note_id):
    if g.user:
        if request.method == "GET":
            if g.user.return_settings().theme_preference == "paper":
                return redirect(url_for('paper_note_single_page', note_id = note_id))
            elif g.user.return_settings().theme_preference == "full":
                return redirect(url_for('full_note_single_page', note_id = note_id))
        font_size = g.user.get_current_theme_font_size()
        if note_id != 0:
            note = UserNote.query.filter_by(id=note_id).first()
        else:
            note = None
        if note and note is not None:
            if g.user == note.user:
                if request.method == "POST":
                    if "delete_note" in request.form:
                        g.user.delete_note(note_id)
                        return redirect(url_for('dash_note_single_page', note_id = 0))
                    note_title = request.form['title']
                    note_content = request.form['content']
                    note.change_title(note_title)
                    note.change_content(note_content)
                    if len(note_title) < 1:
                        note_title = None
                    if len(note_content) < 1:
                        note_content = None
                    return redirect(url_for('dash_note_single_page', note_id = note.id))
            else:
                return "You do not own this note. Click here to go to your <a href='/notes'>notes</a>."
        else:
            if request.method == "POST":
                note_title = request.form['title']
                note_content = request.form['content']
                if len(note_title) < 1:
                    note_title = None
                if len(note_content) < 1:
                    note_content = None
                note = g.user.add_note(note_title,note_content,None)
                return redirect(url_for('dash_note_single_page', note_id = note.id))
        return render_template("themes/dash/dash.html", note = note, font_size = font_size)
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