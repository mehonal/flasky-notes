"""Local dev server: applies committed migrations, then serves with debug."""
import subprocess

from wsgi import app


subprocess.run(["flask", "--app", "wsgi", "db", "upgrade"], check=True)
app.run(host="127.0.0.1", port=5000, debug=True)
