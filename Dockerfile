FROM python:3.11-slim

WORKDIR /app

# Copy requirements first to leverage Docker cache
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Entrypoint applies committed migrations before gunicorn starts.
# BuildKit sets the executable bit; no local chmod needed.
COPY --chmod=755 docker-entrypoint.sh /app/docker-entrypoint.sh

# instance/ holds the SQLite db + encrypted attachments (volume-mounted)
RUN mkdir -p instance && \
    useradd -m appuser && \
    chown -R appuser:appuser /app
USER appuser

ENV PORT=5000
EXPOSE 5000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
