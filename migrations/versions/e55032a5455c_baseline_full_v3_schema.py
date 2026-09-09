"""baseline: full v3 schema

Revision ID: e55032a5455c
Revises: 
Create Date: 2026-09-09 23:50:48.999818

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e55032a5455c'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('user_settings',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('timezone', sa.String(length=100), nullable=True),
    sa.Column('obsidian_sync_enabled', sa.Boolean(), nullable=True),
    sa.Column('ai_enabled', sa.Boolean(), nullable=True),
    sa.Column('ollama_api_key', sa.String(length=500), nullable=True),
    sa.Column('ollama_model', sa.String(length=200), nullable=True),
    sa.Column('ollama_base_url', sa.String(length=500), nullable=True),
    sa.Column('ui_settings', sa.Text(), nullable=True),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_user_settings'))
    )
    op.create_table('user',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('settingsid', sa.Integer(), nullable=True),
    sa.Column('username', sa.String(length=30), nullable=True),
    sa.Column('password', sa.String(length=280), nullable=True),
    sa.Column('email', sa.String(length=300), nullable=True),
    sa.Column('plan', sa.Integer(), nullable=True),
    sa.Column('user_type', sa.Integer(), nullable=True),
    sa.Column('encrypted_symmetric_key', sa.Text(), nullable=True),
    sa.Column('recovery_encrypted_key', sa.Text(), nullable=True),
    sa.Column('recovery_key_hash', sa.String(length=64), nullable=True),
    sa.Column('encryption_version', sa.Integer(), nullable=True),
    sa.Column('key_salt', sa.String(length=64), nullable=True),
    sa.Column('password_hint', sa.Text(), nullable=True),
    sa.ForeignKeyConstraint(['settingsid'], ['user_settings.id'], name=op.f('fk_user_settingsid_user_settings')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_user')),
    sa.UniqueConstraint('email', name=op.f('uq_user_email')),
    sa.UniqueConstraint('settingsid', name=op.f('uq_user_settingsid')),
    sa.UniqueConstraint('username', name=op.f('uq_user_username'))
    )
    op.create_table('ai_conversation',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=500), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=True),
    sa.Column('vault_context_enabled', sa.Boolean(), nullable=True),
    sa.Column('web_search_enabled', sa.Boolean(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], name=op.f('fk_ai_conversation_user_id_user')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_ai_conversation'))
    )
    op.create_table('api_token',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('last_used_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], name=op.f('fk_api_token_user_id_user')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_api_token')),
    sa.UniqueConstraint('token_hash', name=op.f('uq_api_token_token_hash'))
    )
    op.create_table('attachment',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('filename', sa.Text(), nullable=False),
    sa.Column('content_type', sa.String(length=200), nullable=True),
    sa.Column('file_hash', sa.String(length=64), nullable=False),
    sa.Column('file_size', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], name=op.f('fk_attachment_user_id_user')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_attachment'))
    )
    op.create_table('note_template',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('name', sa.Text(), nullable=False),
    sa.Column('content', sa.Text(), nullable=True),
    sa.Column('properties', sa.Text(), nullable=True),
    sa.Column('icon', sa.String(length=100), nullable=True),
    sa.Column('icon_color', sa.String(length=20), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], name=op.f('fk_note_template_user_id_user')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_note_template'))
    )
    op.create_table('sync_conflict',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('note_id', sa.Integer(), nullable=True),
    sa.Column('local_title', sa.Text(), nullable=True),
    sa.Column('local_content', sa.Text(), nullable=True),
    sa.Column('server_title', sa.Text(), nullable=True),
    sa.Column('server_content', sa.Text(), nullable=True),
    sa.Column('category', sa.Text(), nullable=True),
    sa.Column('conflict_date', sa.DateTime(), nullable=True),
    sa.Column('resolved', sa.Boolean(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], name=op.f('fk_sync_conflict_user_id_user')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_sync_conflict'))
    )
    op.create_table('user_agenda_notes',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('content', sa.Text(), nullable=True),
    sa.Column('userid', sa.Integer(), nullable=True),
    sa.Column('date_last_changed', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['userid'], ['user.id'], name=op.f('fk_user_agenda_notes_userid_user')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_user_agenda_notes'))
    )
    op.create_table('user_event',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('userid', sa.Integer(), nullable=True),
    sa.Column('title', sa.Text(), nullable=True),
    sa.Column('content', sa.Text(), nullable=True),
    sa.Column('date_of_event', sa.DateTime(), nullable=True),
    sa.Column('date_added', sa.DateTime(), nullable=True),
    sa.Column('date_last_changed', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['userid'], ['user.id'], name=op.f('fk_user_event_userid_user')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_user_event'))
    )
    op.create_table('user_todo',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('userid', sa.Integer(), nullable=True),
    sa.Column('title', sa.Text(), nullable=True),
    sa.Column('content', sa.Text(), nullable=True),
    sa.Column('date_due', sa.DateTime(), nullable=True),
    sa.Column('date_added', sa.DateTime(), nullable=True),
    sa.Column('date_completed', sa.DateTime(), nullable=True),
    sa.Column('date_last_changed', sa.DateTime(), nullable=True),
    sa.Column('completed', sa.Boolean(), nullable=True),
    sa.Column('archived', sa.Boolean(), nullable=True),
    sa.ForeignKeyConstraint(['userid'], ['user.id'], name=op.f('fk_user_todo_userid_user')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_user_todo'))
    )
    op.create_table('ai_message',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('conversation_id', sa.Integer(), nullable=False),
    sa.Column('role', sa.String(length=20), nullable=False),
    sa.Column('content', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['conversation_id'], ['ai_conversation.id'], name=op.f('fk_ai_message_conversation_id_ai_conversation')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_ai_message'))
    )
    op.create_table('user_note_category',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=True),
    sa.Column('name', sa.String(length=500), nullable=True),
    sa.Column('icon', sa.String(length=100), nullable=True),
    sa.Column('icon_color', sa.String(length=20), nullable=True),
    sa.Column('default_note_icon', sa.String(length=100), nullable=True),
    sa.Column('default_note_icon_color', sa.String(length=20), nullable=True),
    sa.Column('default_template_id', sa.Integer(), nullable=True),
    sa.ForeignKeyConstraint(['default_template_id'], ['note_template.id'], name=op.f('fk_user_note_category_default_template_id_note_template')),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], name=op.f('fk_user_note_category_user_id_user')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_user_note_category'))
    )
    op.create_table('user_note',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('userid', sa.Integer(), nullable=True),
    sa.Column('category_id', sa.Integer(), nullable=True),
    sa.Column('title', sa.Text(), nullable=True),
    sa.Column('content', sa.Text(), nullable=True),
    sa.Column('properties', sa.Text(), nullable=True),
    sa.Column('previous_content', sa.Text(), nullable=True),
    sa.Column('date_added', sa.DateTime(), nullable=True),
    sa.Column('date_last_changed', sa.DateTime(), nullable=True),
    sa.Column('icon', sa.String(length=100), nullable=True),
    sa.Column('icon_color', sa.String(length=20), nullable=True),
    sa.ForeignKeyConstraint(['category_id'], ['user_note_category.id'], name=op.f('fk_user_note_category_id_user_note_category')),
    sa.ForeignKeyConstraint(['userid'], ['user.id'], name=op.f('fk_user_note_userid_user')),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_user_note'))
    )


def downgrade():
    op.drop_table('user_note')
    op.drop_table('user_note_category')
    op.drop_table('ai_message')
    op.drop_table('user_todo')
    op.drop_table('user_event')
    op.drop_table('user_agenda_notes')
    op.drop_table('sync_conflict')
    op.drop_table('note_template')
    op.drop_table('attachment')
    op.drop_table('api_token')
    op.drop_table('ai_conversation')
    op.drop_table('user')
    op.drop_table('user_settings')
