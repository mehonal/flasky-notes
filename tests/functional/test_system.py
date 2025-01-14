"""
Functional System Tests: Complete User Flows
Testing complete user scenarios
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from app import app, db, User, Theme, UserNote, UserNoteCategory
import random
import string

def random_username_generator(k):
    return ''.join(random.choices(string.ascii_lowercase, k=k))

def random_password_generator(k):
    return ''.join(random.choices(string.ascii_lowercase, k=k))

def generate_complete_note_management_flow(client, username, password):
    """
    System Test: Complete Note Management
    Tests user registration through note management
    """
    email = f"{username}@test.com"
    
    # 1. Register
    register_response = client.post('/register', data={
        'username': username,
        'password': password,
        'email': email
    }, follow_redirects=True)
    if len(username) < 4 or len(password) < 8 or len(password) > 100 or len(username) > 30:
        assert b'must be' in register_response.data.lower()
        return True
    else:
        assert b'sign in' in register_response.data.lower()
    # assert b'sign in' in register_response.data.lower()
    
    # 2. Login
    login_response = client.post('/login', data={
        'username': username,
        'password': password
    }, follow_redirects=True)
    assert b'notes' in login_response.data.lower()
    
    # 3. Add note
    note_response = client.post('/note/0', data={
        'title': 'Flow Test Note',
        'content': 'Test content for flow',
        'update-note': True
    }, follow_redirects=True)
    assert b'Flow Test Note' in note_response.data
    
    # 4. Add to category
    # First add category
    cat_response = client.post('/api/add_category', 
                             json={'categoryName': 'Flow Category'},
                             content_type='application/json')
    assert cat_response.json['success'] == True
    category_id = cat_response.json['category']
    
    # Add note in new category
    categorized_note = client.post('/api/save_note', 
                                 json={
                                     'noteId': 0,
                                     'title': 'Categorized Flow Note',
                                     'content': 'Content in category',
                                     'category': category_id
                                 },
                                 content_type='application/json')
    assert categorized_note.json['success'] == True
    
    # 5. Modify theme
    theme_response = client.post('/settings', data={
        'update-theme': True,
        'theme': 'cozy'
    }, follow_redirects=True)
    assert b'settings' in theme_response.data.lower()
    
def test_3_character_username_7_character_password(client):
    username = random_username_generator(3)
    password = random_password_generator(7)
    generate_complete_note_management_flow(client, username, password)

def test_3_character_username_8_character_password(client):
    username = random_username_generator(3)
    password = random_password_generator(8)
    generate_complete_note_management_flow(client, username, password)

def test_3_character_username_9_character_password(client):
    username = random_username_generator(3)
    password = random_password_generator(9)
    generate_complete_note_management_flow(client, username, password)

def test_3_character_username_99_character_password(client):
    username = random_username_generator(3)
    password = random_password_generator(99)
    generate_complete_note_management_flow(client, username, password)

def test_3_character_username_100_character_password(client):
    username = random_username_generator(3)
    password = random_password_generator(100)
    generate_complete_note_management_flow(client, username, password)

def test_3_character_username_101_character_password(client):
    username = random_username_generator(3)
    password = random_password_generator(101)
    generate_complete_note_management_flow(client, username, password)

def test_4_character_username_7_character_password(client):
    username = random_username_generator(4)
    password = random_password_generator(7)
    generate_complete_note_management_flow(client, username, password)

def test_4_character_username_8_character_password(client):
    username = random_username_generator(4)
    password = random_password_generator(8)
    generate_complete_note_management_flow(client, username, password)

def test_4_character_username_9_character_password(client):
    username = random_username_generator(4)
    password = random_password_generator(9)
    generate_complete_note_management_flow(client, username, password)

def test_4_character_username_99_character_password(client):
    username = random_username_generator(4)
    password = random_password_generator(99)
    generate_complete_note_management_flow(client, username, password)

def test_4_character_username_100_character_password(client):
    username = random_username_generator(4)
    password = random_password_generator(100)
    generate_complete_note_management_flow(client, username, password)

def test_4_character_username_101_character_password(client):
    username = random_username_generator(4)
    password = random_password_generator(101)
    generate_complete_note_management_flow(client, username, password)

def test_5_character_username_7_character_password(client):
    username = random_username_generator(5)
    password = random_password_generator(7)
    generate_complete_note_management_flow(client, username, password)

def test_5_character_username_8_character_password(client):
    username = random_username_generator(5)
    password = random_password_generator(8)
    generate_complete_note_management_flow(client, username, password)

def test_5_character_username_9_character_password(client):
    username = random_username_generator(5)
    password = random_password_generator(9)
    generate_complete_note_management_flow(client, username, password)

def test_5_character_username_99_character_password(client):
    username = random_username_generator(5)
    password = random_password_generator(99)
    generate_complete_note_management_flow(client, username, password)

def test_5_character_username_100_character_password(client):
    username = random_username_generator(5)
    password = random_password_generator(100)
    generate_complete_note_management_flow(client, username, password)

def test_5_character_username_101_character_password(client):
    username = random_username_generator(5)
    password = random_password_generator(101)
    generate_complete_note_management_flow(client, username, password)

def test_29_character_username_7_character_password(client):
    username = random_username_generator(29)
    password = random_password_generator(7)
    generate_complete_note_management_flow(client, username, password)

def test_29_character_username_8_character_password(client):
    username = random_username_generator(29)
    password = random_password_generator(8)
    generate_complete_note_management_flow(client, username, password)

def test_29_character_username_9_character_password(client):
    username = random_username_generator(29)
    password = random_password_generator(9)
    generate_complete_note_management_flow(client, username, password)

def test_29_character_username_99_character_password(client):
    username = random_username_generator(29)
    password = random_password_generator(99)
    generate_complete_note_management_flow(client, username, password)

def test_29_character_username_100_character_password(client):
    username = random_username_generator(29)
    password = random_password_generator(100)
    generate_complete_note_management_flow(client, username, password)

def test_29_character_username_101_character_password(client):
    username = random_username_generator(29)
    password = random_password_generator(101)
    generate_complete_note_management_flow(client, username, password)

def test_30_character_username_7_character_password(client):
    username = random_username_generator(30)
    password = random_password_generator(7)
    generate_complete_note_management_flow(client, username, password)

def test_30_character_username_8_character_password(client):
    username = random_username_generator(30)
    password = random_password_generator(8)
    generate_complete_note_management_flow(client, username, password)

def test_30_character_username_9_character_password(client):
    username = random_username_generator(30)
    password = random_password_generator(9)
    generate_complete_note_management_flow(client, username, password)

def test_30_character_username_99_character_password(client):
    username = random_username_generator(30)
    password = random_password_generator(99)
    generate_complete_note_management_flow(client, username, password)

def test_30_character_username_100_character_password(client):
    username = random_username_generator(30)
    password = random_password_generator(100)
    generate_complete_note_management_flow(client, username, password)

def test_30_character_username_101_character_password(client):
    username = random_username_generator(30)
    password = random_password_generator(101)
    generate_complete_note_management_flow(client, username, password)

def test_31_character_username_7_character_password(client):
    username = random_username_generator(31)
    password = random_password_generator(7)
    generate_complete_note_management_flow(client, username, password)

def test_31_character_username_8_character_password(client):
    username = random_username_generator(31)
    password = random_password_generator(8)
    generate_complete_note_management_flow(client, username, password)

def test_31_character_username_9_character_password(client):
    username = random_username_generator(31)
    password = random_password_generator(9)
    generate_complete_note_management_flow(client, username, password)

def test_31_character_username_99_character_password(client):
    username = random_username_generator(31)
    password = random_password_generator(99)
    generate_complete_note_management_flow(client, username, password)

def test_31_character_username_100_character_password(client):
    username = random_username_generator(31)
    password = random_password_generator(100)
    generate_complete_note_management_flow(client, username, password)

def test_31_character_username_101_character_password(client):
    username = random_username_generator(31)
    password = random_password_generator(101)
    generate_complete_note_management_flow(client, username, password)
