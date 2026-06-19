"""WSGI entry point for production (gunicorn wsgi:app)."""
from flasky import create_app

app = create_app()