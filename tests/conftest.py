import pytest
import sys
import os
import hashlib

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Set env vars BEFORE any imports that trigger create_app
os.environ['DATABASE_URI'] = 'sqlite:///:memory:'
os.environ['SECRET_KEY'] = 'test-secret-key'

from flasky import create_app, db
from flasky.models import User, ApiToken
from tests.e2ee_helpers import make_e2ee_user


@pytest.fixture(autouse=True)
def app_context():
    """Create a fresh app and in-memory database for each test."""
    app = create_app()
    app.config['TESTING'] = True  # disables CSRF check in before_request

    with app.app_context():
        db.drop_all()
        db.create_all()
        yield app
        db.session.remove()
        db.drop_all()


@pytest.fixture
def client(app_context):
    return app_context.test_client()


@pytest.fixture
def auth_client(app_context):
    """Register and login an E2EE test user via the real auth flow.

    Returns (client, creds) where creds contains the symmetric key, auth_key,
    etc. Tests that need to send encrypted content should use enc(creds, ...)
    from tests.e2ee_helpers.
    """
    client = app_context.test_client()
    creds = make_e2ee_user(client, "testuser", "testpassword123")
    return client, creds


@pytest.fixture
def sync_client(app_context):
    """Create an E2EE user with an API token for sync API testing.
    Returns (client, token, user, creds).
    """
    client = app_context.test_client()
    creds = make_e2ee_user(client, "syncuser", "syncpassword123")

    # Create an API token directly in the DB
    plaintext = "test-sync-token-abc123"
    token_hash = hashlib.sha256(plaintext.encode('utf-8')).hexdigest()
    user = User.query.filter_by(username='syncuser').first()
    api_token = ApiToken(user_id=user.id, token_hash=token_hash, name="Test Token")
    db.session.add(api_token)
    db.session.commit()

    return client, plaintext, user, creds