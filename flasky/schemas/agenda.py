"""Schemas for todo/event/template/ui-state endpoints."""
from marshmallow import Schema, fields, validate


class AddTodoSchema(Schema):
    title = fields.String(allow_none=True)
    content = fields.String(allow_none=True)
    dateDue = fields.String(allow_none=True, data_key="dateDue")


class EditTodoSchema(Schema):
    toDoId = fields.Integer(required=True, data_key="toDoId")
    title = fields.String(allow_none=True)
    content = fields.String(allow_none=True)
    dateDue = fields.String(allow_none=True, data_key="dateDue")


class TodoIdSchema(Schema):
    toDoId = fields.Integer(required=True, data_key="toDoId")


class ToggleTodoSchema(Schema):
    toDoId = fields.Integer(required=True, data_key="toDoId")
    status = fields.String(allow_none=True)


class AddEventSchema(Schema):
    title = fields.String(allow_none=True)
    content = fields.String(allow_none=True)
    dateOfEvent = fields.String(allow_none=True, data_key="dateOfEvent")


class EditEventSchema(Schema):
    eventId = fields.Integer(required=True, data_key="eventId")
    title = fields.String(allow_none=True)
    content = fields.String(allow_none=True)
    dateOfEvent = fields.String(allow_none=True, data_key="dateOfEvent")


class EventIdSchema(Schema):
    eventId = fields.Integer(required=True, data_key="eventId")


class SaveAgendaNotesSchema(Schema):
    content = fields.String(allow_none=True)


class CreateTemplateSchema(Schema):
    name = fields.String(required=True)
    content = fields.String(allow_none=True)
    properties = fields.Raw(allow_none=True)
    icon = fields.String(allow_none=True)
    iconColor = fields.String(allow_none=True, data_key="iconColor")


class UpdateTemplateSchema(Schema):
    name = fields.String(allow_none=True)
    content = fields.String(allow_none=True)
    properties = fields.Raw(allow_none=True)
    icon = fields.String(allow_none=True)
    iconColor = fields.String(allow_none=True, data_key="iconColor")


class SaveUiStateSchema(Schema):
    sidebar_collapsed = fields.Boolean(allow_none=True)
    right_panel_collapsed = fields.Boolean(allow_none=True)
    properties_collapsed = fields.Boolean(allow_none=True)
    preview_mode = fields.Boolean(allow_none=True)
    panel_widgets = fields.List(fields.Dict(), allow_none=True, data_key="panelWidgets")


class SaveAutoSaveSchema(Schema):
    autoSave = fields.Raw(allow_none=True, data_key="autoSave")


class SaveHideTitleSchema(Schema):
    hideTitle = fields.Raw(allow_none=True, data_key="hideTitle")


class SaveFontSchema(fields.Field):
    """Body is raw text (the font family string), not JSON. Use direct decode in route."""


class LoadNotesSchema(Schema):
    page = fields.Integer(required=True)