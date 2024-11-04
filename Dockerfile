# Build stage
FROM python:3.11-slim as builder

WORKDIR /app

# Copy requirements first to leverage Docker cache
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create db directory with proper permissions
RUN mkdir -p instance && \
    useradd -m appuser && \
    chown -R appuser:appuser /app
USER appuser


EXPOSE 5000
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "app:app"]
