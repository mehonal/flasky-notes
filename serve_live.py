from waitress import serve
import app
serve(app.app, host='HOST.PUBLIC.IP.HERE', port=1234)