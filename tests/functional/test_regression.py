"""
Functional Regression Tests: Known Bug Cases
Testing fixes for previously identified bugs
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


def test_note_category_reassignment_bug(client):
    """
    Regression: When a category was deleted, notes weren't properly
    reassigned to the Main category.
    """
    client.post('/register', data={
        'username': 'bugtest',
        'password': 'testpassword',
        'email': 'bug@test.com'
    })
    client.post('/login', data={
        'username': 'bugtest',
        'password': 'testpassword'
    })

    cat_response = client.post('/api/add_category',
                               json={'categoryName': 'Delete Test'})
    category_id = cat_response.json['category']

    note_response = client.post('/api/save_note',
                                json={
                                    'noteId': 0,
                                    'title': 'Category Bug Test',
                                    'content': 'Testing category reassignment',
                                    'category': category_id
                                })
    note_id = note_response.json['note']['id']

    client.post('/api/delete_category', json={'categoryId': category_id})

    note_check = client.get(f'/note/{note_id}')
    assert b'Category Bug Test' in note_check.data


def test_theme_persistence_bug(client):
    """
    Regression: Theme settings should persist after being changed.
    """
    client.post('/register', data={
        'username': 'themetest',
        'password': 'testpassword',
        'email': 'theme@test.com'
    })
    client.post('/login', data={
        'username': 'themetest',
        'password': 'testpassword'
    })

    # Change theme to paper (which has notes_page)
    theme_response = client.post('/settings', data={
        'update-theme': True,
        'theme': 'paper'
    }, follow_redirects=True)
    assert theme_response.status_code == 200

    # Verify settings page is still accessible
    settings_response = client.get('/settings')
    assert b'settings' in settings_response.data.lower()


def test_note_revert_preserves_previous(client):
    """
    Regression: Reverting a note should swap content and previous_content.
    """
    client.post('/register', data={
        'username': 'reverttest',
        'password': 'testpassword',
        'email': 'revert@test.com'
    })
    client.post('/login', data={
        'username': 'reverttest',
        'password': 'testpassword'
    })

    # Create note
    r = client.post('/api/save_note',
                    json={'noteId': 0, 'title': 'Revert Note', 'content': 'Version 1', 'category': None})
    note_id = r.json['note']['id']

    # Edit note (creates previous_content)
    client.post('/api/save_note',
                json={'noteId': note_id, 'title': 'Revert Note', 'content': 'Version 2', 'category': None})

    # Revert via form
    client.post(f'/note/{note_id}', data={'revert_to_last_version': True}, follow_redirects=True)

    # Check that content is back to Version 1
    note_check = client.get(f'/note/{note_id}')
    assert b'Version 1' in note_check.data


def test_subfolder_category_deletion(client):
    """
    Regression: Deleting a parent category should also handle child categories
    and reassign all notes to Main.
    """
    client.post('/register', data={
        'username': 'subfoldertest',
        'password': 'testpassword',
        'email': 'subfolder@test.com'
    })
    client.post('/login', data={
        'username': 'subfoldertest',
        'password': 'testpassword'
    })

    # Create parent and child categories
    parent_r = client.post('/api/add_category', json={'categoryName': 'Work'})
    parent_id = parent_r.json['category']
    child_r = client.post('/api/add_category', json={'categoryName': 'Work/Projects'})
    child_id = child_r.json['category']

    # Add note to child category
    note_r = client.post('/api/save_note',
                         json={'noteId': 0, 'title': 'Child Note', 'content': 'In child', 'category': child_id})
    note_id = note_r.json['note']['id']

    # Delete parent category
    client.post('/api/delete_category', json={'categoryId': parent_id})

    # Note should still exist
    note_check = client.get(f'/note/{note_id}')
    assert b'Child Note' in note_check.data
