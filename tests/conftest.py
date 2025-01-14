import pytest
import sys
import os
from datetime import datetime
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app import app, db, User, Theme

@pytest.fixture(autouse=True)
def app_context():
    app.config['TESTING'] = True
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
    app.config['WTF_CSRF_ENABLED'] = False
    
    with app.app_context():
        db.create_all()
        # Create default theme
        if not Theme.query.filter_by(slug="paper").first():
            paper = Theme(name="Paper", slug="paper", has_categories_page=True, has_notes_page=True)
            db.session.add(paper)
            db.session.commit()
        yield
        db.session.remove()
        db.drop_all()

@pytest.fixture
def client(app_context):
    return app.test_client()

@pytest.fixture
def auth_client(client):
    # Register and login a test user
    username = f"testuser_{datetime.now().timestamp()}"
    password = "testpass"
    email = f"test_{datetime.now().timestamp()}@test.com"
    
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
