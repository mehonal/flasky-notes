from flask import Blueprint, render_template, request, session, redirect, url_for, g, jsonify
from datetime import datetime, timedelta
import bcrypt
import re

import config as CONFIG
from flasky import db
from flasky.models import (
    User, UserNote, UserNoteCategory, UserTodo, UserEvent,
    Theme, UserTheme, UserSettings, ApiToken, SyncConflict, Attachment, NoteTemplate
)
from flasky.utils import has_banned_chars, valid_email, generate_api_token
from zoneinfo import available_timezones

web_bp = Blueprint('web', __name__)


@web_bp.before_app_request
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


@web_bp.route("/")
def index_page():
    if g.user:
        return redirect(url_for('web.notes_page'))
    else:
        return redirect(url_for('web.login_page'))

@web_bp.route("/settings", methods=['GET','POST'])
def settings_page():
    if g.user:
        g.user.generate_missing_settings()
        settings = g.user.return_settings()
        if request.method == "POST":
            if "update-theme" in request.form:
                theme = request.form['theme']
                g.user.settings.theme_preference = theme
                db.session.commit()
            elif "update-timezone" in request.form:
                timezone = request.form['timezone']
                g.user.set_timezone(timezone)
            elif "update-font-family" in request.form:
                font = request.form['font-family']
                g.user.update_theme_font(g.user.settings.theme_preference, font)
            elif "generate-api-token" in request.form:
                token_name = request.form.get('token-name', '').strip()
                if not token_name:
                    token_name = "Unnamed Token"
                plaintext, token_hash = generate_api_token()
                new_token = ApiToken(user_id=g.user.id, token_hash=token_hash, name=token_name)
                db.session.add(new_token)
                db.session.commit()
                tokens = ApiToken.query.filter_by(user_id=g.user.id).all()
                return render_template("settings.html", themes=Theme.query.all(), timezones=available_timezones(), tokens=tokens, new_token=plaintext)
            elif "revoke-api-token" in request.form:
                token_id = request.form.get('token-id')
                token = ApiToken.query.filter_by(id=token_id, user_id=g.user.id).first()
                if token:
                    db.session.delete(token)
                    db.session.commit()
            elif "toggle-obsidian-sync" in request.form:
                settings.obsidian_sync_enabled = not settings.obsidian_sync_enabled
                db.session.commit()
            elif "resolve-conflict" in request.form:
                conflict_id = request.form.get('conflict-id')
                resolution = request.form.get('resolution')
                conflict = SyncConflict.query.filter_by(id=conflict_id, user_id=g.user.id).first()
                if conflict and resolution in ('local', 'server'):
                    if conflict.note_id:
                        note = UserNote.query.filter_by(userid=g.user.id, id=conflict.note_id).first()
                        if note:
                            if resolution == 'local':
                                note.change_title(conflict.local_title)
                                note.change_content(conflict.local_content)
                            else:
                                note.change_title(conflict.server_title)
                                note.change_content(conflict.server_content)
                    conflict.resolved = True
                    db.session.commit()
            return redirect(url_for('web.settings_page'))
        tokens = ApiToken.query.filter_by(user_id=g.user.id).all()
        conflicts = SyncConflict.query.filter_by(user_id=g.user.id, resolved=False).order_by(SyncConflict.conflict_date.desc()).all()
        return render_template("settings.html", themes=Theme.query.all(), timezones=available_timezones(), tokens=tokens, conflicts=conflicts, sync_enabled=settings.obsidian_sync_enabled)
    return "You must be logged in to access this page."

@web_bp.route("/register", methods = ['GET','POST'])
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
            if len(user_username) > 30:
                return "Your username must be at most 30 characters."
            if len(user_pw) < 8:
                return "Your password must be at least 8 characters."
            if len(user_pw) > 100:
                return "Your password must be at most 100 characters."
            if User.query.filter_by(username=user_username).first() is None:
                if User.query.filter_by(email=user_email).first() is None:
                    new_user = User(user_username,user_pw,user_email)
                    db.session.commit()
                    return redirect(url_for('web.login_page'))
                else:
                    return "There is already an account with this email address."
            else:
                return "There is already an account with this username."
    return render_template("register.html")

@web_bp.route("/login", methods = ['GET','POST'])
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
            return redirect(url_for('web.notes_page'))
        else:
            return 'The username or password is not correct. You can try again via the <a href="/login">Login Page</a>.'
    return render_template("login.html")

@web_bp.route("/logout")
def logout():
    if g.user:
        session.pop('user_id', None)
        return redirect(url_for('web.login_page'))
    else:
        return redirect(url_for('web.login_page'))

@web_bp.route("/notes")
def notes_page():
    if g.user:
        theme_settings = g.user.get_theme_settings()
        theme = theme_settings.theme
        if theme.has_notes_page:
            return render_template(f"themes/{theme_settings.theme.slug}/notes.html", notes = g.user.return_notes())
        else:
            return redirect(url_for('web.note_single_page', note_id = 0))
    else:
        return "You must log in."

@web_bp.route("/categories")
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

@web_bp.route("/categories/<int:category>")
def category_single_page(category):
    if g.user:
        theme_settings = g.user.get_theme_settings()
        theme = theme_settings.theme
        category = g.user.get_category(category)
        notes = UserNote.query.filter_by(userid=g.user.id,category_id=category.id).all()
        return render_template(f"themes/{theme_settings.theme.slug}/notes.html", category = category, notes_of_category = True, notes = notes)
    return 'You are not logged in. Please login using the <a href="/login">Login Page</a>.'

@web_bp.route("/note/<int:note_id>", methods=['GET','POST'])
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
                    return redirect(url_for('web.note_single_page', note_id = note.id))
            else:
                if "revert_to_last_version" in request.form:
                    note.revert_to_last_version()
                    return redirect(url_for('web.note_single_page', note_id = note.id))
                elif "delete_note" in request.form:
                    g.user.delete_note(note_id)
                    return redirect(url_for('web.notes_page'))
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
                return redirect(url_for('web.note_single_page', note_id = note.id))
        category = request.args.get('category')
        category_tree = g.user.get_category_tree()
        default_template = None
        if note_id == 0 and category:
            cat_obj = UserNoteCategory.query.filter_by(user_id=g.user.id, name=category).first()
            if cat_obj and cat_obj.default_template_id:
                default_template = NoteTemplate.query.get(cat_obj.default_template_id)
        panel_widgets = theme_settings.get_panel_widgets()
        return render_template(f"themes/{theme_settings.theme.slug}/note_single.html", note = note, note_id = note_id, font_size = font_size, category = category, theme_settings = theme_settings, category_tree = category_tree, default_template = default_template, panel_widgets = panel_widgets)
    return "You must log in."

@web_bp.route("/search")
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

@web_bp.route("/agenda")
def agenda_page():
    if g.user:
        events = UserEvent.query.filter_by(userid=g.user.id).filter(UserEvent.date_of_event > (datetime.utcnow() - timedelta(days=1))).order_by(UserEvent.date_of_event.asc()).all()
        events += UserEvent.query.filter_by(userid=g.user.id, date_of_event = None).all()
        todos = UserTodo.query.filter_by(userid=g.user.id,archived=False).filter(UserTodo.date_due != None).order_by(UserTodo.date_due.asc()).all()
        todos += UserTodo.query.filter_by(userid=g.user.id,archived=False).filter(UserTodo.date_due == None).all()
        return render_template("agenda.html", todos = todos, events = events)
    else:
        return "You must log in."

@web_bp.route("/cli")
def cli():
    if g.user:
        return render_template("themes/cli/cli.html")
    else:
        return "You must log in."

@web_bp.route("/manifest.json")
def manifest_json():
    page = request.args.get('page')
    if page not in ['agenda', 'notes']:
        page = "notes"
    if page == "notes":
        return redirect("/static/script/manifest.json")
    elif page == "agenda":
        return redirect("/static/script/manifest-agenda.json")

@web_bp.route("/attachment/<int:attachment_id>/<filename>")
def serve_attachment(attachment_id, filename):
    import os
    from flask import send_from_directory, current_app
    if not g.user:
        return "Unauthorized", 401
    a = Attachment.query.filter_by(id=attachment_id, user_id=g.user.id).first()
    if a is None:
        return "Not found", 404
    disk = a.disk_path()
    if not os.path.exists(disk):
        return "Not found", 404
    return send_from_directory(os.path.dirname(disk), os.path.basename(disk), mimetype=a.content_type)
