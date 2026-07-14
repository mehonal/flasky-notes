from wsgi import app
from flasky import db

with app.app_context():
    db.create_all()
app.run(host="127.0.0.1", port=5000, debug=True)