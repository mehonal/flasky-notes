import pytest
import sys
import os
import hashlib

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from flasky import create_app, db
from flasky.models import User, ApiToken
from tests.e2ee_helpers import make_e2ee_user

TEST_DB_URI = "sqlite:///:memory:"
TEST_SECRET_KEY = "test-secret-key"


@pytest.fixture(autouse=True)
def app_context(monkeypatch):
    """Create a fresh app and in-memory database for each test.

    The in-memory URI is set via monkeypatch (auto-restored after the test)
    and re-asserted on app.config after create_app(), so the lazy SQLAlchemy
    engine always binds to :memory: regardless of import order or inherited
    env vars. A hard assert before drop_all refuses to touch any non-memory
    URI — this is the tripwire that prevents the test suite from ever
    wiping a file DB.
    """
    monkeypatch.setenv("DATABASE_URI", TEST_DB_URI)
    monkeypatch.setenv("SECRET_KEY", TEST_SECRET_KEY)
    app = create_app()
    app.config['TESTING'] = True  # disables CSRF check in before_request
    app.config['SQLALCHEMY_DATABASE_URI'] = TEST_DB_URI

    uri = app.config['SQLALCHEMY_DATABASE_URI']
    assert ":memory:" in uri, f"Refusing to test against non-memory DB: {uri!r}"

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