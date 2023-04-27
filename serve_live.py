from waitress import serve
import app
with app.app.app_context():
    app.db.create_all()
serve(app.app, host='HOST.PUBLIC.IP.HERE', port=1234)