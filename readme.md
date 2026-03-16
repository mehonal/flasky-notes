Status: Good to go for personal use

# About

Basic noting app built with a Flask backend.

# Philosophy

The noting app aims to provide simple, fast and bloat-free noting with clean interface options.

# Themes

Flasky Notes ships with 9 themes. Each offers a different layout and feature set. Users pick their theme in `/settings`, where a full comparison table is also available.

| Theme | Style | Dark mode | Markdown | Wiki-links | Search | Font | Properties | Auto-save | Sidebar | Drag-drop | Todos | Events | Notes page | Categories page | Outline | Backlinks |
|-------|-------|-----------|----------|------------|--------|------|------------|-----------|---------|-----------|-------|--------|------------|-----------------|---------|-----------|
| Obsidified | File explorer | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | - | - | Yes | Yes |
| Cozy | Modern sidebar | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | - | - | - | - | - | - |
| Sage | Card feed | Yes | Yes | Yes | Yes | Yes | Yes | Yes | - | Yes | - | - | - | - | - | - |
| Segment | Three-panel | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | - | - | - | - | - | - | - |
| Tahta | Kanban board | Yes | Yes | Yes | Yes | Yes | Yes | - | - | Yes | - | - | - | - | - | - |
| Paper | Traditional | Yes | Yes | Yes | Yes | Yes | - | - | - | - | - | - | Yes | Yes | - | - |
| Full | Extra Fullscreen | Yes | Yes | Yes | Yes | Yes | - | - | - | - | - | - | Yes | Yes | - | - |
| Dash | Minimal toolbar | Yes | Yes | Yes | Yes | Yes | - | - | Yes | - | - | - | - | - | - | - |
| CLI | Terminal | Yes | - | - | - | - | - | - | - | - | Yes | Yes | - | - | - | - |

All themes except CLI render markdown client-side with `[[wiki-link]]` and `![[embed]]` support. All themes support dark mode.

## Obsidified

The most feature-rich theme. Obsidian-style file explorer sidebar with a customizable right panel featuring outline, backlinks, properties, todos, and events widgets. Supports drag-drop note organization, auto-save, and inline frontmatter editing.

## Cozy

![Cozy Theme - Note Single](https://raw.githubusercontent.com/mehonal/flasky-notes/master/static/images/themes/cozy/note_single.png)

Modern sidebar theme with folder tree navigation and note cards. Features drag-drop note moving between folders, auto-save, and a search modal.

### Shortcuts
- Ctrl + s: Save Note
- Ctrl + k: Search Notes

## Sage

![Sage Theme - Note Single](https://raw.githubusercontent.com/mehonal/flasky-notes/master/static/images/themes/sage/note_single.png)

A card feed theme with a top navigation bar. Editor at the top, existing notes rendered as cards below. Features auto-save, category filtering, and drag-drop.

## Segment

A three-panel layout inspired by Discord: category rail on the left, notes list in the middle, editor on the right. Features auto-save, markdown preview toggle, and a search modal.

## Tahta

A kanban board theme for organizing notes visually across columns. Supports drag-drop and markdown rendering.

## Paper

![Paper Theme - Note Single](https://raw.githubusercontent.com/mehonal/flasky-notes/master/static/images/themes/paper/note_single.png)

The Paper theme has options provided via GUI and does not rely on keyboard shortcuts. It aims to be easy to use for the average user. Has dedicated notes and categories listing pages.

## Full

![Full Theme - Note Single](https://raw.githubusercontent.com/mehonal/flasky-notes/master/static/images/themes/full/note_single.png)

The Full theme features a fullscreen keyboard-shortcut intensive approach to noting. It's aimed to provide a swift and content-focused experience. Has dedicated notes and categories listing pages.

### Keyboard Shortcuts

#### Note Single

- Ctrl + ArrowUp: Increase Font Size
- Ctrl + ArrowDown: Decrease Font Size
- Ctrl + m: Toggle Menu
- Ctrl + s: Save Note
- Ctrl + d: Delete Note
- Ctrl + l: Toggle Title
- Ctrl + e: Navigate to Notes
- Ctrl + y: Navigate to Settings
- Ctrl + ,: Toggle Markdown
- Ctrl + Space: Toggle Dark Mode
- Ctrl + Enter: Add New Note
- Ctrl + Delete: Revert Note to Last Version

#### Notes

- Ctrl + ArrowUp: Increase Height of Note
- Ctrl + ArrowDown: Decrease Height of Note
- Ctrl + ArrowRight: Increase Notes per Row
- Ctrl + ArrowLeft: Decrease Notes per Row
- Ctrl + e: Add New Note

## Dash

![Dash Theme - Note Single](https://raw.githubusercontent.com/mehonal/flasky-notes/master/static/images/themes/dash/note_single.png)

Dash combines keyboard shortcuts with a minimal toolbar GUI. Everything lives on one page with a collapsible notes sidebar.

### Keyboard Shortcuts

- Ctrl + ArrowUp: Increase Font Size
- Ctrl + ArrowDown: Decrease Font Size
- Ctrl + s: Save Note
- Ctrl + d: Delete Note
- Ctrl + l: Toggle Title
- Ctrl + e: Add New Note
- Ctrl + y: Navigate to Settings
- Ctrl + ,: Toggle Markdown
- Ctrl + Space: Toggle Dark Mode

## CLI

A terminal-style interface for command-line note management. Supports todos and events via built-in commands. Type `help` for available commands.

# Obsidian Sync

**Beta — not tested thoroughly.** Flasky Notes supports two-way syncing with an Obsidian vault via [flasky-notes-sync](https://github.com/mehonal/flasky-notes-sync), a standalone sync client that runs on the machine with your Obsidian vault. Enable sync in `/settings`, generate an API token, and follow the setup instructions in the sync repo. Folders map to categories, attachments sync alongside notes, and conflicts are flagged for web-based resolution.

# How to deploy

There are two ways you can deploy Flasky Notes:

## Option 1: Deploy with Docker

In order to deploy with Docker, you can follow the following steps:

1. Install Docker if you do not have it installed already
2. Attain a copy of the repo
3. Copy the contents of the `.env.example` file and save it to a file named `.env` in the root directory of the web app, alongside the rest of the files.
4. Open a terminal at the root directory with the files, and run: `docker compose up --build`.

And just like that - you should have Flasky Notes running. You may use Ctrl+C to stop running the web app. In order to run it again, you may use `docker compose up` command again.

### Running in detached mode

If you prefer to run it in detached mode (in the background), you may add `-d` to the command as such: `docker compose up -d --build`. Ensure you are in the root directory when running this command.

### Stopping Docker instance running in the background

To stop a running instance of Flasky Notes, you can use the `docker compose stop` command while in the root directory.

### Removing Docker instance

To remove the Docker instance of Flasky Notes, you may use the `docker compose down` command while in the root directory.

## Option 2: Deploy manually

### Setting up virtual environment (recommended)

It is best practice to set a virtual environment before running any dependencies. While not necessary, it is highly recommended that you first make a virtual environment, and use it when dealing with the web app.

In order to establish this, you may use the command `python3 -m venv venv` if you are using Linux, or `python -m venv C:\path\to\project\venv` if you are using Windows. This will make a new virtual environment.

In order to enter it, you can use `source venv/bin/activate` in Linux or `C:\path\to\project\venv\Scripts\activate.bat` on Windows.

When installing pip modules or running the web app, or running related scripts, or performing migrations, you should ensure that you are in the virtual environment.

If you want to exit the virtual environment, you can use the `deactivate` command on Linux, or `C:\path\to\project\venv\Scripts\deactivate.bat` on Windows.

### Installing pip modules

First you must ensure you have the required modules installed through pip. You can do this by running:

`pip install -r requirements.txt`

### Run Web App

Once you've installed the requirements, you can serve the app.

You may use gunicorn with a command such as `gunicorn --bind YOUR.SERVER.IP.ADDR app:app`. Alternatively, you can serve it using `serve_local.py` to serve it on localhost for debugging or personal use locally.

# Compatibility

Flasky Notes has been tested primarily on Ubuntu using a Firefox browser, but should be compatible with all devices and operating systems that can run a browser that is up-to-date.

# License

Flasky Notes is an open source project from Mehonal, licensed under [MIT](https://opensource.org/licenses/MIT) license. Mehonal reserves the right to change the license of future releases of Flasky Notes.
