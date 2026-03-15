"""
Functional Integration Tests: Sync API
Testing sync endpoints with Bearer token auth
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


def _headers(token):
    return {'Authorization': f'Bearer {token}'}


def test_sync_manifest_empty(sync_client):
    client, token, user = sync_client
    r = client.get('/api/sync/manifest', headers=_headers(token))
    assert r.status_code == 200
    assert r.json == []


def test_sync_create_note(sync_client):
    client, token, user = sync_client
    r = client.post('/api/sync/note',
                    json={'title': 'Sync Note', 'content': 'Hello from sync', 'category': 'Main'},
                    headers=_headers(token))
    assert r.status_code == 201
    assert r.json['title'] == 'Sync Note'
    assert 'content_hash' in r.json


def test_sync_get_note(sync_client):
    client, token, user = sync_client
    create_r = client.post('/api/sync/note',
                           json={'title': 'Get Me', 'content': 'Body', 'category': ''},
                           headers=_headers(token))
    note_id = create_r.json['id']

    r = client.get(f'/api/sync/note/{note_id}', headers=_headers(token))
    assert r.status_code == 200
    assert r.json['title'] == 'Get Me'


def test_sync_update_note(sync_client):
    client, token, user = sync_client
    create_r = client.post('/api/sync/note',
                           json={'title': 'Update Me', 'content': 'v1', 'category': ''},
                           headers=_headers(token))
    note_id = create_r.json['id']

    r = client.put(f'/api/sync/note/{note_id}',
                   json={'title': 'Updated', 'content': 'v2'},
                   headers=_headers(token))
    assert r.status_code == 200
    assert r.json['title'] == 'Updated'


def test_sync_delete_note(sync_client):
    client, token, user = sync_client
    create_r = client.post('/api/sync/note',
                           json={'title': 'Delete Me', 'content': '', 'category': ''},
                           headers=_headers(token))
    note_id = create_r.json['id']

    r = client.delete(f'/api/sync/note/{note_id}', headers=_headers(token))
    assert r.status_code == 200
    assert r.json['success'] is True

    # Manifest should be empty
    manifest = client.get('/api/sync/manifest', headers=_headers(token))
    assert len(manifest.json) == 0


def test_sync_manifest_with_notes(sync_client):
    client, token, user = sync_client
    client.post('/api/sync/note',
                json={'title': 'Note 1', 'content': 'Body 1', 'category': ''},
                headers=_headers(token))
    client.post('/api/sync/note',
                json={'title': 'Note 2', 'content': 'Body 2', 'category': ''},
                headers=_headers(token))

    r = client.get('/api/sync/manifest', headers=_headers(token))
    assert len(r.json) == 2
    assert all('content_hash' in note for note in r.json)


def test_sync_get_nonexistent_note(sync_client):
    client, token, user = sync_client
    r = client.get('/api/sync/note/9999', headers=_headers(token))
    assert r.status_code == 404


def test_sync_report_conflict(sync_client):
    client, token, user = sync_client
    r = client.post('/api/sync/conflict',
                    json={
                        'note_id': 1,
                        'local_title': 'Local Version',
                        'local_content': 'Local body',
                        'server_title': 'Server Version',
                        'server_content': 'Server body',
                        'category': 'Main'
                    },
                    headers=_headers(token))
    assert r.status_code == 201
    assert 'id' in r.json


def test_sync_list_conflicts(sync_client):
    client, token, user = sync_client
    client.post('/api/sync/conflict',
                json={
                    'note_id': 1,
                    'local_title': 'L',
                    'local_content': 'LC',
                    'server_title': 'S',
                    'server_content': 'SC',
                    'category': ''
                },
                headers=_headers(token))

    r = client.get('/api/sync/conflicts', headers=_headers(token))
    assert r.status_code == 200
    assert len(r.json) == 1
    assert r.json[0]['resolved'] is False


def test_sync_resolve_link(sync_client):
    client, token, user = sync_client
    client.post('/api/sync/note',
                json={'title': 'My Page', 'content': 'content', 'category': ''},
                headers=_headers(token))

    r = client.get('/api/sync/resolve-link?title=My Page', headers=_headers(token))
    assert r.status_code == 200
    assert r.json['title'] == 'My Page'


def test_sync_resolve_link_not_found(sync_client):
    client, token, user = sync_client
    r = client.get('/api/sync/resolve-link?title=Nonexistent', headers=_headers(token))
    assert r.status_code == 404


def test_sync_attachment_manifest_empty(sync_client):
    client, token, user = sync_client
    r = client.get('/api/sync/attachments', headers=_headers(token))
    assert r.status_code == 200
    assert r.json == []


def test_sync_requires_auth(client):
    r = client.get('/api/sync/manifest')
    assert r.status_code == 401


def test_sync_invalid_token(client):
    r = client.get('/api/sync/manifest', headers={'Authorization': 'Bearer invalid-token'})
    assert r.status_code == 401


def test_sync_frontmatter_roundtrip(sync_client):
    """Notes with frontmatter should have properties extracted and reconstructed."""
    client, token, user = sync_client
    content_with_fm = "---\ntags:\n  - python\n  - flask\nstatus: draft\n---\nActual body"

    create_r = client.post('/api/sync/note',
                           json={'title': 'FM Note', 'content': content_with_fm, 'category': ''},
                           headers=_headers(token))
    note_id = create_r.json['id']

    get_r = client.get(f'/api/sync/note/{note_id}', headers=_headers(token))
    content = get_r.json['content']
    # Reconstructed content should contain the frontmatter
    assert 'tags:' in content
    assert 'Actual body' in content
