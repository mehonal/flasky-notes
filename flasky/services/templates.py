"""Note template CRUD service. With mandatory E2EE name/content/properties
are opaque ciphertext; the server stores them as-is.
"""
import json

from flasky import db
from flasky.models import NoteTemplate, UserNoteCategory


class TemplateNotFound(LookupError):
    pass


def _get_template(user, template_id):
    t = NoteTemplate.query.filter_by(id=template_id, user_id=user.id).first()
    if t is None:
        raise TemplateNotFound(template_id)
    return t


def _coerce_properties(properties):
    if properties is None:
        return None
    if isinstance(properties, str):
        return properties
    return json.dumps(properties)


def list_templates(user):
    return (
        NoteTemplate.query.filter_by(user_id=user.id)
        .order_by(NoteTemplate.name)
        .all()
    )


def get_template(user, template_id):
    return _get_template(user, template_id)


def create_template(user, name, content="", properties=None, icon=None, icon_color=None):
    t = NoteTemplate(
        user_id=user.id,
        name=name,
        content=content,
        properties=_coerce_properties(properties),
    )
    if icon:
        t.icon = icon
        t.icon_color = icon_color
    db.session.add(t)
    db.session.commit()
    return t


def update_template(user, template_id, name=None, content=None, properties=None,
                    icon=None, icon_color=None):
    t = _get_template(user, template_id)
    if name is not None:
        new_name = (name or "").strip()
        if new_name:
            t.name = new_name
    if content is not None:
        t.content = content
    if properties is not None:
        t.properties = _coerce_properties(properties)
    if icon is not None:
        t.icon = icon
        t.icon_color = icon_color
    db.session.commit()
    return t


def delete_template(user, template_id):
    t = _get_template(user, template_id)
    UserNoteCategory.query.filter_by(
        user_id=user.id, default_template_id=t.id
    ).update({"default_template_id": None})
    db.session.delete(t)
    db.session.commit()


def set_folder_template(user, category_id, template_id):
    cat = UserNoteCategory.query.filter_by(id=category_id, user_id=user.id).first()
    if cat is None:
        raise ValueError("Folder not found")
    if template_id:
        if NoteTemplate.query.filter_by(id=template_id, user_id=user.id).first() is None:
            raise ValueError("Template not found")
        cat.default_template_id = template_id
    else:
        cat.default_template_id = None
    db.session.commit()


def get_folder_default_template(user, category_id):
    cat = UserNoteCategory.query.filter_by(id=category_id, user_id=user.id).first()
    if not cat or not cat.default_template_id:
        return None
    t = NoteTemplate.query.filter_by(id=cat.default_template_id, user_id=user.id).first()
    if not t:
        return None
    return t