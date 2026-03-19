import pytest
import sys
import os
import hashlib

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Set env vars BEFORE any imports that trigger create_app
os.environ['DATABASE_URI'] = 'sqlite:///:memory:'
os.environ['SECRET_KEY'] = 'test-secret-key'

from flasky import create_app, db
from flasky.models import User, Theme, ApiToken


@pytest.fixture(autouse=True)
def app_context():
    """Create a fresh app and database for each test."""
    app = create_app()
    app.config['TESTING'] = True
    app.config['WTF_CSRF_ENABLED'] = False

    with app.app_context():
        # create_app already calls db.create_all() and seeds themes,
        # but we drop/recreate to ensure a clean slate each test
        db.drop_all()
        db.create_all()
        # Seed themes
        themes = [
            ("Dash", "dash", False, False),
            ("Cozy", "cozy", False, False),
            ("Obsidified", "obsidified", False, False),
            ("CLI", "cli", False, False),
        ]
        for name, slug, has_categories, has_notes in themes:
            if not Theme.query.filter_by(slug=slug).first():
                t = Theme(name=name, slug=slug,
                          has_categories_page=has_categories,
                          has_notes_page=has_notes)
                db.session.add(t)
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


@pytest.fixture
def client(app_context):
    return app_context.test_client()


@pytest.fixture
def auth_client(client, app_context):
    """Register and login a test user."""
    username = "testuser"
    password = "testpassword"
    email = "test@test.com"

    client.post('/register', data={
        'username': username,
        'password': password,
        'email': email
    })

    client.post('/login', data={
        'username': username,
        'password': password
    })

    return client


@pytest.fixture
def sync_client(app_context):
    """Create a user with an API token for sync API testing.
    Returns (client, token, user)."""
    client = app_context.test_client()

    # Register and login
    client.post('/register', data={
        'username': 'syncuser',
        'password': 'syncpassword',
        'email': 'sync@test.com'
    })
    client.post('/login', data={
        'username': 'syncuser',
        'password': 'syncpassword'
    })

    # Create an API token directly
    plaintext = "test-sync-token-abc123"
    token_hash = hashlib.sha256(plaintext.encode('utf-8')).hexdigest()
    user = User.query.filter_by(username='syncuser').first()
    api_token = ApiToken(user_id=user.id, token_hash=token_hash, name="Test Token")
    db.session.add(api_token)
    db.session.commit()

    return client, plaintext, user
