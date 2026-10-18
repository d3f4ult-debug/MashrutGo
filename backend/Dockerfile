FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

RUN which pip || ln -sf /usr/local/bin/pip3 /usr/bin/pip || true
RUN which python || ln -sf /usr/local/bin/python3 /usr/bin/python || true

# Install python dependencies
COPY requirements.txt .
RUN python3 -m pip install --no-cache-dir --upgrade pip && \
    python3 -m pip install --no-cache-dir -r requirements.txt

# Copy backend application source
COPY . .

EXPOSE 8000

CMD ["python3", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
