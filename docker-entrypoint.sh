#!/bin/sh
set -e

export FLASK_APP=wsgi.py

PORT="${PORT:-5000}"

flask db upgrade

exec gunicorn \
  --bind "0.0.0.0:${PORT}" \
  --workers "${GUNICORN_WORKERS:-2}" \
  --threads "${GUNICORN_THREADS:-4}" \
  --worker-class gthread \
  --timeout 0 \
  --graceful-timeout 30 \
  --access-logfile - \
  --error-logfile - \
  wsgi:app
