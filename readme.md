# About

Flasky Notes is an end-to-end-encrypted (E2EE) note-taking app built with a Flask backend, featuring Obsidian sync, todos/events, AI chat (Ollama), and a rich markdown editor with `[[wiki-link]]` support. The server never sees plaintext note content — all encryption/decryption happens client-side via Web Crypto.

# Philosophy

Simple, fast, and bloat-free noting with a clean interface. Your notes are encrypted on your device before they ever touch the server.

# Encryption

Every user is encrypted. There is no non-encrypted mode. The server is a ciphertext store with auth — it never sees plaintext note titles, content, properties, category names, todo/event content, attachment bytes, or AI chat messages.

**Key hierarchy:** password → PBKDF2 (600k iterations, SHA-256, salt=username) → master key → HKDF → `auth_key` (bcrypt-hashed server-side) + `KEK` (wraps the symmetric key). The symmetric key is AES-256-GCM. A recovery key wraps the same symmetric key as an escape hatch if the password is lost.

Ciphertext format: `base64(0x01 || IV[12] || ciphertext || GCM-tag[16])`.

# Features

- **Rich markdown editor** (CodeMirror 6) with live preview, syntax highlighting, and `[[wiki-link]]` / `![[embed]]` rendering
- **File explorer sidebar** with drag-drop note organization, folders (categories), and icons
- **Right panel** with outline, backlinks, outbound links, properties, todos, events, and quick-settings widgets (toggle visibility per user)
- **Auto-save** with one-step revert to previous version
- **Todos and events** with due dates, reminders, and archive
- **Note templates** with per-folder default templates
- **Attachments** (stored as encrypted blobs)
- **Client-side search** (server can't read ciphertext to search)
- **AI chat** (Ollama) with SSE streaming, conversation history, and note-context inclusion
- **Obsidian sync** via a standalone sync client
- **Export** to decrypted or encrypted .zip
- **Dark mode**, adjustable font size/family, responsive mobile layout
- **Dynamic UI settings** — new preferences added via a registry with no database migration

### Shortcuts
- Ctrl + s: Save Note
- Ctrl + k: Search Notes
- Ctrl + b: Toggle Sidebar
- Ctrl + e: Toggle Edit/Preview
- Ctrl + Shift + O: Toggle Right Panel
- Ctrl + /: Keyboard Shortcuts

# Obsidian Sync

Flasky Notes supports two-way syncing with an Obsidian vault via [flasky-notes-sync](https://github.com/mehonal/flasky-notes-sync), a standalone Python CLI that runs on the machine with your Obsidian vault. Encryption is mandatory — the sync client always derives keys from your password and encrypts/decrypts locally.

Enable sync in `/settings`, generate an API token, and follow the setup instructions in the sync repo. Folders map to categories, attachments sync alongside notes, and conflicts are flagged for web-based resolution.

# How to deploy

There are two ways you can deploy Flasky Notes:

## Option 1: Deploy with Docker

1. Install Docker if you do not have it installed already
2. Attain a copy of the repo
3. Copy the contents of the `.env.example` file and save it to a file named `.env` in the root directory, alongside the rest of the files
4. Open a terminal at the root directory and run: `docker compose up --build`

You should have Flasky Notes running. Use Ctrl+C to stop. Run `docker compose up` again to restart.

### Running in detached mode

Add `-d` to run in the background: `docker compose up -d --build`

### Stopping

`docker compose stop` (running instance) or `docker compose down` (remove instance)

## Option 2: Deploy manually

### Setting up virtual environment (recommended)

```bash
python3 -m venv venv
source venv/bin/activate   # Linux
# venv\Scripts\activate    # Windows
```

### Installing dependencies

```bash
pip install -r requirements.txt
```

### Run Web App

For local development:

```bash
python serve_local.py
```

For production:

```bash
gunicorn --bind YOUR.SERVER.IP.ADDR wsgi:app
```

# Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URI` | No | `sqlite:///db.sqlite3` | SQLAlchemy database URI |
| `SECRET_KEY` | **Yes** | — | Flask secret key for sessions |
| `FLASK_ENV` | No | `production` | Flask environment |
| `LOG_LEVEL` | No | `WARNING` | Logging level |
| `RECAPTCHA_SITE_KEY` | No | — | reCAPTCHA v2/v3 site key |
| `RECAPTCHA_SECRET_KEY` | No | — | reCAPTCHA v2/v3 secret key |

See `.env.example`.

# Compatibility

Flasky Notes has been tested primarily on Ubuntu using a Firefox browser, but should be compatible with all devices and operating systems that can run a browser that is up-to-date.

# License

Flasky Notes is an open source project from Mehonal, licensed under [MIT](https://opensource.org/licenses/MIT) license. Mehonal reserves the right to change the license of future releases of Flasky Notes.

Third-party library licenses can be found in [`static/vendor/LICENSES.md`](static/vendor/LICENSES.md).

# Built With

- [Python](https://www.python.org/) & [Flask](https://flask.palletsprojects.com/) — Backend framework
- [SQLite](https://www.sqlite.org/) & [SQLAlchemy](https://www.sqlalchemy.org/) — Database and ORM
- [Alembic](https://alembic.sqlalchemy.org/) — Database migrations
- [Flask-Talisman](https://github.com/GoogleCloudPlatform/flask-talisman) — Security headers (CSP)
- [bcrypt](https://github.com/pyca/bcrypt) — auth_key hashing
- [marshmallow](https://marshmallow.readthedocs.io/) & [flask-smorest](https://flask-smorest.readthedocs.io/) — Request validation + OpenAPI
- [cryptography](https://cryptography.io/) — E2EE (sync client + tests)
- [Gunicorn](https://gunicorn.org/) — Production server
- [Bootstrap](https://getbootstrap.com/) — CSS framework (auth/settings pages)
- [CodeMirror 6](https://codemirror.net/) — Text editor
- [marked.js](https://marked.js.org/) — Markdown rendering
- [highlight.js](https://highlightjs.org/) — Syntax highlighting
- [DOMPurify](https://github.com/cure53/DOMPurify) — HTML sanitization
- [Docker](https://www.docker.com/) — Containerization
- [esbuild](https://esbuild.github.io/) — JS bundling (CodeMirror)