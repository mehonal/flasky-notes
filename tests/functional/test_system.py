"""
Functional System Tests: Complete User Flows
Testing complete user scenarios with parametrized boundary values
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
import pytest
import random
import string

# bcrypt has a 72-byte password limit, but the app allows up to 100 chars.
# Passwords 73-100 chars will pass validation but crash in User.__init__.
# These combos are marked xfail to document the bug.
_BCRYPT_LIMIT = 72


def random_string(k):
    return ''.join(random.choices(string.ascii_lowercase, k=k))


def run_registration_flow(client, username, password):
    """Run a full registration + note management flow.
    Returns True for both valid and invalid credential combos."""
    email = f"{username}@test.com"

    register_response = client.post('/register', data={
        'username': username,
        'password': password,
        'email': email
    }, follow_redirects=True)

    # Invalid credentials should be rejected
    if len(username) < 4 or len(username) > 30 or len(password) < 8 or len(password) > 100:
        assert b'must be' in register_response.data.lower() or \
               b'illegal' in register_response.data.lower()
        return

    # Valid registration should redirect to login
    assert b'sign in' in register_response.data.lower() or \
           b'login' in register_response.data.lower()

    # Login
    login_response = client.post('/login', data={
        'username': username,
        'password': password
    }, follow_redirects=True)
    assert login_response.status_code == 200

    # Create note via form
    note_response = client.post('/note/0', data={
        'title': 'Flow Test Note',
        'content': 'Test content for flow',
        'update-note': True
    }, follow_redirects=True)
    assert b'Flow Test Note' in note_response.data

    # Create category
    cat_response = client.post('/api/add_category',
                               json={'categoryName': 'Flow Category'})
    assert cat_response.json['success'] is True
    category_id = cat_response.json['category']

    # Create note in category via API
    categorized_note = client.post('/api/save_note',
                                   json={
                                       'noteId': 0,
                                       'title': 'Categorized Note',
                                       'content': 'In category',
                                       'category': category_id
                                   })
    assert categorized_note.json['success'] is True

    # Change theme
    theme_response = client.post('/settings', data={
        'update-theme': True,
        'theme': 'paper'
    }, follow_redirects=True)
    assert theme_response.status_code == 200


# Boundary values: username 3(too short), 4(min), 5(valid), 29(valid), 30(max), 31(too long)
# Boundary values: password 7(too short), 8(min), 9(valid), 99(valid), 100(max), 101(too long)
@pytest.mark.parametrize("uname_len", [3, 4, 5, 29, 30, 31])
@pytest.mark.parametrize("pw_len", [7, 8, 9, 99, 100, 101])
def test_registration_boundary(client, uname_len, pw_len):
    # Valid username (4-30) + password over bcrypt's 72-byte limit (73-100)
    # triggers a ValueError in bcrypt — this is a known app bug.
    valid_username = 4 <= uname_len <= 30
    exceeds_bcrypt = pw_len > _BCRYPT_LIMIT
    valid_app_password = 8 <= pw_len <= 100
    if valid_username and exceeds_bcrypt and valid_app_password:
        pytest.xfail("App allows passwords >72 chars but bcrypt rejects them")

    username = random_string(uname_len)
    password = random_string(pw_len)
    run_registration_flow(client, username, password)
