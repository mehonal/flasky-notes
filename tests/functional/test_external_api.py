"""
Functional Integration Tests: External API
Testing /api/external/* endpoints with username/password auth
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from flasky.models import User


USERNAME = "extuser"
PASSWORD = "extpassword"
EMAIL = "ext@test.com"


def _setup_user(app_context):
    """Create a user for external API tests."""
    user = User(USERNAME, PASSWORD, EMAIL)
    return user


def test_external_get_notes_empty(app_context, client):
    _setup_user(app_context)
    r = client.post('/api/external/get-notes',
                    json={'username': USERNAME, 'password': PASSWORD})
    assert r.status_code == 200
    assert r.json == []


def test_external_add_note(app_context, client):
    _setup_user(app_context)
    r = client.post('/api/external/add-note',
                    json={
                        'username': USERNAME,
                        'password': PASSWORD,
                        'title': 'External Note',
                        'content': 'Created via API',
                        'category': ''
                    })
    assert r.json['success'] is True
    assert r.json['note']['title'] == 'External Note'


def test_external_get_notes_after_add(app_context, client):
    _setup_user(app_context)
    client.post('/api/external/add-note',
                json={'username': USERNAME, 'password': PASSWORD,
                      'title': 'Note 1', 'content': 'Body', 'category': ''})
    client.post('/api/external/add-note',
                json={'username': USERNAME, 'password': PASSWORD,
                      'title': 'Note 2', 'content': 'Body', 'category': ''})

    r = client.post('/api/external/get-notes',
                    json={'username': USERNAME, 'password': PASSWORD})
    assert len(r.json) == 2


def test_external_get_notes_with_limit(app_context, client):
    _setup_user(app_context)
    for i in range(5):
        client.post('/api/external/add-note',
                    json={'username': USERNAME, 'password': PASSWORD,
                          'title': f'Note {i}', 'content': '', 'category': ''})

    r = client.post('/api/external/get-notes',
                    json={'username': USERNAME, 'password': PASSWORD, 'limit': 2})
    assert len(r.json) == 2


def test_external_get_single_note(app_context, client):
    _setup_user(app_context)
    add_r = client.post('/api/external/add-note',
                        json={'username': USERNAME, 'password': PASSWORD,
                              'title': 'Single', 'content': 'Body', 'category': ''})
    note_id = add_r.json['note']['id']

    r = client.post('/api/external/get-note',
                    json={'username': USERNAME, 'password': PASSWORD, 'note-id': note_id})
    assert r.json['success'] is True
    assert r.json['note']['title'] == 'Single'


def test_external_edit_note(app_context, client):
    _setup_user(app_context)
    add_r = client.post('/api/external/add-note',
                        json={'username': USERNAME, 'password': PASSWORD,
                              'title': 'Original', 'content': 'v1', 'category': ''})
    note_id = add_r.json['note']['id']

    r = client.post('/api/external/edit-note',
                    json={'username': USERNAME, 'password': PASSWORD,
                          'note-id': note_id, 'title': 'Updated', 'content': 'v2'})
    assert r.json['success'] is True
    assert r.json['note']['title'] == 'Updated'


def test_external_wrong_password(app_context, client):
    _setup_user(app_context)
    r = client.post('/api/external/get-notes',
                    json={'username': USERNAME, 'password': 'wrongpassword'})
    assert r.json['success'] is False
    assert 'invalid credentials' in r.json['reason'].lower()


def test_external_nonexistent_user(client):
    r = client.post('/api/external/get-notes',
                    json={'username': 'nobody', 'password': 'whatever'})
    assert r.json['success'] is False
    assert 'invalid credentials' in r.json['reason'].lower()


def test_external_get_nonexistent_note(app_context, client):
    _setup_user(app_context)
    r = client.post('/api/external/get-note',
                    json={'username': USERNAME, 'password': PASSWORD, 'note-id': 9999})
    assert r.json['success'] is False
