"""
Functional Unit Tests: User Module
Testing the User module through its interface specification
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from app import app, db, User, Theme, UserNote, UserNoteCategory

def test_user_creation_interface():
    """
    Unit Test: User Creation Interface
    Tests user creation through public interface
    """
    user = User("testuser", "testpass", "test@test.com")
    assert user.username == "testuser"
    assert user.email == "test@test.com"

def test_user_settings_interface():
    """
    Unit Test: User Settings Interface
    Tests user settings through public interface
    """
    user = User("testuser", "testpass", "test@test.com")
    settings = user.return_settings()
    assert settings.theme_preference == "paper"  # default theme
