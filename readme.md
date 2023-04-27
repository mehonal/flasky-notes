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

## Dash

Dash aims to combine the "best of two themes" by preserving keyboard-shortcuts available in Full and having the option to navigate around with a GUI, similar to Paper. Dash takes a single-page approach, allowing to add/edit notes and view the list of existing notes from the same page.

# How to deploy

Currently all the Python code is packed in app.py.

The `serve_live.py` file uses waitress to serve the web app. Alternatively, you can serve it using `serve_local.py` to serve it on localhost

# Future Goals

- Add Support for Encryption
- Add Note Sharing with public links
- Improve Design

# License

The code is licensed under MIT license.