Status: Good to go for personal use

# About

Basic noting app built with a Flask backend.

# Philosophy

The noting app aims to provide simple, fast and bloat-free noting with clean interface options.

# Themes

## Paper

![Paper Theme - Note Single](https://raw.githubusercontent.com/mehonal/flasky-notes/main/static/images/themes/paper/note_single.png)

The Paper theme has options provided via GUI and does not rely on keyboard shortcuts. It's the default theme and aims to be easy to use for the average user.

### Theme-Specific Features

- Fully Responsive & Optimized for all devices
- Easy to Use
- Notes can have categories

## Full

![Full Theme - Note Single](https://raw.githubusercontent.com/mehonal/flasky-notes/main/static/images/themes/full/note_single.png)

The Full theme features a fullscreen keyboard-shortcut intensive approach to noting. It's aimed to provide a swift and content-focused experience.

### Theme-Specific Features

- Fullscreen Noting Experience
- Keyboard Shortcuts
- Clean, Bloat-Free Interface

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

#### Notes

- Ctrl + ArrowUp: Increase Height of Note
- Ctrl + ArrowDown: Decrease Height of Note
- Ctrl + ArrowRight: Increase Notes per Row
- Ctrl + ArrowLeft: Decrease Notes per Row
- Ctrl + e: Add New Note

## Dash

![Dash Theme - Note Single](https://raw.githubusercontent.com/mehonal/flasky-notes/main/static/images/themes/dash/note_single.png)

Dash aims to combine the "best of two themes" by preserving keyboard-shortcuts available in Full and having the option to navigate around with a GUI, similar to Paper. Dash takes a single-page approach, allowing to add/edit notes and view the list of existing notes from the same page.

### Theme-Specific Features

- Controls via Keyboard Shortcuts + GUI
- Everything on one page

### Keyboard Shortcuts

#### Note Single / Notes

- Ctrl + ArrowUp: Increase Font Size
- Ctrl + ArrowDown: Decrease Font Size
- Ctrl + s: Save Note
- Ctrl + d: Delete Note
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

## General

- Add Support for Encryption
- Security hardening
- Add Note Sharing with public links
- Automatic note saving (optional setting)
- Add Word Count

## Theme-Specific

### Paper Theme

- Add Dark Mode Support
- Add Font Selector
- Add Support for Multiple Categories
- Add To Do's

### Full Theme

- Improving Markdown Support
- Add Support for Categories
- Improve Navigation

### Dash Theme

- Improving Markdown Support
- Add Support for Categories

# Compatibility

Flasky Notes has been tested primarily on Ubuntu using a Firefox browser, but should be compatible with all devices and operating systems that can run a browser that is up-to-date. 

# License

Flasky Notes is an open source project from Mehonal, licensed under [MIT](https://opensource.org/licenses/MIT) license. Mehonal reserves the right to change the license of future releases of Flasky Notes.