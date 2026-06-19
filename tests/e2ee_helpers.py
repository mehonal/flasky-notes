"""Test helpers for E2EE registration fixtures.

Self-contained — does NOT import from sync_client (which is a separate repo).
The crypto primitives here mirror static/js/crypto.js and must produce
identical output. Keep them in sync with sync_client/flasky_crypto.py and
static/js/crypto.js.
"""
import os
import base64
import hashlib

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


PBKDF2_ITERATIONS = 600_000
VERSION_BYTE = 0x01


def derive_keys(password: str, username: str):
    """Derive (auth_key_hex, kek_bytes) from password + username.
    Mirrors FlaskyCrypto.deriveKeys in static/js/crypto.js.
    """
    salt = username.lower().encode("utf-8")
    password_bytes = password.encode("utf-8")

    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(), length=32, salt=salt, iterations=PBKDF2_ITERATIONS,
    )
    master_key = kdf.derive(password_bytes)

    hkdf_auth = HKDF(
        algorithm=hashes.SHA256(), length=32, salt=b"", info=b"flasky-auth",
    )
    auth_key = hkdf_auth.derive(master_key)

    hkdf_enc = HKDF(
        algorithm=hashes.SHA256(), length=32, salt=b"", info=b"flasky-encryption",
    )
    kek = hkdf_enc.derive(master_key)

    return auth_key.hex(), kek


def generate_symmetric_key() -> bytes:
    return os.urandom(32)


def wrap_symmetric_key(sym_key: bytes, kek: bytes) -> str:
    iv = os.urandom(12)
    ct = AESGCM(kek).encrypt(iv, sym_key, None)
    return base64.b64encode(iv + ct).decode("ascii")


def unwrap_symmetric_key(wrapped_b64: str, kek: bytes) -> bytes:
    combined = base64.b64decode(wrapped_b64)
    iv, ct = combined[:12], combined[12:]
    return AESGCM(kek).decrypt(iv, ct, None)


def encrypt(plaintext: str, sym_key: bytes) -> str:
    if plaintext is None:
        return None
    iv = os.urandom(12)
    ct = AESGCM(sym_key).encrypt(iv, plaintext.encode("utf-8"), None)
    return base64.b64encode(bytes([VERSION_BYTE]) + iv + ct).decode("ascii")


def decrypt(ciphertext_b64: str, sym_key: bytes) -> str:
    if not ciphertext_b64:
        return ciphertext_b64
    data = base64.b64decode(ciphertext_b64)
    if data[0] != VERSION_BYTE:
        raise ValueError(f"Unsupported encryption version: {data[0]}")
    iv, ct = data[1:13], data[13:]
    return AESGCM(sym_key).decrypt(iv, ct, None).decode("utf-8")


def generate_recovery_key() -> dict:
    key_bytes = os.urandom(32)
    b64 = base64.b64encode(key_bytes).decode("ascii")
    groups = [b64[i:i + 5] for i in range(0, len(b64), 5)]
    return {
        "key_bytes": key_bytes,
        "display_string": "-".join(groups),
        "crypto_key": key_bytes,
    }


def recovery_key_hash(key_bytes: bytes) -> str:
    return hashlib.sha256(key_bytes).hexdigest()


def register_e2ee_user(client, username, password, email=None, hint=""):
    """Register an E2EE user via the real /api/auth/register endpoint."""
    if email is None:
        email = f"{username}@test.com"
    salt_hex = os.urandom(32).hex()
    auth_key_hex, kek = derive_keys(password, username)
    sym_key = generate_symmetric_key()
    wrapped_sym = wrap_symmetric_key(sym_key, kek)
    recovery = generate_recovery_key()
    wrapped_recovery = wrap_symmetric_key(sym_key, recovery["crypto_key"])
    rhash = recovery_key_hash(recovery["key_bytes"])
    encrypted_main = encrypt("Main", sym_key)

    resp = client.post(
        "/api/auth/register",
        json={
            "username": username,
            "email": email,
            "auth_key": auth_key_hex,
            "encrypted_sym_key": wrapped_sym,
            "recovery_encrypted_key": wrapped_recovery,
            "recovery_key_hash": rhash,
            "key_salt": salt_hex,
            "password_hint": hint,
            "encrypted_main_category": encrypted_main,
        },
    )
    if resp.status_code != 200 or not resp.get_json().get("success"):
        raise RuntimeError(
            f"Registration failed for {username}: {resp.status_code} {resp.get_json()}"
        )
    return {
        "username": username,
        "password": password,
        "email": email,
        "auth_key": auth_key_hex,
        "kek": kek,
        "sym_key": sym_key,
        "wrapped_sym": wrapped_sym,
        "recovery": recovery,
        "salt_hex": salt_hex,
    }


def login_e2ee_user(client, creds):
    resp = client.post(
        "/api/auth/login",
        json={"username": creds["username"], "auth_key": creds["auth_key"]},
    )
    if resp.status_code != 200 or not resp.get_json().get("success"):
        raise RuntimeError(
            f"Login failed for {creds['username']}: {resp.status_code} {resp.get_json()}"
        )
    creds["server_wrapped_sym"] = resp.get_json().get("encrypted_sym_key")
    return creds


def make_e2ee_user(client, username, password="testpassword123", email=None):
    creds = register_e2ee_user(client, username, password, email=email)
    login_e2ee_user(client, creds)
    return creds


def enc(creds, plaintext):
    return encrypt(plaintext, creds["sym_key"])


def dec(creds, ciphertext):
    return decrypt(ciphertext, creds["sym_key"])