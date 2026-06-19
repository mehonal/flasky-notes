"""Templates blueprint — note templates CRUD (split from notes_api.py)."""
from flask import request, g, jsonify
from flask_smorest import Blueprint as SmorestBlueprint

from flasky.utils import login_required
from flasky.services import templates as tmpl_service
from flasky.services.templates import TemplateNotFound
from flasky.schemas.agenda import CreateTemplateSchema, UpdateTemplateSchema


templates_bp = SmorestBlueprint("templates", __name__, url_prefix="/api")


@templates_bp.route("/templates", methods=["GET"])
@login_required
def list_templates():
    return jsonify([t.return_json() for t in tmpl_service.list_templates(g.user)])


@templates_bp.route("/templates/<int:template_id>", methods=["GET"])
@login_required
def get_template(template_id):
    try:
        t = tmpl_service.get_template(g.user, template_id)
    except TemplateNotFound:
        return jsonify(success=False, reason="Template not found."), 404
    return jsonify(t.return_json())


@templates_bp.route("/templates", methods=["POST"])
@login_required
@templates_bp.arguments(CreateTemplateSchema)
def create_template(data):
    t = tmpl_service.create_template(
        g.user,
        name=data["name"],
        content=data.get("content", ""),
        properties=data.get("properties"),
        icon=data.get("icon"),
        icon_color=data.get("iconColor"),
    )
    return jsonify(success=True, template=t.return_json())


@templates_bp.route("/templates/<int:template_id>", methods=["PUT"])
@login_required
@templates_bp.arguments(UpdateTemplateSchema)
def update_template(data, template_id):
    try:
        t = tmpl_service.update_template(
            g.user, template_id,
            name=data.get("name"),
            content=data.get("content"),
            properties=data.get("properties"),
            icon=data.get("icon"),
            icon_color=data.get("iconColor"),
        )
    except TemplateNotFound:
        return jsonify(success=False, reason="Template not found."), 404
    return jsonify(success=True, template=t.return_json())


@templates_bp.route("/templates/<int:template_id>", methods=["DELETE"])
@login_required
def delete_template(template_id):
    try:
        tmpl_service.delete_template(g.user, template_id)
    except TemplateNotFound:
        return jsonify(success=False, reason="Template not found."), 404
    return jsonify(success=True)


@templates_bp.route("/set_folder_template", methods=["POST"])
@login_required
def set_folder_template():
    from flasky.schemas.notes import SetFolderTemplateSchema
    data = request.get_json(silent=True) or {}
    cat_id = data.get("categoryId")
    tmpl_id = data.get("templateId")
    try:
        tmpl_service.set_folder_template(g.user, cat_id, tmpl_id)
    except ValueError as e:
        return jsonify(success=False, reason=str(e)), 400
    return jsonify(success=True)


@templates_bp.route("/folder_default_template/<int:category_id>", methods=["GET"])
@login_required
def get_folder_default_template(category_id):
    t = tmpl_service.get_folder_default_template(g.user, category_id)
    if t is None:
        return jsonify(success=False, reason="No default template.")
    return jsonify(success=True, template=t.return_json())