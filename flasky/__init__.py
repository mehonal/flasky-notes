from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_talisman import Talisman
from sqlalchemy import MetaData
from datetime import timedelta
import os
import logging

from dotenv import load_dotenv

load_dotenv()

import config as CONFIG

convention = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

metadata = MetaData(naming_convention=convention)
db = SQLAlchemy(metadata=metadata)
migrate = Migrate()


def create_app():
    app = Flask(
        __name__,
        template_folder=os.path.join(
            os.path.dirname(os.path.dirname(__file__)), "templates"
        ),
        static_folder=os.path.join(
            os.path.dirname(os.path.dirname(__file__)), "static"
        ),
    )

    app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get("DATABASE_URI")
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY")
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["MAX_CONTENT_LENGTH"] = CONFIG.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    app.config["SESSION_COOKIE_HTTPONLY"] = True
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
    app.config["RECAPTCHA_ENABLED"] = CONFIG.RECAPTCHA_ENABLED
    if CONFIG.RECAPTCHA_ENABLED:
        app.config["RECAPTCHA_SITE_KEY"] = os.environ.get("RECAPTCHA_SITE_KEY", "")
        app.config["RECAPTCHA_SECRET_KEY"] = os.environ.get("RECAPTCHA_SECRET_KEY", "")
    if CONFIG.ENFORCE_SSL:
        app.config["SESSION_COOKIE_SECURE"] = True

    app.permanent_session_lifetime = timedelta(days=CONFIG.SESSION_LIFETIME)

    # Compute ATTACHMENT_DIR relative to project root
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    attachment_dir = os.path.join(project_root, "instance", "attachments")
    os.makedirs(attachment_dir, exist_ok=True)
    app.config["ATTACHMENT_DIR"] = attachment_dir

    db.init_app(app)
    migrate.init_app(app, db, render_as_batch=True)

    # Security headers via Talisman
    csp = {
        "default-src": "'none'",
        "script-src": "'self'",
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:", "blob:"],
        "font-src": "'self'",
        "connect-src": "'self'",
        "media-src": ["'self'", "blob:"],
        "frame-src": "'none'",
        "object-src": "'none'",
        "base-uri": "'self'",
        "form-action": "'self'",
        "manifest-src": "'self'",
    }
    if CONFIG.RECAPTCHA_ENABLED:
        csp["script-src"] = [
            "'self'",
            "https://www.google.com/recaptcha/",
            "https://www.gstatic.com/recaptcha/",
        ]
        csp["frame-src"] = [
            "https://www.google.com/recaptcha/",
            "https://recaptcha.google.com/recaptcha/",
        ]
        csp["style-src"].append("https://www.google.com/recaptcha/")
        csp["img-src"].append("https://www.google.com/recaptcha/")
        csp["connect-src"] = ["'self'", "https://www.google.com/recaptcha/"]
    Talisman(
        app,
        force_https=CONFIG.ENFORCE_SSL,
        content_security_policy=csp,
        content_security_policy_nonce_in=["script-src"],
        session_cookie_secure=CONFIG.ENFORCE_SSL,
    )

    # Configure logging. Use a stream handler (stdout) so logs go to the
    # container/daemon's stdout instead of a hardcoded file in the cwd. The
    # log level is WARNING by default; set LOG_LEVEL env var to override.
    log_level = os.environ.get("LOG_LEVEL", "WARNING").upper()
    handler = logging.StreamHandler()
    handler.setFormatter(
        logging.Formatter(
            "%(asctime)s %(levelname)s %(name)s %(threadName)s : %(message)s"
        )
    )
    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)
    # Avoid duplicate handlers if create_app() is called more than once (tests)
    if not root_logger.handlers:
        root_logger.addHandler(handler)
    app.logger.setLevel(log_level)

    # flask-smorest config (used by the @bp.arguments validation decorator
    # on the notes/categories/agenda/templates blueprints). The OpenAPI spec
    # is generated but not served publicly; these values just satisfy the lib.
    app.config["API_TITLE"] = "Flasky Notes API"
    app.config["API_VERSION"] = "v3"
    app.config["OPENAPI_VERSION"] = "3.0.2"

    # Register blueprints
    from flask_smorest import Api as SmorestApi
    from flasky.blueprints.web import web_bp
    from flasky.blueprints.notes import notes_bp
    from flasky.blueprints.categories import categories_bp
    from flasky.blueprints.agenda import agenda_bp
    from flasky.blueprints.templates import templates_bp
    from flasky.blueprints.attachments import attachments_bp
    from flasky.blueprints.ui_state import ui_state_bp
    from flasky.blueprints.external_api import external_api_bp
    from flasky.blueprints.sync_api import sync_api_bp
    from flasky.blueprints.ai import ai_bp

    # Plain Flask blueprints (no smorest validation) register directly
    app.register_blueprint(web_bp)
    app.register_blueprint(external_api_bp)
    app.register_blueprint(sync_api_bp)
    app.register_blueprint(ai_bp)
    app.register_blueprint(attachments_bp)
    app.register_blueprint(ui_state_bp)

    # smorest blueprints register through an Api so @bp.arguments works
    api = SmorestApi(app)
    api.register_blueprint(notes_bp)
    api.register_blueprint(categories_bp)
    api.register_blueprint(agenda_bp)
    api.register_blueprint(templates_bp)

    # Central JSON error handlers (NoteNotFound, NotOwner, validation, etc.)
    from flasky.utils import register_error_handlers

    register_error_handlers(app)

    # Expose format_utc_iso to templates so naive-UTC datetimes render with an
    # explicit Z suffix (e.g. data-date attributes consumed by JS via new Date()).
    from flasky.utils import format_utc_iso as _format_utc_iso

    app.jinja_env.filters["utc_iso"] = _format_utc_iso

    # Set CSRF cookie on responses so client JS can read it
    @app.after_request
    def set_csrf_cookie(response):
        from flask import session

        csrf_token = session.get("csrf_token")
        if csrf_token:
            response.set_cookie(
                "X-CSRF-Token",
                csrf_token,
                httponly=False,
                secure=CONFIG.ENFORCE_SSL,
                samesite="Strict",
                max_age=24 * 3600,
            )
        if CONFIG.DISABLE_CACHING:
            response.headers["Cache-Control"] = " no-store,  max-age=0"
        return response

    # SSL validation route
    if CONFIG.ENFORCE_SSL:

        @app.route("/.well-known/pki-validation/valid.txt")
        def ssl_validation():
            return "validate ssl here."

    return app
