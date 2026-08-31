"""Schemas for AI endpoints."""
from marshmallow import Schema, fields, validate


class SaveAiModelsSchema(Schema):
    models = fields.List(
        fields.String(validate=validate.Length(min=1, max=200)),
        required=True,
        validate=validate.Length(min=0, max=200),
    )