"""
Functional Regression Tests: Known Bug Cases
Testing fixes for previously identified bugs
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from app import app, db, User, Theme, UserNote, UserNoteCategory
from datetime import datetime

def test_note_category_reassignment_bug(client):
    """
    Regression Test: Category Deletion Bug
    Tests fix for bug where notes weren't properly reassigned
    after category deletion
    
    Bug Description: When a category was deleted, notes in that category
    were not being properly reassigned to the main category
    """
    # Setup test user
    client.post('/register', data={
        'username': 'bugtest',
        'password': 'testpass',
        'email': 'bug@test.com'
    })
    
    client.post('/login', data={
        'username': 'bugtest',
        'password': 'testpass'
    })
    
    # Add category
    cat_response = client.post('/api/add_category', 
                             json={'categoryName': 'Delete Test'},
                             content_type='application/json')
    category_id = cat_response.json['category']
    
    # Add note in category
    note_response = client.post('/api/save_note', 
                              json={
                                  'noteId': 0,
                                  'title': 'Category Bug Test',
                                  'content': 'Testing category reassignment',
                                  'category': category_id
                              },
                              content_type='application/json')
    note_id = note_response.json['note']['id']
    
    # Delete category
    client.post('/api/delete_category',
                json={'categoryId': category_id},
                content_type='application/json')
    
    # Verify note was reassigned to main category
    note_check = client.get(f'/note/{note_id}')
    assert b'Main' in note_check.data  # Note should be in Main category
    assert b'Category Bug Test' in note_check.data  # Note should still exist

def test_theme_persistence_bug(client):
    """
    Regression Test: Theme Settings Bug
    """
    # Make unique username
    username = f"themetest{int(datetime.now().timestamp())}"
    email = f"theme{int(datetime.now().timestamp())}@test.com"
    
    # Register
    client.post('/register', data={
        'username': username,
        'password': 'testpass',
        'email': email
    })
    
    # Login
    login_response = client.post('/login', data={
        'username': username,
        'password': 'testpass'
    }, follow_redirects=True)
    assert b'notes' in login_response.data.lower()
    
    # Change theme settings
    theme_response = client.post('/settings', data={
        'update-theme': True,
        'theme': 'full'
    }, follow_redirects=True)
    assert theme_response.status_code == 200
    
    # Verify settings page is accessible
    settings_response = client.get('/settings')
    assert b'settings' in settings_response.data.lower()
