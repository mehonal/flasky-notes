Status: Good to go for personal use

# About

Basic noting app built with a Flask backend.

# Philosophy

The noting app aims to provide simple, fast and bloat-free noting with clean interface options.

# Themes

## Paper

![Paper Theme - Note Single](https://raw.githubusercontent.com/mehonal/flasky-notes/master/static/images/themes/paper/note_single.png)

The Paper theme has options provided via GUI and does not rely on keyboard shortcuts. It's used to be the default theme and aims to be easy to use for the average user.

### Theme-Specific Features

- Fully Responsive & Optimized for all devices
- Easy to Use
- Notes can have categories

## Full

![Full Theme - Note Single](https://raw.githubusercontent.com/mehonal/flasky-notes/master/static/images/themes/full/note_single.png)

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


## Cozy

![Cozy Theme - Note Single](https://raw.githubusercontent.com/mehonal/flasky-notes/master/static/images/themes/cozy/note_single.png)

The Cozy theme is the latest, modern looking theme that is similar to Dash, but comes with a sidebar that minimizes into a smaller version rather than collapsing entirely. The theme currently lacks Markdown support and shortcuts other than for saving notes.

### Theme-Specific Features

- Flagship Theme
- Modern Look
- Sidebar Navigation
- Full Markdown Support (with toggle markdown option)
- Search Notes Modal
- Just about everything on one page

### Shortcuts
- Ctrl + s: Save Note
- Ctrl + k: Toggle Search Notes Modal

## Sage

![Sage Theme - Note Single](https://raw.githubusercontent.com/mehonal/flasky-notes/master/static/images/themes/sage/note_single.png)

The Sage theme is a markdown-focused simple, single-page theme that renders existing notes to HTML right under the current note for your ease.

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

Currently all the Python code is packed in `app.py`.

First you must ensure you have the required modules installed through pip. You can do this by running:

`pip install -r requirements.txt`

### Run Web App

Once you've installed the requirements, you can serve the app.

You may use gunicorn with a command such as `gunicorn --bind YOUR.SERVER.IP.ADDR app:app`. Alternatively, you can serve it using `serve_local.py` to serve it on localhost for debugging or personal use locally.

# Future Goals

## General

- Add Support for Encryption
- Security hardening
- Add Note Sharing with public links
- Automatic note saving (optional setting)
- Add Word Count
- Ability to add images

## Theme-Specific

### Paper Theme

- Add Dark Mode Support
- Add Font Selector
- Add To Do's

### Full Theme

- Improving Markdown Support

### Dash Theme

- Improving Markdown Support
- Add Support for Categories

# Noted Issues

- There may be issues in relation to categories - or category reassignment in general.

# Compatibility

Flasky Notes has been tested primarily on Ubuntu using a Firefox browser, but should be compatible with all devices and operating systems that can run a browser that is up-to-date. 

# License

Flasky Notes is an open source project from Mehonal, licensed under [MIT](https://opensource.org/licenses/MIT) license. Mehonal reserves the right to change the license of future releases of Flasky Notes.
