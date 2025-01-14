"""
Functional Integration Tests: Notes API
Testing the Notes API endpoints
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from app import app, db, User, Theme, UserNote, UserNoteCategory

def test_notes_api_integration(auth_client):
    """
    Integration Test: Notes API Flow
    """
    # Add note
    response = auth_client.post('/api/save_note', 
                              json={
                                  'noteId': 0,
                                  'title': 'API Test Note',
                                  'content': 'API Test Content',
                                  'category': None
                              },
                              content_type='application/json')
    assert response.status_code == 200
    
    # Get all notes
    notes_response = auth_client.get('/api/get_all_notes')
    assert notes_response.status_code == 200
    assert len(notes_response.json) > 0
