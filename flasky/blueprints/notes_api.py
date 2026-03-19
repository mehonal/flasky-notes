from flask import Blueprint, request, g, jsonify, current_app
from datetime import datetime
import re
import os
import hashlib

from flasky import db
from flasky.models import (
    UserNote, UserNoteCategory, UserTodo, UserEvent, Attachment, NoteTemplate
)
from werkzeug.utils import secure_filename

notes_api_bp = Blueprint('notes_api', __name__, url_prefix='/api')


@notes_api_bp.route("/get_all_notes")
def get_all_notes_api():
    if g.user:
        notes = []
        for note in UserNote.query.filter_by(userid=g.user.id):
            notes.append(note.return_json())
        return jsonify(notes)
    else:
        return jsonify(success=False,reason="Note logged in.")

@notes_api_bp.route("/search_notes", methods=['POST'])
def search_notes_api():
    if g.user:
        # E2EE: server can't search encrypted content — client does it
        if g.user.encryption_enabled:
            return jsonify(results=[], client_side=True)
        data = request.get_json()
        query = data.get('query')
        notes = UserNote.query.filter(
            UserNote.userid == g.user.id,
            db.or_(
                UserNote.title.contains(query),
                UserNote.content.contains(query)
            )
        ).order_by(UserNote.date_added.desc()).all()
        return jsonify([note.return_json() for note in notes])
    else:
        return jsonify(success=False,reason="Not logged in.")

@notes_api_bp.route("/backlinks/<int:note_id>")
def backlinks_api(note_id):
    if g.user:
        # E2EE: computed client-side
        if g.user.encryption_enabled:
            return jsonify([])
        note = UserNote.query.filter_by(id=note_id).first()
        if note and g.user == note.user and note.title:
            pattern = "%[[" + note.title + "]]%"
            linking_notes = UserNote.query.filter(
                UserNote.userid == g.user.id,
                UserNote.id != note_id,
                UserNote.content.ilike(pattern)
            ).all()
            return jsonify([{"id": n.id, "title": n.title or "Untitled"} for n in linking_notes])
        return jsonify([])
    return jsonify(error="Not logged in"), 401


@notes_api_bp.route("/outbound-links/<int:note_id>")
def outbound_links_api(note_id):
    if g.user:
        # E2EE: computed client-side
        if g.user.encryption_enabled:
            return jsonify([])
        note = UserNote.query.filter_by(id=note_id).first()
        if note and g.user == note.user and note.content:
            links = re.findall(r'\[\[([^\]|]+)(?:\|[^\]]+)?\]\]', note.content)
            seen = set()
            unique_titles = []
            for title in links:
                key = title.strip().lower()
                if key not in seen:
                    seen.add(key)
                    unique_titles.append(title.strip())
            if not unique_titles:
                return jsonify([])
            # Batch query: find all matching notes in one query
            lower_keys = [t.lower() for t in unique_titles]
            matching_notes = UserNote.query.filter(
                UserNote.userid == g.user.id,
                db.func.lower(UserNote.title).in_(lower_keys)
            ).all()
            title_map = {n.title.lower(): n for n in matching_notes if n.title}
            result = []
            for title in unique_titles:
                target = title_map.get(title.lower())
                if target:
                    result.append({"id": target.id, "title": target.title or "Untitled"})
                else:
                    result.append({"id": None, "title": title})
            return jsonify(result)
        return jsonify([])
    return jsonify(error="Not logged in"), 401


@notes_api_bp.route("/note/check_last_edited/<int:note_id>")
def check_last_edited_note_api(note_id):
    if g.user:
        note = UserNote.query.filter_by(id=note_id).first()
        if note and g.user == note.user:
            return jsonify(success=True,last_updated=f"Note last updated {note.return_time_ago()} ago.")
        else:
            return jsonify(success=False,reason="Note does not exist.")
    else:
        return jsonify(success=False,reason="Not logged in.")


@notes_api_bp.route("/save_font_size/<int:font_size>")
def save_font_size(font_size):
    if g.user:
        theme = g.user.return_settings().theme_preference
        g.user.update_theme_font_size(theme, font_size)
        return jsonify(success=True,theme=theme,font_size=font_size)
    else:
        return jsonify(success=False,reason="Not logged in.")

@notes_api_bp.route("/save_mobile_font_size/<int:font_size>")
def save_mobile_font_size(font_size):
    if g.user:
        theme = g.user.return_settings().theme_preference
        g.user.update_theme_mobile_font_size(theme, font_size)
        return jsonify(success=True,theme=theme,font_size=font_size)
    else:
        return jsonify(success=False,reason="Not logged in.")

@notes_api_bp.route("/save_auto_save", methods=['POST'])
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

@notes_api_bp.route("/save_notes_row_count/<int:row_count>")
def save_notes_row_count(row_count):
    if g.user:
        theme = g.user.return_settings().theme_preference
        g.user.update_theme_notes_row_count(theme, row_count)
        return jsonify(success=True,theme=theme,new_row_count=row_count)
    else:
        return jsonify(success=False,reason="Not logged in.")

@notes_api_bp.route("/save_notes_height/<int:height>")
def save_notes_height(height):
    if g.user:
        theme = g.user.return_settings().theme_preference
        g.user.update_theme_notes_height(theme, height)
        return jsonify(success=True,theme=theme,new_height=height)
    else:
        return jsonify(success=False,reason="Not logged in.")

@notes_api_bp.route("/save_dark_mode/<int:dark_mode>")
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

@notes_api_bp.route("/save_ui_state", methods=['POST'])
def save_ui_state():
    if g.user:
        data = request.get_json()
        if not data:
            return jsonify(success=False, reason="No data provided.")
        theme_slug = g.user.return_settings().theme_preference
        theme_settings = g.user.get_theme_settings(theme_slug)
        allowed = ('sidebar_collapsed', 'right_panel_collapsed', 'properties_collapsed', 'preview_mode')
        for key in allowed:
            if key in data:
                setattr(theme_settings, key, bool(data[key]))
        if 'panel_widgets' in data and isinstance(data['panel_widgets'], list):
            theme_settings.set_panel_widgets(data['panel_widgets'])
        db.session.commit()
        return jsonify(success=True)
    else:
        return jsonify(success=False, reason="Not logged in.")

@notes_api_bp.route("/save_font", methods=['POST'])
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

@notes_api_bp.route("/save_hide_title", methods=['POST'])
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

@notes_api_bp.route("/save_note", methods=['POST'])
def save_note():
    if g.user:
        data = request.get_json()
        note_id = int(data.get('noteId'))
        title = data.get('title')
        content = data.get('content')
        category = data.get('category')
        encrypted = g.user.encryption_enabled
        properties = data.get('properties')  # E2EE: encrypted properties sent separately
        try:
            category = int(category)
        except:
            pass
        if note_id == 0:
            note = g.user.add_note(title, content, category, encrypted=encrypted)
            if encrypted and properties:
                note.properties = properties
                db.session.commit()
            return jsonify(success=True, note=note.return_json())
        else:
            note = UserNote.query.filter_by(id=note_id).first()
            if note and g.user == note.user:
                note.change_title(title)
                note.change_content(content, encrypted=encrypted)
                if encrypted and properties is not None:
                    note.properties = properties
                    db.session.commit()
                note.change_category(category)
                return jsonify(success=True, note=note.return_json())
            else:
                return jsonify(success=False, reason="Note does not exist.")
    else:
        return jsonify(success=False, reason="Not logged in.")

@notes_api_bp.route("/revert_note", methods=['POST'])
def revert_note():
    if g.user:
        data = request.get_json()
        note_id = int(data.get('noteId'))
        note = UserNote.query.filter_by(id=note_id).first()
        if note and g.user == note.user:
            if note.previous_content is not None:
                note.revert_to_last_version()
                return jsonify(success=True, note=note.return_json())
            else:
                return jsonify(success=False, reason="No previous version available.")
        else:
            return jsonify(success=False, reason="Note does not exist.")
    else:
        return jsonify(success=False, reason="Not logged in.")

@notes_api_bp.route("/note/<int:note_id>")
def get_note(note_id):
    if not g.user:
        return jsonify(success=False, reason="Not logged in.")
    note = UserNote.query.filter_by(id=note_id, userid=g.user.id).first()
    if not note:
        return jsonify(success=False, reason="Note does not exist.")
    data = note.return_json()
    data['category_id'] = note.category_id
    return jsonify(success=True, note=data)


@notes_api_bp.route("/load_notes", methods=['POST'])
def load_notes():
    if g.user:
        page = request.get_json().get('page')
        notes = []
        for note in UserNote.query.filter_by(userid=g.user.id).order_by(UserNote.date_last_changed.desc()).paginate(page=page, per_page=5).items:
            notes.append(note.return_json())
        return jsonify(notes)
    else:
        return jsonify(success=False,reason="Not logged in.")

@notes_api_bp.route("/delete_note", methods=['POST'])
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

@notes_api_bp.route("/add_category", methods=['POST'])
def add_category():
    if g.user:
        data = request.get_json()
        category_name = data.get('categoryName')
        category = g.user.get_category(category_name,create=True)
        return jsonify(success=True,category=category.id)
    else:
        return jsonify(success=False,reason="Not logged in.")

@notes_api_bp.route("/edit_note_category", methods=['POST'])
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

@notes_api_bp.route("/move_category", methods=['POST'])
def move_category():
    if g.user:
        data = request.get_json()
        category_id = int(data.get('categoryId'))
        target_path = data.get('targetPath', '').strip('/')
        category = UserNoteCategory.query.filter_by(id=category_id).first()
        if not category or g.user != category.user:
            return jsonify(success=False, reason="Category does not exist.")
        old_path = category.name
        leaf_name = old_path.rsplit('/', 1)[-1]
        new_path = target_path + '/' + leaf_name if target_path else leaf_name
        if new_path == old_path:
            return jsonify(success=True)
        # Prevent moving into itself or its own children
        if new_path == old_path or new_path.startswith(old_path + '/'):
            return jsonify(success=False, reason="Cannot move a folder into itself.")
        # Check for name collision
        if UserNoteCategory.query.filter_by(user_id=g.user.id, name=new_path).first():
            return jsonify(success=False, reason="A folder with that name already exists there.")
        # Rename this category and all children
        children = UserNoteCategory.query.filter(
            UserNoteCategory.user_id == g.user.id,
            UserNoteCategory.name.startswith(old_path + '/')
        ).all()
        for child in children:
            child.name = new_path + child.name[len(old_path):]
        category.name = new_path
        db.session.commit()
        return jsonify(success=True)
    else:
        return jsonify(success=False, reason="Not logged in.")

@notes_api_bp.route("/delete_category", methods=['POST'])
def delete_category():
    if g.user:
        data = request.get_json()
        category_id = int(data.get('categoryId'))
        category = UserNoteCategory.query.filter_by(id=category_id).first()
        if category and g.user == category.user and category.name != "Main" and category.name != "main":
            main = g.user.get_main_category()
            # Also delete child categories (subfolders)
            children = UserNoteCategory.query.filter(
                UserNoteCategory.user_id == g.user.id,
                UserNoteCategory.name.startswith(category.name + "/")
            ).all()
            for child in children:
                for note in child.notes:
                    note.category_id = main.id
                db.session.delete(child)
            for note in UserNote.query.filter_by(category_id=category_id):
                note.category_id = main.id
            db.session.commit()
            db.session.delete(category)
            db.session.commit()
            return jsonify(success=True)
        else:
            return jsonify(success=False,reason="Category does not exist.")
    else:
        return jsonify(success=False,reason="Not logged in.")

@notes_api_bp.route("/sidebar_tree")
def sidebar_tree():
    if not g.user:
        return jsonify(success=False, reason="Not logged in.")
    # E2EE: return raw JSON data for client-side rendering
    if g.user.encryption_enabled:
        categories = [
            {'id': cat.id, 'name': cat.name}
            for cat in sorted(g.user.categories, key=lambda c: c.id)
        ]
        notes = [
            {'id': n.id, 'title': n.title, 'category_id': n.category_id,
             'date_last_changed': n.date_last_changed.isoformat() if n.date_last_changed else None}
            for n in UserNote.query.filter_by(userid=g.user.id).order_by(UserNote.date_last_changed.desc()).all()
        ]
        return jsonify(success=True, encrypted=True, categories=categories, notes=notes)
    from flask import render_template
    category_tree = g.user.get_category_tree()
    note_id = request.args.get('note_id', 0, type=int)
    tree_html = render_template(
        'themes/obsidified/partials/sidebar_tree.html',
        category_tree=category_tree,
        active_note_id=note_id
    )
    categories = [
        {'id': cat.id, 'name': cat.name}
        for cat in sorted(g.user.categories, key=lambda c: c.name)
    ]
    return jsonify(success=True, tree_html=tree_html, categories=categories)


@notes_api_bp.route("/get_todos")
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
                "time_until_due": todo.get_time_until_due(),
                "due_css_class": todo.get_due_css_class(),
                "has_content": todo.has_content()
            })
        return jsonify(todos)
    else:
        return jsonify(success=False,reason="Not logged in.")

@notes_api_bp.route("/get_todo/<int:todo_id>")
def get_todo(todo_id):
    if g.user:
        todo = UserTodo.query.filter_by(id=todo_id).first()
        if todo and g.user == todo.user:
            return jsonify(success=True,todo=todo.return_json())
        else:
            return jsonify(success=False,reason="To do does not exist.")
    else:
        return jsonify(success=False,reason="Not logged in.")

@notes_api_bp.route("/get_event/<int:event_id>")
def get_event(event_id):
    if g.user:
        event = UserEvent.query.filter_by(id=event_id).first()
        if event and g.user == event.user:
            return jsonify(success=True,event=event.return_json())
        else:
            return jsonify(success=False,reason="Event does not exist.")
    else:
        return jsonify(success=False,reason="Not logged in.")

@notes_api_bp.route("/get_events")
def get_events():
    if g.user:
        events = []
        for event in UserEvent.query.filter_by(userid=g.user.id).all():
            events.append({
                "id": event.id,
                "title": event.title,
                "time_until_event": event.get_time_until_event(),
                "event_css_class": event.get_event_css_class(),
                "has_content": event.has_content()
            })
        return jsonify(events)
    else:
        return jsonify(success=False,reason="Not logged in.")

@notes_api_bp.route("/add_todo", methods=['POST'])
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

@notes_api_bp.route("/add_event", methods=['POST'])
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

@notes_api_bp.route("/edit_todo", methods=['POST'])
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

@notes_api_bp.route("/edit_event", methods=['POST'])
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

@notes_api_bp.route("/delete_todo", methods=['POST'])
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

@notes_api_bp.route("/delete_event", methods=['POST'])
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

@notes_api_bp.route("/archive_todo", methods=['POST'])
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

@notes_api_bp.route("/unarchive_todo", methods=['POST'])
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

@notes_api_bp.route("/toggle_todo", methods=['POST'])
def toggle_todo():
    if g.user:
        data = request.get_json()
        todo_id = data.get('toDoId')
        status = data.get('status')
        todo = UserTodo.query.filter_by(id=todo_id).first()
        if todo and g.user == todo.user:
            if status == "1":
                todo.completed = True
                todo.date_completed = datetime.utcnow()
            elif status == "0":
                todo.completed = False
                todo.date_completed = None
            else:
                todo.completed = not todo.completed
                if todo.completed:
                    todo.date_completed = datetime.utcnow()
                else:
                    todo.date_completed = None
            db.session.commit()
            return jsonify(success=True)
        else:
            return jsonify(success=False,reason="To do does not exist.")
    else:
        return jsonify(success=False,reason="Not logged in.")

@notes_api_bp.route("/save_agenda_notes", methods=['POST'])
def save_agenda_notes():
    if g.user:
        data = request.get_json()
        content = data.get('content')
        # E2EE: content is already encrypted, just store it
        g.user.edit_agenda_notes(content)
        return jsonify(success=True)
    else:
        return jsonify(success=False,reason="Not logged in.")


@notes_api_bp.route("/sidebar_tree_data")
def sidebar_tree_data():
    """JSON-only sidebar data for E2EE client-side rendering."""
    if not g.user:
        return jsonify(success=False, reason="Not logged in.")
    categories = [
        {'id': cat.id, 'name': cat.name}
        for cat in sorted(g.user.categories, key=lambda c: c.id)
    ]
    notes = [
        {'id': n.id, 'title': n.title, 'category_id': n.category_id,
         'date_last_changed': n.date_last_changed.isoformat() if n.date_last_changed else None}
        for n in UserNote.query.filter_by(userid=g.user.id).order_by(UserNote.date_last_changed.desc()).all()
    ]
    return jsonify(success=True, categories=categories, notes=notes)

@notes_api_bp.route("/note-map")
def note_map():
    if not g.user:
        return jsonify(error="Unauthorized"), 401
    # E2EE: return arrays of encrypted blobs instead of title-keyed dict
    if g.user.encryption_enabled:
        notes = UserNote.query.filter_by(userid=g.user.id).all()
        note_list = [{"id": n.id, "title": n.title} for n in notes]
        attachments = Attachment.query.filter_by(user_id=g.user.id).all()
        att_list = [{"id": a.id, "filename": a.filename} for a in attachments]
        return jsonify({"notes": note_list, "attachments": att_list, "encrypted": True})
    notes = UserNote.query.filter_by(userid=g.user.id).all()
    result = {}
    for note in notes:
        if note.title:
            result[note.title.lower()] = {"id": note.id, "title": note.title}
    attachments = Attachment.query.filter_by(user_id=g.user.id).all()
    att_map = {}
    for a in attachments:
        att_map[a.filename.lower()] = {"id": a.id, "filename": a.filename}
    return jsonify({"notes": result, "attachments": att_map})


# ============ Templates ============

@notes_api_bp.route("/templates", methods=['GET'])
def list_templates():
    if not g.user:
        return jsonify(error="Not logged in"), 401
    templates = NoteTemplate.query.filter_by(user_id=g.user.id).order_by(NoteTemplate.name).all()
    return jsonify([t.return_json() for t in templates])

@notes_api_bp.route("/templates/<int:template_id>", methods=['GET'])
def get_template(template_id):
    if not g.user:
        return jsonify(error="Not logged in"), 401
    t = NoteTemplate.query.filter_by(id=template_id, user_id=g.user.id).first()
    if not t:
        return jsonify(success=False, reason="Template not found."), 404
    return jsonify(t.return_json())

@notes_api_bp.route("/templates", methods=['POST'])
def create_template():
    if not g.user:
        return jsonify(error="Not logged in"), 401
    data = request.get_json()
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify(success=False, reason="Name is required.")
    content = data.get('content', '')
    properties = data.get('properties')
    import json
    props_json = json.dumps(properties) if properties else None
    t = NoteTemplate(user_id=g.user.id, name=name, content=content, properties=props_json)
    return jsonify(success=True, template=t.return_json())

@notes_api_bp.route("/templates/<int:template_id>", methods=['PUT'])
def update_template(template_id):
    if not g.user:
        return jsonify(error="Not logged in"), 401
    t = NoteTemplate.query.filter_by(id=template_id, user_id=g.user.id).first()
    if not t:
        return jsonify(success=False, reason="Template not found."), 404
    data = request.get_json()
    if 'name' in data:
        t.name = (data['name'] or '').strip() or t.name
    if 'content' in data:
        t.content = data['content']
    if 'properties' in data:
        import json
        t.properties = json.dumps(data['properties']) if data['properties'] else None
    db.session.commit()
    return jsonify(success=True, template=t.return_json())

@notes_api_bp.route("/templates/<int:template_id>", methods=['DELETE'])
def delete_template(template_id):
    if not g.user:
        return jsonify(error="Not logged in"), 401
    t = NoteTemplate.query.filter_by(id=template_id, user_id=g.user.id).first()
    if not t:
        return jsonify(success=False, reason="Template not found."), 404
    # Clear any folder defaults referencing this template
    UserNoteCategory.query.filter_by(user_id=g.user.id, default_template_id=t.id).update({'default_template_id': None})
    db.session.delete(t)
    db.session.commit()
    return jsonify(success=True)

@notes_api_bp.route("/set_folder_template", methods=['POST'])
def set_folder_template():
    if not g.user:
        return jsonify(error="Not logged in"), 401
    data = request.get_json()
    category_id = data.get('categoryId')
    template_id = data.get('templateId')  # null to unset
    cat = UserNoteCategory.query.filter_by(id=category_id, user_id=g.user.id).first()
    if not cat:
        return jsonify(success=False, reason="Folder not found.")
    if template_id:
        t = NoteTemplate.query.filter_by(id=template_id, user_id=g.user.id).first()
        if not t:
            return jsonify(success=False, reason="Template not found.")
        cat.default_template_id = t.id
    else:
        cat.default_template_id = None
    db.session.commit()
    return jsonify(success=True)


@notes_api_bp.route("/upload_attachment", methods=['POST'])
def upload_attachment():
    """Upload an attachment. For E2EE users, file data and filename are already encrypted client-side."""
    if not g.user:
        return jsonify(error="Not logged in"), 401
    if 'file' not in request.files:
        return jsonify(error="No file part"), 400
    f = request.files['file']
    if not f.filename:
        return jsonify(error="No filename"), 400
    data = f.read()
    file_hash = hashlib.sha256(data).hexdigest()

    # Get the display filename (may be encrypted for E2EE users)
    display_filename = request.form.get('filename', f.filename)

    # For E2EE users, store as opaque blob
    if g.user.encryption_enabled:
        content_type = 'application/octet-stream'
    else:
        import mimetypes
        content_type = f.content_type or mimetypes.guess_type(f.filename)[0] or 'application/octet-stream'

    # Deduplicate
    existing = Attachment.query.filter_by(user_id=g.user.id, file_hash=file_hash).first()
    if existing:
        return jsonify({"id": existing.id, "filename": existing.filename, "file_hash": existing.file_hash, "file_size": existing.file_size}), 200

    attachment = Attachment(
        user_id=g.user.id,
        filename=display_filename,
        content_type=content_type,
        file_hash=file_hash,
        file_size=len(data),
    )
    db.session.add(attachment)
    db.session.commit()

    attachment_dir = current_app.config['ATTACHMENT_DIR']
    user_dir = os.path.join(attachment_dir, str(g.user.id))
    os.makedirs(user_dir, exist_ok=True)
    disk = attachment.disk_path()
    with open(disk, 'wb') as out:
        out.write(data)
    return jsonify({"id": attachment.id, "filename": attachment.filename, "file_hash": attachment.file_hash, "file_size": attachment.file_size}), 201
