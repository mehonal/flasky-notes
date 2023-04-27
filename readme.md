Status: Good to go for personal use

# About

Basic noting app built with a Flask backend.

# Philosophy

The noting app aims to provide simple, fast and bloat-free noting with clean interface options.

# Themes

## Paper

The Paper theme has options provided via GUI and does not rely on keyboard shortcuts. It's the default theme and aims to be easy to use for the average user.

## Full

The Full theme features a fullscreen keyboard-shortcut intensive approach to noting. It's aimed to provide a swift and content-focused experience.

### Keyboard Shortcuts

#### Note Single

- Ctrl + ArrowUp: Increase Font Size
- Ctrl + ArrowDown: Decrease Font Size
- Ctrl + s: Save Note
- Ctrl + l: Toggle Title
- Ctrl + e: Navigate to Notes
- Ctrl + y: Navigate to Settings
- Ctrl + ,: Toggle Markdown
- Ctrl + Space: Toggle Dark Mode

#### Notes

- Ctrl + ArrowUp: Increase Height of Note
- Ctrl + ArrowDown: Decrease Height of Note
- Ctrl + ArrowRight: Increase Notes per Row
- Ctrl + ArrowLeft: Decrease Notes per Row
- Ctrl + e: Add New Note

## Dash

Dash aims to combine the "best of two themes" by preserving keyboard-shortcuts available in Full and having the option to navigate around with a GUI, similar to Paper. Dash takes a single-page approach, allowing to add/edit notes and view the list of existing notes from the same page.

### Keyboard Shortcuts

#### Note Single / Notes

- Ctrl + ArrowUp: Increase Font Size
- Ctrl + ArrowDown: Decrease Font Size
- Ctrl + s: Save Note
- Ctrl + l: Toggle Title
- Ctrl + e: Add New Note
- Ctrl + y: Navigate to Settings
- Ctrl + ,: Toggle Markdown
- Ctrl + Space: Toggle Dark Mode

# How to deploy

Currently all the Python code is packed in `app.py`.

First you must ensure you have the required modules installed through pip. You can do this by running:

`pip install -r requirements.txt`

Once you've installed the requirements, you can serve the app.

The `serve_live.py` file uses waitress to serve the web app. Alternatively, you can serve it using `serve_local.py` to serve it on localhost.

# Future Goals

- Add Support for Encryption
- Add Note Sharing with public links

# License

Flasky Notes is an open source project from Mehonal, licensed under [MIT](https://opensource.org/licenses/MIT) license. Mehonal reserves the right to change the license of future releases of Flasky Notes.