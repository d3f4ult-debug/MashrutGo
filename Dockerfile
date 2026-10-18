# ── Stage 1: Build Frontend ──
FROM node:18-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install --legacy-peer-deps
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Python Backend & Fullstack Host ──
FROM python:3.11-slim
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000 \
    APP_ENV=production \
    CORS_ORIGINS="*" \
    PATH="/usr/local/bin:/usr/bin:$PATH"

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Guarantee pip is found
RUN which pip || ln -sf /usr/local/bin/pip3 /usr/bin/pip || true
RUN which python || ln -sf /usr/local/bin/python3 /usr/bin/python || true

COPY requirements.txt ./requirements.txt
RUN python3 -m pip install --no-cache-dir --upgrade pip && \
    python3 -m pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
COPY start.sh ./start.sh
RUN chmod +x ./start.sh

EXPOSE 8000

CMD ["sh", "./start.sh"]
