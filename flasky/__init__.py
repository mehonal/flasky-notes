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
    "ix": 'ix_%(column_0_label)s',
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s"
}

metadata = MetaData(naming_convention=convention)
db = SQLAlchemy(metadata=metadata)
migrate = Migrate()


def create_app():
    app = Flask(__name__,
                template_folder=os.path.join(os.path.dirname(os.path.dirname(__file__)), 'templates'),
                static_folder=os.path.join(os.path.dirname(os.path.dirname(__file__)), 'static'))

    app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URI')
    app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY')
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['MAX_CONTENT_LENGTH'] = CONFIG.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    app.config['SESSION_COOKIE_HTTPONLY'] = True
    app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
    if CONFIG.ENFORCE_SSL:
        app.config['SESSION_COOKIE_SECURE'] = True

    app.permanent_session_lifetime = timedelta(days=CONFIG.SESSION_LIFETIME)

    # Compute ATTACHMENT_DIR relative to project root
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    attachment_dir = os.path.join(project_root, 'instance', 'attachments')
    os.makedirs(attachment_dir, exist_ok=True)
    app.config['ATTACHMENT_DIR'] = attachment_dir

    db.init_app(app)
    migrate.init_app(app, db, render_as_batch=True)

    # Security headers via Talisman
    csp = {
        'default-src': "'self'",
        'script-src': ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
        'style-src': ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
        'img-src': ["'self'", "data:"],
        'font-src': "'self'",
        'connect-src': "'self'",
        'frame-src': "'none'",
        'object-src': "'none'",
        'base-uri': "'self'",
        'form-action': "'self'",
    }
    Talisman(
        app,
        force_https=CONFIG.ENFORCE_SSL,
        content_security_policy=csp,
        session_cookie_secure=CONFIG.ENFORCE_SSL,
    )

    logging.basicConfig(filename='applog.log', level=logging.WARNING,
                        format=f'%(asctime)s %(levelname)s %(name)s %(threadName)s : %(message)s')

    # Register blueprints
    from flasky.blueprints.web import web_bp
    from flasky.blueprints.notes_api import notes_api_bp
    from flasky.blueprints.external_api import external_api_bp
    from flasky.blueprints.sync_api import sync_api_bp

    app.register_blueprint(web_bp)
    app.register_blueprint(notes_api_bp)
    app.register_blueprint(external_api_bp)
    app.register_blueprint(sync_api_bp)

    # Set CSRF cookie on responses so client JS can read it
    @app.after_request
    def set_csrf_cookie(response):
        from flask import session
        csrf_token = session.get('csrf_token')
        if csrf_token:
            response.set_cookie(
                'X-CSRF-Token',
                csrf_token,
                httponly=False,
                secure=CONFIG.ENFORCE_SSL,
                samesite='Strict',
                max_age=24 * 3600
            )
        if CONFIG.DISABLE_CACHING:
            response.headers["Cache-Control"] = " no-store,  max-age=0"
        return response

    # SSL validation route
    if CONFIG.ENFORCE_SSL:
        @app.route("/.well-known/pki-validation/valid.txt")
        def ssl_validation():
            return "validate ssl here."

    # Seed themes
    with app.app_context():
        from flasky.models import Theme
        db.create_all()
        _seed_themes()
        db.session.commit()

    return app


def _seed_themes():
    from flasky.models import Theme
    themes = [
        ("Cozy", "cozy", False, False),
        ("Obsidified", "obsidified", False, False),
        ("CLI", "cli", False, False)
    ]
    for name, slug, has_categories, has_notes in themes:
        if Theme.query.filter_by(slug=slug).first() is None:
            t = Theme(name=name, slug=slug, has_categories_page=has_categories, has_notes_page=has_notes)
            db.session.add(t)
