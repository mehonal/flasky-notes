"""Agenda blueprint — todos, events, agenda notes (split from notes_api.py)."""
from flask import request, g, jsonify
from flask_smorest import Blueprint as SmorestBlueprint

from flasky.utils import login_required
from flasky.services import agenda as agenda_service
from flasky.services.agenda import TodoNotFound, EventNotFound
from flasky.schemas.agenda import (
    AddTodoSchema,
    EditTodoSchema,
    TodoIdSchema,
    ToggleTodoSchema,
    AddEventSchema,
    EditEventSchema,
    EventIdSchema,
    SaveAgendaNotesSchema,
)


agenda_bp = SmorestBlueprint("agenda", __name__, url_prefix="/api")


# ============ Todos ============


@agenda_bp.route("/get_todos")
@login_required
def get_todos():
    archived = request.args.get("archived") == "true"
    todos = agenda_service.list_todos(g.user, archived=archived)
    return jsonify([
        {
            "id": t.id,
            "title": t.title,
            "completed": t.completed,
            "archived": t.archived,
            "time_until_due": t.get_time_until_due(),
            "due_css_class": t.get_due_css_class(),
            "has_content": t.has_content(),
        }
        for t in todos
    ])


@agenda_bp.route("/get_todo/<int:todo_id>")
@login_required
def get_todo(todo_id):
    try:
        todo = agenda_service._get_todo(g.user, todo_id)
    except TodoNotFound:
        return jsonify(success=False, reason="To do does not exist.")
    return jsonify(success=True, todo=todo.return_json())


@agenda_bp.route("/add_todo", methods=["POST"])
@login_required
@agenda_bp.arguments(AddTodoSchema)
def add_todo(data):
    todo = agenda_service.create_todo(
        g.user, data.get("title"), data.get("content") or "", data.get("dateDue")
    )
    return jsonify(success=True, todo=todo.return_json(), id=todo.id)


@agenda_bp.route("/edit_todo", methods=["POST"])
@login_required
@agenda_bp.arguments(EditTodoSchema)
def edit_todo(data):
    try:
        todo = agenda_service.update_todo(
            g.user, data["toDoId"], data.get("title"), data.get("content"),
            data.get("dateDue"),
        )
    except TodoNotFound:
        return jsonify(success=False, reason="To do does not exist.")
    return jsonify(success=True, todo=todo.return_json())


@agenda_bp.route("/delete_todo", methods=["POST"])
@login_required
@agenda_bp.arguments(TodoIdSchema)
def delete_todo(data):
    try:
        agenda_service.delete_todo(g.user, data["toDoId"])
    except TodoNotFound:
        return jsonify(success=False, reason="To do does not exist.")
    return jsonify(success=True)


@agenda_bp.route("/archive_todo", methods=["POST"])
@login_required
@agenda_bp.arguments(TodoIdSchema)
def archive_todo(data):
    try:
        agenda_service.archive_todo(g.user, data["toDoId"], archived=True)
    except TodoNotFound:
        return jsonify(success=False, reason="To do does not exist.")
    return jsonify(success=True)


@agenda_bp.route("/unarchive_todo", methods=["POST"])
@login_required
@agenda_bp.arguments(TodoIdSchema)
def unarchive_todo(data):
    try:
        todo = agenda_service.archive_todo(g.user, data["toDoId"], archived=False)
    except TodoNotFound:
        return jsonify(success=False, reason="To do does not exist.")
    return jsonify(success=True, todo=todo.return_json())


@agenda_bp.route("/toggle_todo", methods=["POST"])
@login_required
@agenda_bp.arguments(ToggleTodoSchema)
def toggle_todo(data):
    try:
        agenda_service.toggle_todo(g.user, data["toDoId"], data.get("status"))
    except TodoNotFound:
        return jsonify(success=False, reason="To do does not exist.")
    return jsonify(success=True)


# ============ Events ============


@agenda_bp.route("/get_event/<int:event_id>")
@login_required
def get_event(event_id):
    try:
        event = agenda_service._get_event(g.user, event_id)
    except EventNotFound:
        return jsonify(success=False, reason="Event does not exist.")
    return jsonify(success=True, event=event.return_json())


@agenda_bp.route("/get_events")
@login_required
def get_events():
    past = request.args.get("past") == "true"
    events = agenda_service.list_events(g.user, past=past)
    return jsonify([
        {
            "id": e.id,
            "title": e.title,
            "date_of_event": e.date_of_event,
            "time_until_event": e.get_time_until_event(),
            "event_css_class": e.get_event_css_class(),
            "has_content": e.has_content(),
        }
        for e in events
    ])


@agenda_bp.route("/add_event", methods=["POST"])
@login_required
@agenda_bp.arguments(AddEventSchema)
def add_event(data):
    event = agenda_service.create_event(
        g.user, data.get("title"), data.get("content") or "", data.get("dateOfEvent")
    )
    return jsonify(success=True, event=event.return_json(), id=event.id)


@agenda_bp.route("/edit_event", methods=["POST"])
@login_required
@agenda_bp.arguments(EditEventSchema)
def edit_event(data):
    try:
        event = agenda_service.update_event(
            g.user, data["eventId"], data.get("title"), data.get("content"),
            data.get("dateOfEvent"),
        )
    except EventNotFound:
        return jsonify(success=False, reason="Event does not exist.")
    return jsonify(success=True, event=event.return_json())


@agenda_bp.route("/delete_event", methods=["POST"])
@login_required
@agenda_bp.arguments(EventIdSchema)
def delete_event(data):
    try:
        agenda_service.delete_event(g.user, data["eventId"])
    except EventNotFound:
        return jsonify(success=False, reason="Event does not exist.")
    return jsonify(success=True)


# ============ Agenda notes ============


@agenda_bp.route("/save_agenda_notes", methods=["POST"])
@login_required
@agenda_bp.arguments(SaveAgendaNotesSchema)
def save_agenda_notes(data):
    # E2EE: content is already encrypted by the client — store as-is.
    agenda_service.save_agenda_notes(g.user, data.get("content"))
    return jsonify(success=True)