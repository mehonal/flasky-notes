"""Marshmallow schemas for request/response validation.

Adding a new endpoint's validation = add a Schema here and decorate the route
with @blueprint.arguments(Schema). flask-smorest returns 422 with a structured
error message on validation failure.
"""