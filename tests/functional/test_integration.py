"""
Functional Integration Tests: Notes, Todos, Events, Categories, Search APIs
Testing API endpoints through HTTP
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


# === Notes API ===

def test_save_and_get_notes(auth_client):
    response = auth_client.post('/api/save_note',
                                json={'noteId': 0, 'title': 'Test Note', 'content': 'Test Content', 'category': None})
    assert response.status_code == 200
    assert response.json['success'] is True
    assert response.json['note']['title'] == 'Test Note'

    notes_response = auth_client.get('/api/get_all_notes')
    assert notes_response.status_code == 200
    assert len(notes_response.json) == 1
    assert notes_response.json[0]['title'] == 'Test Note'


def test_save_note_update_existing(auth_client):
    r = auth_client.post('/api/save_note',
                         json={'noteId': 0, 'title': 'Original', 'content': 'Body', 'category': None})
    note_id = r.json['note']['id']

    r2 = auth_client.post('/api/save_note',
                          json={'noteId': note_id, 'title': 'Updated', 'content': 'New Body', 'category': None})
    assert r2.json['success'] is True
    assert r2.json['note']['title'] == 'Updated'


def test_delete_note(auth_client):
    r = auth_client.post('/api/save_note',
                         json={'noteId': 0, 'title': 'To Delete', 'content': 'Body', 'category': None})
    note_id = r.json['note']['id']

    del_r = auth_client.post('/api/delete_note', json={'noteId': note_id})
    assert del_r.json['success'] is True

    notes = auth_client.get('/api/get_all_notes')
    assert len(notes.json) == 0


def test_search_notes(auth_client):
    auth_client.post('/api/save_note',
                     json={'noteId': 0, 'title': 'Python Guide', 'content': 'Learn Python', 'category': None})
    auth_client.post('/api/save_note',
                     json={'noteId': 0, 'title': 'Rust Guide', 'content': 'Learn Rust', 'category': None})

    r = auth_client.post('/api/search_notes', json={'query': 'Python'})
    assert r.status_code == 200
    assert len(r.json) == 1
    assert r.json[0]['title'] == 'Python Guide'


def test_search_notes_by_content(auth_client):
    auth_client.post('/api/save_note',
                     json={'noteId': 0, 'title': 'Note A', 'content': 'Contains unique_keyword here', 'category': None})
    auth_client.post('/api/save_note',
                     json={'noteId': 0, 'title': 'Note B', 'content': 'Nothing special', 'category': None})

    r = auth_client.post('/api/search_notes', json={'query': 'unique_keyword'})
    assert len(r.json) == 1
    assert r.json[0]['title'] == 'Note A'


def test_load_notes_pagination(auth_client):
    for i in range(7):
        auth_client.post('/api/save_note',
                         json={'noteId': 0, 'title': f'Note {i}', 'content': 'Body', 'category': None})

    page1 = auth_client.post('/api/load_notes', json={'page': 1})
    assert len(page1.json) == 5

    page2 = auth_client.post('/api/load_notes', json={'page': 2})
    assert len(page2.json) == 2


def test_note_map(auth_client):
    auth_client.post('/api/save_note',
                     json={'noteId': 0, 'title': 'My Note', 'content': 'Body', 'category': None})

    r = auth_client.get('/api/note-map')
    assert r.status_code == 200
    data = r.json
    assert 'notes' in data
    assert 'attachments' in data
    assert 'my note' in data['notes']


# === Backlinks and Outbound Links ===

def test_backlinks(auth_client):
    r1 = auth_client.post('/api/save_note',
                          json={'noteId': 0, 'title': 'Target Note', 'content': 'I am the target', 'category': None})
    target_id = r1.json['note']['id']

    auth_client.post('/api/save_note',
                     json={'noteId': 0, 'title': 'Linker', 'content': 'See [[Target Note]] for details', 'category': None})

    r = auth_client.get(f'/api/backlinks/{target_id}')
    assert r.status_code == 200
    assert len(r.json) == 1
    assert r.json[0]['title'] == 'Linker'


def test_outbound_links(auth_client):
    auth_client.post('/api/save_note',
                     json={'noteId': 0, 'title': 'Target', 'content': 'target body', 'category': None})
    r2 = auth_client.post('/api/save_note',
                          json={'noteId': 0, 'title': 'Source', 'content': 'Link to [[Target]]', 'category': None})
    source_id = r2.json['note']['id']

    r = auth_client.get(f'/api/outbound-links/{source_id}')
    assert r.status_code == 200
    assert len(r.json) == 1
    assert r.json[0]['title'] == 'Target'


# === Categories ===

def test_add_category(auth_client):
    r = auth_client.post('/api/add_category', json={'categoryName': 'Work'})
    assert r.json['success'] is True
    assert r.json['category'] is not None


def test_edit_note_category(auth_client):
    cat_r = auth_client.post('/api/add_category', json={'categoryName': 'Personal'})
    cat_id = cat_r.json['category']

    note_r = auth_client.post('/api/save_note',
                              json={'noteId': 0, 'title': 'Note', 'content': 'Body', 'category': None})
    note_id = note_r.json['note']['id']

    r = auth_client.post('/api/edit_note_category', json={'noteId': note_id, 'category': cat_id})
    assert r.json['success'] is True


def test_delete_category_reassigns_notes(auth_client):
    cat_r = auth_client.post('/api/add_category', json={'categoryName': 'Temp'})
    cat_id = cat_r.json['category']

    note_r = auth_client.post('/api/save_note',
                              json={'noteId': 0, 'title': 'Cat Note', 'content': 'Body', 'category': cat_id})
    note_id = note_r.json['note']['id']

    auth_client.post('/api/delete_category', json={'categoryId': cat_id})

    note_check = auth_client.get(f'/note/{note_id}')
    assert note_check.status_code == 200
    assert b'Cat Note' in note_check.data


def test_move_category(auth_client):
    cat_r = auth_client.post('/api/add_category', json={'categoryName': 'Projects'})
    cat_id = cat_r.json['category']

    parent_r = auth_client.post('/api/add_category', json={'categoryName': 'Work'})

    r = auth_client.post('/api/move_category',
                         json={'categoryId': cat_id, 'targetPath': 'Work'})
    assert r.json['success'] is True


def test_cannot_delete_main_category(auth_client):
    from flasky.models import User
    user = User.query.filter_by(username='testuser').first()
    main = user.get_main_category()

    r = auth_client.post('/api/delete_category', json={'categoryId': main.id})
    assert r.json['success'] is False


# === Todos API ===

def test_add_todo(auth_client):
    r = auth_client.post('/api/add_todo',
                         json={'title': 'Buy groceries', 'content': 'Milk, eggs', 'dateDue': '2026-04-01'})
    assert r.json['success'] is True
    assert r.json['todo']['title'] == 'Buy groceries'


def test_get_todos(auth_client):
    auth_client.post('/api/add_todo', json={'title': 'Todo 1', 'content': '', 'dateDue': ''})
    auth_client.post('/api/add_todo', json={'title': 'Todo 2', 'content': '', 'dateDue': ''})

    r = auth_client.get('/api/get_todos')
    assert r.status_code == 200
    assert len(r.json) == 2


def test_get_single_todo(auth_client):
    r = auth_client.post('/api/add_todo', json={'title': 'Single', 'content': 'Details', 'dateDue': ''})
    todo_id = r.json['id']

    r2 = auth_client.get(f'/api/get_todo/{todo_id}')
    assert r2.json['success'] is True
    assert r2.json['todo']['title'] == 'Single'


def test_edit_todo(auth_client):
    r = auth_client.post('/api/add_todo', json={'title': 'Original', 'content': '', 'dateDue': ''})
    todo_id = r.json['id']

    r2 = auth_client.post('/api/edit_todo',
                          json={'toDoId': todo_id, 'title': 'Updated', 'content': 'New', 'dateDue': ''})
    assert r2.json['success'] is True
    assert r2.json['todo']['title'] == 'Updated'


def test_toggle_todo(auth_client):
    r = auth_client.post('/api/add_todo', json={'title': 'Toggle Me', 'content': '', 'dateDue': ''})
    todo_id = r.json['id']

    r2 = auth_client.post('/api/toggle_todo', json={'toDoId': todo_id, 'status': '1'})
    assert r2.json['success'] is True

    r3 = auth_client.get(f'/api/get_todo/{todo_id}')
    assert r3.json['todo']['completed'] is True


def test_archive_unarchive_todo(auth_client):
    r = auth_client.post('/api/add_todo', json={'title': 'Archive Me', 'content': '', 'dateDue': ''})
    todo_id = r.json['id']

    auth_client.post('/api/archive_todo', json={'toDoId': todo_id})
    archived = auth_client.get('/api/get_todos?archived=true')
    assert any(t['id'] == todo_id for t in archived.json)

    auth_client.post('/api/unarchive_todo', json={'toDoId': todo_id})
    active = auth_client.get('/api/get_todos')
    assert any(t['id'] == todo_id for t in active.json)


def test_delete_todo(auth_client):
    r = auth_client.post('/api/add_todo', json={'title': 'Delete Me', 'content': '', 'dateDue': ''})
    todo_id = r.json['id']

    r2 = auth_client.post('/api/delete_todo', json={'toDoId': todo_id})
    assert r2.json['success'] is True

    r3 = auth_client.get('/api/get_todos')
    assert len(r3.json) == 0


# === Events API ===

def test_add_event(auth_client):
    r = auth_client.post('/api/add_event',
                         json={'title': 'Meeting', 'content': 'Team sync', 'dateOfEvent': '2026-04-15'})
    assert r.json['success'] is True
    assert r.json['event']['title'] == 'Meeting'


def test_get_events(auth_client):
    auth_client.post('/api/add_event', json={'title': 'Event 1', 'content': '', 'dateOfEvent': ''})
    auth_client.post('/api/add_event', json={'title': 'Event 2', 'content': '', 'dateOfEvent': ''})

    r = auth_client.get('/api/get_events')
    assert r.status_code == 200
    assert len(r.json) == 2


def test_get_single_event(auth_client):
    r = auth_client.post('/api/add_event', json={'title': 'Single Event', 'content': '', 'dateOfEvent': ''})
    event_id = r.json['id']

    r2 = auth_client.get(f'/api/get_event/{event_id}')
    assert r2.json['success'] is True
    assert r2.json['event']['title'] == 'Single Event'


def test_edit_event(auth_client):
    r = auth_client.post('/api/add_event', json={'title': 'Original', 'content': '', 'dateOfEvent': ''})
    event_id = r.json['id']

    r2 = auth_client.post('/api/edit_event',
                          json={'eventId': event_id, 'title': 'Updated', 'content': 'New', 'dateOfEvent': '2026-05-01'})
    assert r2.json['success'] is True
    assert r2.json['event']['title'] == 'Updated'


def test_delete_event(auth_client):
    r = auth_client.post('/api/add_event', json={'title': 'Delete Me', 'content': '', 'dateOfEvent': ''})
    event_id = r.json['id']

    r2 = auth_client.post('/api/delete_event', json={'eventId': event_id})
    assert r2.json['success'] is True

    r3 = auth_client.get('/api/get_events')
    assert len(r3.json) == 0


# === Theme Settings API ===

def test_save_dark_mode(auth_client):
    r = auth_client.get('/api/save_dark_mode/1')
    assert r.json['success'] is True
    assert r.json['new_dark_mode_setting'] is True


def test_save_font_size(auth_client):
    r = auth_client.get('/api/save_font_size/20')
    assert r.json['success'] is True
    assert r.json['font_size'] == 20


def test_save_notes_row_count(auth_client):
    r = auth_client.get('/api/save_notes_row_count/5')
    assert r.json['success'] is True
    assert r.json['new_row_count'] == 5


# === Auth-required endpoints return failure when not logged in ===

def test_notes_api_requires_auth(client):
    r = client.get('/api/get_all_notes')
    assert r.json['success'] is False


def test_todos_api_requires_auth(client):
    r = client.get('/api/get_todos')
    assert r.json['success'] is False
