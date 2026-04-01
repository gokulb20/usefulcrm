# UsefulCRM API Bridge

A lightweight FastAPI server that acts as the backend for the UsefulCRM Next.js frontend.
It replaces the OpenClaw/Hermes gateway plugin architecture with a clean, standalone Python server.

## Architecture

```
Next.js frontend  ──→  API Bridge (FastAPI :3200)  ──→  DuckDB (crm.duckdb)
                                                    ──→  Hermes agent (subprocess or HTTP)
```

## Quick Start

```bash
cd api-bridge

# Install dependencies
pip install -r requirements.txt

# Initialize the database schema
duckdb crm.duckdb < schema.sql

# Start the server (port 3200)
python main.py
# or: uvicorn main:app --port 3200 --reload
```

The Next.js frontend is already configured to call `http://localhost:3200` via:
```
USEFUL_API_URL=http://localhost:3200
```

## Endpoints

### Chat (Hermes Agent)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/chat` | Send a message, get SSE stream back |

### Contacts
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/contacts` | List contacts (paginated, filterable) |
| POST | `/api/contacts` | Create a contact |
| GET | `/api/contacts/:id` | Get a contact |
| PUT | `/api/contacts/:id` | Update a contact |
| DELETE | `/api/contacts/:id` | Delete a contact |

### Companies
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/companies` | List companies |
| POST | `/api/companies` | Create a company |
| GET | `/api/companies/:id` | Get a company |
| PUT | `/api/companies/:id` | Update a company |

### Deals
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/deals` | List deals |
| POST | `/api/deals` | Create a deal |
| GET | `/api/deals/:id` | Get a deal |
| PUT | `/api/deals/:id` | Update a deal |

### Activities
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/activities` | List activities |
| POST | `/api/activities` | Log an activity |

### Documents
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/documents` | List documents |
| POST | `/api/documents` | Create a document |
| PUT | `/api/documents/:id` | Update a document |

### Search
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/search?q=<query>` | Full-text search across all entities |

### Reference Data
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/deal-stages` | List deal stages |
| GET | `/health` | Health check (includes Hermes status) |

## Pagination & Filtering

All list endpoints support:
- `?limit=20&offset=0` — pagination
- `?company_id=X` — filter by company
- `?stage=active` / `?stage_id=X` — filter deals by stage
- `?q=search+term` — text filter

## Hermes Integration

The `hermes_client.py` module provides the agent integration. Two modes:

### Subprocess mode (default)
Spawns the `hermes` CLI directly. Configure via env vars:
```bash
HERMES_BIN=/path/to/hermes          # default: "hermes"
USEFUL_WORKSPACE_DIR=~/my-workspace  # workspace dir
HERMES_TIMEOUT=120                   # max seconds to wait
```

### HTTP mode
Point to a running Hermes web server:
```bash
HERMES_HTTP_URL=http://localhost:4000
```

## Database

DuckDB file at `./crm.duckdb` (override with `CRM_DB_PATH`).

Tables: `contacts`, `companies`, `deals`, `activities`, `documents`, `tags`, `deal_stages`, `contact_tags`

The schema follows a standard CRM relational model with:
- Foreign keys between all entities
- Indexes on commonly filtered columns
- A `v_search` view for cross-entity text search

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3200` | Server port |
| `HOST` | `0.0.0.0` | Server host |
| `CRM_DB_PATH` | `./crm.duckdb` | DuckDB file path |
| `HERMES_BIN` | `hermes` | Path to hermes binary |
| `HERMES_HTTP_URL` | _(empty)_ | Hermes HTTP server URL (enables HTTP mode) |
| `USEFUL_WORKSPACE_DIR` | `~/hermes-workspace` | Workspace dir for agent |
| `HERMES_TIMEOUT` | `120` | Agent response timeout (seconds) |
