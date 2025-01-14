"""
Structural Integration Tests: Database Layer
White-box testing of database interactions
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from app import app, db, User, Theme, UserNote, UserNoteCategory
from datetime import datetime

def test_note_category_cascading():
    """
    Structural Integration Test: Category Deletion
    Tests actual database cascade behavior when deleting categories
    """
    with app.app_context():
        # Add user
        username = f"testuser{int(datetime.now().timestamp())}"
        email = f"test{int(datetime.now().timestamp())}@test.com"
        user = User(username, "testpass", email)
        db.session.commit()
        
        # First ensure main category exists
        main_category = user.get_main_category()
        db.session.commit()
        
        # Add test category
        test_category = UserNoteCategory(user.id, "Test Category")
        db.session.commit()
        
        # Add note in test category
        note = user.add_note("Test", "Content", test_category.id)
        db.session.commit()
        
        # Delete test category
        db.session.delete(test_category)
        db.session.commit()
        
        # Refresh note from database
        db.session.refresh(note)
        
        # Verify note was reassigned to main category
        assert note is not None
        assert note.category_id == main_category.id
