"""Schemas for note + category endpoints."""
from marshmallow import Schema, fields, validate


class SaveNoteSchema(Schema):
    noteId = fields.Integer(required=True)
    title = fields.String(allow_none=True)
    content = fields.String(allow_none=True)
    category = fields.Raw(allow_none=True)  # int id or string that parses to int
    properties = fields.Raw(allow_none=True)  # opaque ciphertext (str) or None
    icon = fields.String(allow_none=True)
    iconColor = fields.String(allow_none=True, data_key="iconColor")


class NoteIdSchema(Schema):
    noteId = fields.Integer(required=True)


class AddCategorySchema(Schema):
    categoryName = fields.String(required=True, validate=validate.Length(min=1))


class RenameCategorySchema(Schema):
    categoryId = fields.Integer(required=True)
    name = fields.String(allow_none=True)  # unused for E2EE path, kept for compat
    renames = fields.List(
        fields.Dict(keys=fields.String(), values=fields.Raw()),
        allow_none=True,
    )


class MoveCategorySchema(Schema):
    categoryId = fields.Integer(required=True)
    renames = fields.List(
        fields.Dict(keys=fields.String(), values=fields.Raw()),
        required=True,
    )


class DeleteCategorySchema(Schema):
    categoryId = fields.Integer(required=True)


class EditNoteCategorySchema(Schema):
    noteId = fields.Integer(required=True)
    category = fields.Raw(allow_none=True)


class RenameNoteSchema(Schema):
    noteId = fields.Integer(required=True)
    title = fields.String(required=True)


class SetIconSchema(Schema):
    noteId = fields.Integer(required=True)
    icon = fields.String(allow_none=True)
    iconColor = fields.String(allow_none=True, data_key="iconColor")


class SetFolderIconSchema(Schema):
    categoryId = fields.Integer(required=True)
    icon = fields.String(allow_none=True)
    iconColor = fields.String(allow_none=True, data_key="iconColor")


SetDefaultNoteIconSchema = SetFolderIconSchema  # same shape


class SetFolderTemplateSchema(Schema):
    categoryId = fields.Integer(required=True)
    templateId = fields.Integer(allow_none=True, data_key="templateId")