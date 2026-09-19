# Starter Kit Audit & Architecture Report

**Project**: Andijon Smart Route Platform (MashrutGo)  
**Document Owner**: Developer 1 (Backend, Routing, Realtime, Payments)  
**Date**: September 2026  
**Status**: APPROVED & ACTIVE (Stage 0 Deliverable)

---

## 1. Repository Structure & Git Ownership

The repository is organized as a monorepo containing distinct sub-projects designed for zero-conflict parallel development:

```
MashrutGo/
├── backend/                  # [DEV 1 OWNERSHIP] FastAPI application, database, routing engine, realtime WS, payments
│   ├── app/
│   │   ├── api/             # API routers, dependencies, endpoints (v1)
│   │   ├── core/            # App configuration (pydantic-settings), security, constants
│   │   ├── db/              # SQLAlchemy session, declarative Base, migrations
│   │   ├── models/          # SQLAlchemy ORM models (Stage 1+)
│   │   └── main.py          # FastAPI application entrypoint & middleware configuration
│   ├── tests/               # Pytest test suite (health, auth, routing, shifts, payments)
│   ├── .env.example         # Backend environment variables template
│   └── requirements.txt     # Python dependencies
├── frontend/                 # React 18 + Vite + Tailwind CSS + MapLibre GL
│   ├── src/                 # Client UI (Dev 2) and Driver/Admin UI (Dev 3)
│   └── package.json         # Node dependencies
├── docs/                     # Architectural documents & developer contracts
│   ├── contracts/           # [DEV 1 OWNERSHIP] Single source of truth for APIs & Realtime events
│   │   ├── STARTER_KIT_AUDIT.md
│   │   ├── API_CHANGELOG.md
│   │   └── REALTIME_EVENTS.md
│   ├── DEV_1_BACKEND_ROUTING_PAYMENTS.md
│   ├── DEV_2_CLIENT_PWA.md
│   ├── DEV_3_DRIVER_OPERATIONS_ADMIN_MOBILE.md
│   ├── SHARED_FILES.md
│   └── UMUMIY_ABOUT.md
├── CONTRIBUTING.md
└── README.md
```

### Git Ownership Boundaries
- **Developer 1**: Owns `backend/`, `backend/tests/`, `backend/requirements.txt`, `backend/.env.example`, `docs/contracts/*`.
- **Developer 2**: Owns Client PWA user flows, search UI, and client map interactions in `frontend/`.
- **Developer 3**: Owns Driver shift UI, GPS transmission PWA, Uyushma/Admin management dashboard, and Flutter wrapper.
- **Rule**: Dev 1 does NOT touch frontend code (`frontend/src/*`). Dev 2 and Dev 3 consume backend services strictly via `docs/contracts/*` and the generated OpenAPI specifications (`/api/v1/openapi.json`).

---

## 2. Package Managers & Environment Conventions

### 2.1 Backend Package Manager (`pip` / `requirements.txt`)
- **Python Version**: Python 3.12+ (local runtime: Python 3.12.10).
- **Core Web Framework**: `fastapi>=0.110.0` with `uvicorn[standard]>=0.28.0`.
- **Validation & Settings**: `pydantic>=2.6.0` and `pydantic-settings>=2.2.0`.
  - *Audit Finding*: Previous starter pinned `pydantic==1.10.7` and imported `from pydantic import BaseSettings`. On Python 3.12, this caused `PydanticImportError`. The backend config (`app/core/config.py`) has been upgraded to utilize `pydantic_settings.BaseSettings` with fallback compatibility.
- **Database Layer**: `sqlalchemy>=2.0.28` and `alembic>=1.13.1`.
- **Testing & Async HTTP**: `pytest>=8.0.0`, `pytest-asyncio>=0.23.0`, `httpx>=0.27.0`.
- **Security & Auth**: `python-jose[cryptography]>=3.3.0`, `passlib[bcrypt]>=1.7.4`, `bcrypt>=4.0.0`.
- **Realtime**: `websockets>=12.0`.

### 2.2 Frontend Package Manager (`npm`)
- **Runtime & Tools**: Node.js, `vite@5.1.7`, `typescript@5.1.6`.
- **UI Stack**: `react@18.2.0`, `react-dom@18.2.0`, `react-router-dom@6.12.1`, `remixicon@2.5.0`, `tailwindcss@3.5.3`.
- **Maps**: `maplibre-gl@2.4.0` (MapTiler compatible).
- **State & Caching**: `@tanstack/react-query@4.36.0`.

---

## 3. Database Architecture: SQLite MVP to PostgreSQL Migration

### 3.1 Current MVP Setup (SQLite)
- Local connection string: `sqlite:///./app.db`.
- SQLite connection argument: `connect_args={"check_same_thread": False}` enabled in `app/db/session.py`.
- Declarative base defined in `app/db/base.py`.

### 3.2 PostgreSQL Compatibility Rules
To guarantee seamless migration from SQLite to PostgreSQL without modifying ORM models:
1. **Primary Keys**: Use standard integers (`Integer, primary_key=True, autoincrement=True`) or standard string UUIDs (`String(36)`), supported uniformly across SQLite and PostgreSQL.
2. **Date & Time**: Store timestamps as UTC using `DateTime(timezone=True)`. Always generate timestamps via `datetime.now(timezone.utc)`.
3. **JSON Fields**: Use SQLAlchemy's generic `sa.JSON` type or store structured configurations as strings (`sa.Text`) where needed; both work identically in SQLite and PostgreSQL.
4. **Foreign Keys**: All relations must declare explicit foreign key constraints with `ondelete="CASCADE"` or `ondelete="SET NULL"`.
5. **Alembic Migrations**: All schema evolution will be managed via Alembic revisions located in `backend/alembic/`, ensuring clean deployment scripts for production PostgreSQL databases.

---

## 4. Configuration & Environment Variables

All settings are managed via `backend/app/core/config.py` reading from `.env` with fallback to `.env.example`:

| Variable Category | Key | Description | Example / Default |
|---|---|---|---|
| **Core** | `APP_ENV` | Environment identifier | `development` |
| **Core** | `APP_NAME` | Service title in docs & OpenAPI | `Andijon Transport Platform` |
| **Core** | `API_V1_PREFIX` | Prefix for version 1 API | `/api/v1` |
| **Core** | `SECRET_KEY` | JWT signing secret | Change in production |
| **Core** | `ACCESS_TOKEN_EXPIRE_MINUTES` | JWT token lifetime | `1440` (24 hours) |
| **Core** | `CORS_ORIGINS` | Permitted origins list | `["http://localhost:5173", ...]` |
| **Database** | `DATABASE_URL` | SQLAlchemy connection URL | `sqlite:///./app.db` |
| **Map** | `MAPTILER_API_KEY` | MapTiler cloud API key | `placeholder_maptiler_api_key` |
| **Map** | `MAPTILER_BASE_URL` | MapTiler base URL | `https://api.maptiler.com` |
| **Payments** | `CLICK_SERVICE_ID` | Click merchant service ID | `placeholder_click_service_id` |
| **Payments** | `CLICK_SECRET_KEY` | Click signature secret key | `placeholder_click_secret_key` |
| **Push** | `FCM_ENABLED` | Toggle Firebase notifications | `false` |
| **Realtime** | `GPS_STALE_THRESHOLD_SECONDS` | Driver GPS freshness window | `45` |
| **Realtime** | `PARKING_GEOFENCE_DEFAULT_RADIUS_METERS` | Stayanka entry geofence radius | `100` |
| **Realtime** | `CLIENT_WATCH_HEARTBEAT_TIMEOUT_SECONDS` | Client active watch timeout | `60` |

---

## 5. Collaboration & Integration Workflow

1. **Contract-First Development**: Dev 1 publishes API schemas in `docs/contracts/API_CHANGELOG.md` and event models in `docs/contracts/REALTIME_EVENTS.md` before or simultaneously with backend code.
2. **Interactive OpenAPI Documentation**: Dev 2 and Dev 3 can inspect live schemas and example payloads at `http://localhost:8000/api/v1/docs`.
3. **No Breaking Changes Without Notice**: Any schema change must be documented in `docs/contracts/API_CHANGELOG.md` under an updated version tag.
