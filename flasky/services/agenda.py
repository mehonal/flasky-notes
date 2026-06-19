"""Todo and Event CRUD service. With mandatory E2EE the server stores
title/content as opaque ciphertext; date fields are plaintext (the client
needs them to sort/render, and the server also sorts by them).
"""
from datetime import datetime

from flasky import db
from flasky.models import UserTodo, UserEvent, UserAgendaNotes


def _parse_date(value):
    if not value or value == "":
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M")
    except ValueError:
        try:
            return datetime.strptime(value, "%Y-%m-%d")
        except ValueError:
            return None


class TodoNotFound(LookupError):
    pass


class EventNotFound(LookupError):
    pass


def _get_todo(user, todo_id):
    todo = UserTodo.query.filter_by(id=todo_id).first()
    if todo is None or todo.user != user:
        raise TodoNotFound(todo_id)
    return todo


def _get_event(user, event_id):
    event = UserEvent.query.filter_by(id=event_id).first()
    if event is None or event.user != user:
        raise EventNotFound(event_id)
    return event


def list_todos(user, archived=False):
    return UserTodo.query.filter_by(userid=user.id, archived=archived).all()


def list_events(user, past=False):
    if past:
        return (
            UserEvent.query.filter_by(userid=user.id)
            .filter(
                UserEvent.date_of_event != None,
                UserEvent.date_of_event <= datetime.utcnow(),
            )
            .order_by(UserEvent.date_of_event.desc())
            .all()
        )
    return UserEvent.query.filter_by(userid=user.id).all()


def create_todo(user, title, content="", date_due=None):
    todo = UserTodo(
        userid=user.id, title=title, content=content, date_due=_parse_date(date_due)
    )
    db.session.add(todo)
    db.session.commit()
    return todo


def create_event(user, title, content="", date_of_event=None):
    event = UserEvent(
        userid=user.id,
        title=title,
        content=content,
        date_of_event=_parse_date(date_of_event),
    )
    db.session.add(event)
    db.session.commit()
    return event


def update_todo(user, todo_id, title, content, date_due):
    todo = _get_todo(user, todo_id)
    todo.title = title
    todo.content = content
    todo.date_due = _parse_date(date_due)
    db.session.commit()
    return todo


def update_event(user, event_id, title, content, date_of_event):
    event = _get_event(user, event_id)
    event.title = title
    event.content = content
    event.date_of_event = _parse_date(date_of_event)
    db.session.commit()
    return event


def delete_todo(user, todo_id):
    todo = _get_todo(user, todo_id)
    db.session.delete(todo)
    db.session.commit()


def delete_event(user, event_id):
    event = _get_event(user, event_id)
    db.session.delete(event)
    db.session.commit()


def archive_todo(user, todo_id, archived=True):
    todo = _get_todo(user, todo_id)
    todo.archived = archived
    db.session.commit()
    return todo


def toggle_todo(user, todo_id, status=None):
    todo = _get_todo(user, todo_id)
    if status == "1":
        todo.completed = True
        todo.date_completed = datetime.utcnow()
    elif status == "0":
        todo.completed = False
        todo.date_completed = None
    else:
        todo.completed = not todo.completed
        todo.date_completed = datetime.utcnow() if todo.completed else None
    db.session.commit()
    return todo


def save_agenda_notes(user, content):
    """Persist the free-form agenda notes (already-encrypted ciphertext)."""
    if not user.agenda_notes:
        notes = UserAgendaNotes(userid=user.id, content=content)
        db.session.add(notes)
        db.session.commit()
        return True
    user.agenda_notes.content = content
    user.agenda_notes.date_last_changed = datetime.utcnow()
    db.session.commit()
    return True