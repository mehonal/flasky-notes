"""Auth service — user registration and password/recovery operations.

Owns the User + UserSettings row creation that the old User.__init__ did
implicitly. Routes call these functions; the User model itself has no
mutating methods.
"""
import os
import bcrypt

from flasky import db
from flasky.models import User, UserSettings, UserNoteCategory


def create_user(username, auth_key, email):
    """Create a new user row with a bcrypt-hashed auth_key and an empty
    UserSettings row. Returns the User (committed). Raises ValueError if the
    username or email is already taken.
    """
    if User.query.filter_by(username=username).first():
        raise ValueError("Username already taken.")
    if User.query.filter_by(email=email).first():
        raise ValueError("Email already in use.")

    hashed_pw = bcrypt.hashpw(auth_key.encode("utf-8"), bcrypt.gensalt())
    user = User(username=username, password=hashed_pw, email=email)
    db.session.add(user)
    db.session.commit()

    settings = UserSettings(id=user.id)
    db.session.add(settings)
    db.session.commit()

    user.settings = settings
    db.session.commit()
    return user


def register_e2ee_user(username, email, auth_key, encrypted_sym_key,
                       recovery_encrypted_key, recovery_key_hash, key_salt,
                       password_hint, encrypted_main_category):
    """Full E2EE registration: create the user, set key material, create the
    default (encrypted) category. Returns the User. Raises ValueError on
    validation failures.
    """
    user = create_user(username, auth_key, email)
    user.encrypted_symmetric_key = encrypted_sym_key
    user.recovery_encrypted_key = recovery_encrypted_key
    user.recovery_key_hash = recovery_key_hash
    user.encryption_version = 1
    user.key_salt = key_salt or os.urandom(32).hex()
    user.password_hint = password_hint or ""
    db.session.commit()

    if not encrypted_main_category:
        raise ValueError("Missing encrypted category name.")
    default_cat = UserNoteCategory(user_id=user.id, name=encrypted_main_category)
    db.session.add(default_cat)
    db.session.commit()
    return user


def change_password(user, new_auth_key, new_encrypted_sym_key,
                    new_recovery_encrypted_key=None, new_recovery_key_hash=None,
                    new_key_salt=None):
    user.password = bcrypt.hashpw(new_auth_key.encode("utf-8"), bcrypt.gensalt())
    user.encrypted_symmetric_key = new_encrypted_sym_key
    if new_recovery_encrypted_key:
        user.recovery_encrypted_key = new_recovery_encrypted_key
    if new_recovery_key_hash:
        user.recovery_key_hash = new_recovery_key_hash
    if new_key_salt:
        user.key_salt = new_key_salt
    db.session.commit()


def update_recovery_key(user, recovery_encrypted_key, recovery_key_hash=None):
    user.recovery_encrypted_key = recovery_encrypted_key
    if recovery_key_hash:
        user.recovery_key_hash = recovery_key_hash
    db.session.commit()


def recover_account(username, new_auth_key, new_encrypted_sym_key,
                    recovery_key_hash, new_recovery_encrypted_key=None,
                    new_recovery_key_hash=None, new_key_salt=None):
    """Verify possession of recovery key (via hash) and reset auth + key material."""
    import secrets

    user = User.query.filter_by(username=username).first()
    if not user:
        return None
    expected = user.recovery_key_hash or ("0" * 64)
    if not secrets.compare_digest(expected, recovery_key_hash) or not user.recovery_key_hash:
        return None
    user.password = bcrypt.hashpw(new_auth_key.encode("utf-8"), bcrypt.gensalt())
    user.encrypted_symmetric_key = new_encrypted_sym_key
    if new_recovery_encrypted_key:
        user.recovery_encrypted_key = new_recovery_encrypted_key
    if new_recovery_key_hash:
        user.recovery_key_hash = new_recovery_key_hash
    if new_key_salt:
        user.key_salt = new_key_salt
    db.session.commit()
    return user