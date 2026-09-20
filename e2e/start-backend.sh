#!/usr/bin/env bash
# Start the API for the browser end-to-end suite: a throwaway SQLite file, Andijon demo data and
# the offline routing provider, so a run never depends on a network service or a developer's app.db.
set -euo pipefail
cd "$(dirname "$0")/../backend"

DB_FILE="${E2E_DB_FILE:-$(pwd)/e2e.db}"
rm -f "$DB_FILE" "$DB_FILE-wal" "$DB_FILE-shm"

PYTHON=".venv/bin/python"
[ -x "$PYTHON" ] || PYTHON="python3"

export APP_ENV=test
export DATABASE_URL="sqlite:///$DB_FILE"
export AUTO_MIGRATE=true
export SEED_DEMO_DATA=true
export PAYMENTS_SANDBOX=true
export ROUTING_PROVIDER=geodesic
export MAPTILER_API_KEY=""
export FCM_ENABLED=false
export BACKGROUND_SWEEP_INTERVAL_SECONDS=5
# The suite drives the UI hard on purpose; per-address throttling would fail honest runs.
export LOGIN_MAX_ATTEMPTS=1000
export RATE_LIMIT_ROUTE_SEARCH_PER_MINUTE=100000
export RATE_LIMIT_ETA_PER_MINUTE=100000
export RATE_LIMIT_WATCH_START_PER_MINUTE=100000

exec "$PYTHON" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --log-level warning
