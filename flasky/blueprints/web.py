from flask import Blueprint, render_template, request, session, redirect, url_for, g, jsonify
from datetime import datetime, timedelta
import bcrypt
import re

import config as CONFIG
from flasky import db
from flasky.models import (
    User, UserNote, UserNoteCategory, UserTodo, UserEvent,
    Theme, UserTheme, UserSettings, ApiToken, SyncConflict, Attachment, NoteTemplate,
    UserAgendaNotes
)
from flasky.utils import has_banned_chars, valid_email, generate_api_token, recovery_limiter, login_limiter
from zoneinfo import available_timezones

web_bp = Blueprint('web', __name__)

# Pre-computed dummy hash for constant-time login response when user not found
_DUMMY_BCRYPT_HASH = bcrypt.hashpw(b'dummy', bcrypt.gensalt())

# ============ E2EE Auth API ============

@web_bp.route("/api/auth/register", methods=['POST'])
def api_auth_register():
    """E2EE registration: accepts auth_key (derived hash) instead of raw password."""
    data = request.get_json()
    if not data:
        return jsonify(success=False, reason="Missing request body."), 400
    username = (data.get('username') or '').lower().strip()
    email = (data.get('email') or '').lower().strip()
    auth_key = data.get('auth_key')
    encrypted_sym_key = data.get('encrypted_sym_key')
    recovery_encrypted_key = data.get('recovery_encrypted_key')

    if not username or not email or not auth_key or not encrypted_sym_key:
        return jsonify(success=False, reason="Missing required fields."), 400
    if has_banned_chars(username) or " " in username:
        return jsonify(success=False, reason="Illegal username."), 400
    if not valid_email(email):
        return jsonify(success=False, reason="Illegal email."), 400
    if len(username) < 4:
        return jsonify(success=False, reason="Username must be at least 4 characters."), 400
    if len(username) > 30:
        return jsonify(success=False, reason="Username must be at most 30 characters."), 400
    if User.query.filter_by(username=username).first():
        return jsonify(success=False, reason="Username already taken."), 400
    if User.query.filter_by(email=email).first():
        return jsonify(success=False, reason="Email already in use."), 400

    # Create user with auth_key as the "password" (it gets bcrypt-hashed in __init__)
    new_user = User(username, auth_key, email)
    new_user.encryption_enabled = True
    new_user.encrypted_symmetric_key = encrypted_sym_key
    new_user.recovery_encrypted_key = recovery_encrypted_key
    new_user.encryption_version = 1
    new_user.password_hint = data.get('password_hint', '')
    db.session.commit()

    return jsonify(success=True)


@web_bp.route("/api/auth/login", methods=['POST'])
def api_auth_login():
    """E2EE login: accepts auth_key (derived hash)."""
    data = request.get_json()
    if not data:
        return jsonify(success=False, reason="Missing request body."), 400
    username = (data.get('username') or '').lower().strip()
    auth_key = data.get('auth_key')
    if not username or not auth_key:
        return jsonify(success=False, reason="Missing username or auth_key."), 400

    if login_limiter.is_limited():
        return jsonify(success=False, reason="Too many login attempts. Try again later."), 429

    user = User.query.filter_by(username=username).first()
    if not user:
        bcrypt.checkpw(auth_key.encode('utf-8'), _DUMMY_BCRYPT_HASH)
        login_limiter.record()
        return jsonify(success=False, reason="Invalid credentials."), 401
    if not bcrypt.checkpw(auth_key.encode('utf-8'), user.password):
        login_limiter.record()
        return jsonify(success=False, reason="Invalid credentials."), 401

    session['user_id'] = user.id
    session.permanent = True

    return jsonify(
        success=True,
        encrypted_sym_key=user.encrypted_symmetric_key,
        encryption_enabled=user.encryption_enabled
    )


@web_bp.route("/api/auth/change_password", methods=['POST'])
def api_auth_change_password():
    """Change password for E2EE user. Client re-wraps symmetric key with new KEK."""
    if not g.user:
        return jsonify(success=False, reason="Not logged in."), 401
    data = request.get_json()
    if not data:
        return jsonify(success=False, reason="Missing request body."), 400
    new_auth_key = data.get('new_auth_key')
    new_encrypted_sym_key = data.get('new_encrypted_sym_key')
    if not new_auth_key or not new_encrypted_sym_key:
        return jsonify(success=False, reason="Missing required fields."), 400

    g.user.password = bcrypt.hashpw(new_auth_key.encode('utf-8'), bcrypt.gensalt())
    g.user.encrypted_symmetric_key = new_encrypted_sym_key
    if data.get('new_recovery_encrypted_key'):
        g.user.recovery_encrypted_key = data['new_recovery_encrypted_key']
    db.session.commit()

    return jsonify(success=True)


@web_bp.route("/api/auth/update_recovery_key", methods=['POST'])
def api_auth_update_recovery_key():
    """Update the recovery-encrypted symmetric key."""
    if not g.user:
        return jsonify(success=False, reason="Not logged in."), 401
    data = request.get_json()
    if not data or not data.get('recovery_encrypted_key'):
        return jsonify(success=False, reason="Missing recovery_encrypted_key."), 400
    g.user.recovery_encrypted_key = data['recovery_encrypted_key']
    db.session.commit()
    return jsonify(success=True)


@web_bp.route("/api/auth/recover", methods=['POST'])
def api_auth_recover():
    """Account recovery using recovery key. Client unwraps with recovery key, sets new password."""
    if recovery_limiter.is_limited():
        return jsonify(success=False, reason="Too many recovery attempts. Try again later."), 429
    recovery_limiter.record()

    data = request.get_json()
    if not data:
        return jsonify(success=False, reason="Missing request body."), 400
    username = (data.get('username') or '').lower().strip()
    new_auth_key = data.get('new_auth_key')
    new_encrypted_sym_key = data.get('new_encrypted_sym_key')
    new_recovery_encrypted_key = data.get('new_recovery_encrypted_key')

    if not username or not new_auth_key or not new_encrypted_sym_key:
        return jsonify(success=False, reason="Missing required fields."), 400

    user = User.query.filter_by(username=username).first()
    if not user:
        # Generic message to prevent username enumeration
        return jsonify(success=False, reason="Recovery failed."), 400

    user.password = bcrypt.hashpw(new_auth_key.encode('utf-8'), bcrypt.gensalt())
    user.encrypted_symmetric_key = new_encrypted_sym_key
    if new_recovery_encrypted_key:
        user.recovery_encrypted_key = new_recovery_encrypted_key
    db.session.commit()

    session['user_id'] = user.id
    session.permanent = True

    return jsonify(success=True)


@web_bp.route("/api/auth/enable_encryption", methods=['POST'])
def api_auth_enable_encryption():
    """Enable E2EE for a legacy user (migration step 1: switch auth)."""
    if not g.user:
        return jsonify(success=False, reason="Not logged in."), 401
    data = request.get_json()
    if not data:
        return jsonify(success=False, reason="Missing request body."), 400
    new_auth_key = data.get('auth_key')
    encrypted_sym_key = data.get('encrypted_sym_key')
    recovery_encrypted_key = data.get('recovery_encrypted_key')

    if not new_auth_key or not encrypted_sym_key:
        return jsonify(success=False, reason="Missing required fields."), 400

    g.user.password = bcrypt.hashpw(new_auth_key.encode('utf-8'), bcrypt.gensalt())
    g.user.encryption_enabled = True
    g.user.encrypted_symmetric_key = encrypted_sym_key
    g.user.recovery_encrypted_key = recovery_encrypted_key
    g.user.encryption_version = 1
    g.user.password_hint = data.get('password_hint', '')
    db.session.commit()

    return jsonify(success=True)


@web_bp.route("/api/migrate/encrypt_data", methods=['POST'])
def api_migrate_encrypt_data():
    """Batch update: replace plaintext data with encrypted ciphertext (migration step 2)."""
    if not g.user:
        return jsonify(success=False, reason="Not logged in."), 401
    if not g.user.encryption_enabled:
        return jsonify(success=False, reason="Encryption not enabled."), 400
    data = request.get_json()
    if not data:
        return jsonify(success=False, reason="Missing request body."), 400

    # Process notes batch
    notes = data.get('notes', [])
    for item in notes:
        note = UserNote.query.filter_by(id=item['id'], userid=g.user.id).first()
        if note:
            note.title = item.get('title', note.title)
            note.content = item.get('content', note.content)
            note.properties = item.get('properties', note.properties)
            note.previous_content = item.get('previous_content', note.previous_content)

    # Process categories batch
    categories = data.get('categories', [])
    for item in categories:
        cat = UserNoteCategory.query.filter_by(id=item['id'], user_id=g.user.id).first()
        if cat:
            cat.name = item.get('name', cat.name)

    # Process todos batch
    todos = data.get('todos', [])
    for item in todos:
        todo = UserTodo.query.filter_by(id=item['id'], userid=g.user.id).first()
        if todo:
            todo.title = item.get('title', todo.title)
            todo.content = item.get('content', todo.content)

    # Process events batch
    events = data.get('events', [])
    for item in events:
        event = UserEvent.query.filter_by(id=item['id'], userid=g.user.id).first()
        if event:
            event.title = item.get('title', event.title)
            event.content = item.get('content', event.content)

    # Process templates batch
    templates = data.get('templates', [])
    for item in templates:
        tmpl = NoteTemplate.query.filter_by(id=item['id'], user_id=g.user.id).first()
        if tmpl:
            tmpl.name = item.get('name', tmpl.name)
            tmpl.content = item.get('content', tmpl.content)
            tmpl.properties = item.get('properties', tmpl.properties)

    # Process agenda notes
    agenda = data.get('agenda_notes')
    if agenda and g.user.agenda_notes:
        g.user.agenda_notes.content = agenda.get('content', g.user.agenda_notes.content)

    db.session.commit()
    return jsonify(success=True)


@web_bp.route("/api/auth/recovery_info")
def api_auth_recovery_info():
    """Return recovery-wrapped key for account recovery. Rate-limited."""
    if recovery_limiter.is_limited():
        return jsonify(recovery_encrypted_key=None, reason="Too many attempts. Try again later."), 429
    recovery_limiter.record()
    username = (request.args.get('username') or '').lower().strip()
    if not username:
        return jsonify(recovery_encrypted_key=None)
    user = User.query.filter_by(username=username).first()
    # Always return same shape response to prevent username enumeration
    if not user or not user.recovery_encrypted_key:
        return jsonify(recovery_encrypted_key=None)
    return jsonify(recovery_encrypted_key=user.recovery_encrypted_key)


@web_bp.route("/unlock")
def unlock_page():
    """Password re-entry page for E2EE users whose sessionStorage key was lost."""
    if not g.user:
        return redirect(url_for('web.login_page'))
    if not g.user.encryption_enabled:
        return redirect(url_for('web.notes_page'))
    return render_template("unlock.html",
                           encrypted_sym_key=g.user.encrypted_symmetric_key,
                           password_hint=g.user.password_hint or '',
                           username=g.user.username)


@web_bp.route("/migrate-encryption")
def migrate_encryption_page():
    """Force-migration page for legacy users who need to enable E2EE."""
    if not g.user:
        return redirect(url_for('web.login_page'))
    if g.user.encryption_enabled:
        return redirect(url_for('web.notes_page'))
    return render_template("migrate_encryption.html", username=g.user.username)


@web_bp.route("/api/migrate/get_all_data")
def api_migrate_get_all_data():
    """Return all plaintext data for a legacy user so the client can encrypt it."""
    if not g.user:
        return jsonify(success=False, reason="Not logged in."), 401
    if g.user.encryption_enabled:
        return jsonify(success=False, reason="Already encrypted."), 400

    notes = []
    for note in UserNote.query.filter_by(userid=g.user.id).all():
        notes.append({
            'id': note.id,
            'title': note.title,
            'content': note.content,
            'properties': note.properties,
            'previous_content': note.previous_content
        })

    categories = []
    for cat in UserNoteCategory.query.filter_by(user_id=g.user.id).all():
        categories.append({'id': cat.id, 'name': cat.name})

    todos = []
    for todo in UserTodo.query.filter_by(userid=g.user.id).all():
        todos.append({'id': todo.id, 'title': todo.title, 'content': todo.content})

    events = []
    for event in UserEvent.query.filter_by(userid=g.user.id).all():
        events.append({'id': event.id, 'title': event.title, 'content': event.content})

    templates = []
    for tmpl in NoteTemplate.query.filter_by(user_id=g.user.id).all():
        templates.append({'id': tmpl.id, 'name': tmpl.name, 'content': tmpl.content, 'properties': tmpl.properties})

    agenda = None
    if g.user.agenda_notes:
        agenda = {'content': g.user.agenda_notes.content}

    return jsonify(
        notes=notes,
        categories=categories,
        todos=todos,
        events=events,
        templates=templates,
        agenda_notes=agenda
    )


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
            elif "update-theme-settings" in request.form:
                current_theme = g.user.settings.theme_preference
                if 'font-family' in request.form:
                    g.user.update_theme_font(current_theme, request.form['font-family'])
                if 'font-size' in request.form:
                    try:
                        g.user.update_theme_font_size(current_theme, int(request.form['font-size']))
                    except (ValueError, TypeError):
                        pass
                if 'mobile-font-size' in request.form:
                    try:
                        g.user.update_theme_mobile_font_size(current_theme, int(request.form['mobile-font-size']))
                    except (ValueError, TypeError):
                        pass
                if 'dark-mode' in request.form:
                    g.user.update_theme_dark_mode(current_theme, request.form['dark-mode'] == '1')
                else:
                    g.user.update_theme_dark_mode(current_theme, False)
                if 'auto-save' in request.form:
                    g.user.update_theme_auto_save(current_theme, request.form['auto-save'] == '1')
                else:
                    g.user.update_theme_auto_save(current_theme, False)
                if 'hide-title' in request.form:
                    g.user.update_theme_hide_title(current_theme, request.form['hide-title'] == '1')
                else:
                    g.user.update_theme_hide_title(current_theme, False)
                if 'notes-row-count' in request.form:
                    try:
                        g.user.update_theme_notes_row_count(current_theme, int(request.form['notes-row-count']))
                    except (ValueError, TypeError):
                        pass
                if 'notes-height' in request.form:
                    try:
                        g.user.update_theme_notes_height(current_theme, int(request.form['notes-height']))
                    except (ValueError, TypeError):
                        pass
                # UI state booleans
                ts = g.user.get_theme_settings(current_theme)
                for field in ('sidebar_collapsed', 'right_panel_collapsed', 'properties_collapsed', 'preview_mode'):
                    form_key = field.replace('_', '-')
                    if form_key in request.form:
                        setattr(ts, field, request.form[form_key] == '1')
                    else:
                        setattr(ts, field, False)
                # Panel widgets visibility
                widget_keys = [k for k in request.form if k.startswith('widget-')]
                if widget_keys or current_theme == 'obsidified':
                    widgets = ts.get_panel_widgets()
                    for w in widgets:
                        w['visible'] = ('widget-' + w['id']) in request.form
                    ts.set_panel_widgets(widgets)
                db.session.commit()
            elif "generate-api-token" in request.form:
                token_name = request.form.get('token-name', '').strip()
                if not token_name:
                    token_name = "Unnamed Token"
                plaintext, token_hash = generate_api_token()
                new_token = ApiToken(user_id=g.user.id, token_hash=token_hash, name=token_name)
                db.session.add(new_token)
                db.session.commit()
                tokens = ApiToken.query.filter_by(user_id=g.user.id).all()
                current_theme_obj = Theme.query.filter_by(slug=settings.theme_preference).first()
                ts = g.user.get_theme_settings(settings.theme_preference)
                return render_template("settings.html", themes=Theme.query.all(), timezones=available_timezones(), tokens=tokens, new_token=plaintext, sync_enabled=settings.obsidian_sync_enabled, current_theme=current_theme_obj, theme_settings=ts)
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
                                note.change_content(conflict.local_content, encrypted=True)
                            else:
                                note.change_title(conflict.server_title)
                                note.change_content(conflict.server_content, encrypted=True)
                    conflict.resolved = True
                    db.session.commit()
            return redirect(url_for('web.settings_page'))
        tokens = ApiToken.query.filter_by(user_id=g.user.id).all()
        conflicts = SyncConflict.query.filter_by(user_id=g.user.id, resolved=False).order_by(SyncConflict.conflict_date.desc()).all()
        current_theme_slug = settings.theme_preference
        current_theme = Theme.query.filter_by(slug=current_theme_slug).first()
        theme_settings = g.user.get_theme_settings(current_theme_slug)
        return render_template("settings.html", themes=Theme.query.all(), timezones=available_timezones(), tokens=tokens, conflicts=conflicts, sync_enabled=settings.obsidian_sync_enabled, current_theme=current_theme, theme_settings=theme_settings)
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
            # Legacy user: redirect to migration page
            if not user.encryption_enabled:
                return redirect(url_for('web.migrate_encryption_page'))
            # E2EE user logging in via form (shouldn't happen normally, but handle it)
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
        # E2EE: embed encrypted note data as JSON for client-side decryption
        encrypted_note_data = None
        if g.user.encryption_enabled and note:
            import json
            encrypted_note_data = json.dumps({
                'title': note.title,
                'content': note.content,
                'properties': note.properties,
                'previous_content': note.previous_content,
                'category_id': note.category_id
            })
        return render_template(f"themes/{theme_settings.theme.slug}/note_single.html", note = note, note_id = note_id, font_size = font_size, category = category, theme_settings = theme_settings, category_tree = category_tree, default_template = default_template, panel_widgets = panel_widgets, encrypted_note_data = encrypted_note_data)
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
    from flask import send_from_directory, current_app, make_response
    if not g.user:
        return "Unauthorized", 401
    a = Attachment.query.filter_by(id=attachment_id, user_id=g.user.id).first()
    if a is None:
        return "Not found", 404
    disk = a.disk_path()
    if not os.path.exists(disk):
        return "Not found", 404
    # For E2EE users, serve raw encrypted bytes so client can decrypt
    if g.user.encryption_enabled:
        with open(disk, 'rb') as f:
            data = f.read()
        response = make_response(data)
        response.headers['Content-Type'] = 'application/octet-stream'
        response.headers['X-Encrypted'] = 'true'
        return response
    return send_from_directory(os.path.dirname(disk), os.path.basename(disk), mimetype=a.content_type)
