"""
UsefulCRM API Bridge — FastAPI server
======================================
Lightweight Python backend that the Next.js frontend calls instead of the
old OpenClaw/Hermes gateway. Exposes REST + SSE endpoints backed by DuckDB.

Default port: 3200 (matches USEFUL_API_URL=http://localhost:3200 in .env.example)

Usage
-----
    pip install -r requirements.txt
    python main.py           # development (auto-reload)
    uvicorn main:app --port 3200

Env vars
--------
    PORT                 Server port (default: 3200)
    HOST                 Server host (default: 0.0.0.0)
    CRM_DB_PATH          DuckDB file path (default: ./crm.duckdb)
    HERMES_BIN           Path to hermes CLI binary (default: hermes)
    HERMES_HTTP_URL      URL of running Hermes web server (overrides subprocess mode)
    USEFUL_WORKSPACE_DIR Workspace dir passed to Hermes agent
"""

import json
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

import duckdb
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from hermes_client import HermesClient, get_client

# ── Config ─────────────────────────────────────────────────────────────────────

PORT = int(os.environ.get("PORT", "3200"))
HOST = os.environ.get("HOST", "0.0.0.0")
DB_PATH = Path(os.environ.get("CRM_DB_PATH", Path(__file__).parent / "data" / "usefulcrm.duckdb"))
SCHEMA_PATH = Path(__file__).parent / "schema.sql"

# ── Database helpers ───────────────────────────────────────────────────────────

def get_db() -> duckdb.DuckDBPyConnection:
    """Open a fresh DuckDB connection (thread-safe in per-request usage)."""
    return duckdb.connect(str(DB_PATH))


def ensure_schema() -> None:
    """Create tables if they don't exist yet."""
    if not SCHEMA_PATH.exists():
        print(f"[api-bridge] WARNING: schema.sql not found at {SCHEMA_PATH}")
        return
    sql = SCHEMA_PATH.read_text()
    with get_db() as conn:
        # DuckDB doesn't support multi-statement execute directly for all DDL;
        # split on semicolons and execute each statement.
        for stmt in sql.split(";"):
            stmt = stmt.strip()
            if stmt and not stmt.startswith("--"):
                try:
                    conn.execute(stmt)
                except Exception as exc:
                    # Ignore "already exists" type errors
                    if "already exists" not in str(exc).lower():
                        print(f"[api-bridge] Schema warning: {exc}")


def rows_to_dicts(result: duckdb.DuckDBPyRelation) -> list[dict[str, Any]]:
    """Convert a DuckDB relation to a list of dicts."""
    cols = [desc[0] for desc in result.description]
    return [dict(zip(cols, row)) for row in result.fetchall()]


def paginate(query: str, limit: int, offset: int) -> str:
    return f"{query} LIMIT {limit} OFFSET {offset}"


def now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


# ── Lifespan ───────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):  # type: ignore[type-arg]
    print(f"[api-bridge] Starting on {HOST}:{PORT}")
    print(f"[api-bridge] Database: {DB_PATH}")
    ensure_schema()
    hermes = get_client()
    health = hermes.health_check()
    print(f"[api-bridge] Hermes health: {health}")
    yield
    print("[api-bridge] Shutting down")


# ── App ────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="UsefulCRM API Bridge",
    description="Hermes-backed CRM REST + SSE API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health ─────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    hermes = get_client()
    return {"ok": True, "hermes": hermes.health_check()}


# ── Chat (SSE streaming) ───────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None
    context: Optional[dict[str, Any]] = None


@app.post("/api/chat")
async def chat(body: ChatRequest):
    """
    Send a message to the Hermes agent and stream back SSE events.
    The frontend connects and receives chunks as `data: {...}\\n\\n`.
    """
    client: HermesClient = get_client()
    sid = body.session_id or str(uuid.uuid4())

    async def event_stream():
        try:
            for chunk in client.stream_message(body.message, session_id=sid):
                yield chunk.to_sse()
        except Exception as exc:
            error_payload = json.dumps({"type": "error", "content": str(exc)})
            yield f"data: {error_payload}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )


# ── Contacts ───────────────────────────────────────────────────────────────────

class ContactCreate(BaseModel):
    first_name: str = ""
    last_name: str = ""
    email: Optional[str] = None
    phone: Optional[str] = None
    title: Optional[str] = None
    company_id: Optional[str] = None
    status: str = "active"
    linkedin: Optional[str] = None
    twitter: Optional[str] = None
    notes: Optional[str] = None


class ContactUpdate(ContactCreate):
    first_name: Optional[str] = None  # type: ignore[assignment]
    last_name: Optional[str] = None   # type: ignore[assignment]
    status: Optional[str] = None      # type: ignore[assignment]


@app.get("/api/contacts")
async def list_contacts(
    limit: int = Query(20, ge=1, le=500),
    offset: int = Query(0, ge=0),
    company_id: Optional[str] = None,
    status: Optional[str] = None,
    q: Optional[str] = None,
):
    with get_db() as conn:
        where_clauses = []
        params: list[Any] = []

        if company_id:
            where_clauses.append("company_id = ?")
            params.append(company_id)
        if status:
            where_clauses.append("status = ?")
            params.append(status)
        if q:
            where_clauses.append(
                "(first_name ILIKE ? OR last_name ILIKE ? OR email ILIKE ? OR title ILIKE ?)"
            )
            like = f"%{q}%"
            params.extend([like, like, like, like])

        where = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
        sql = f"SELECT * FROM contacts {where} ORDER BY created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        result = conn.execute(sql, params)
        cols = [d[0] for d in result.description]
        rows = [dict(zip(cols, r)) for r in result.fetchall()]

        count_sql = f"SELECT COUNT(*) FROM contacts {where}"
        total = conn.execute(count_sql, params[:-2]).fetchone()[0]

    return {"data": rows, "total": total, "limit": limit, "offset": offset}


@app.post("/api/contacts", status_code=201)
async def create_contact(body: ContactCreate):
    cid = str(uuid.uuid4())
    ts = now_iso()
    with get_db() as conn:
        conn.execute(
            """INSERT INTO contacts
               (id, first_name, last_name, email, phone, title, company_id,
                status, linkedin, twitter, notes, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            [cid, body.first_name, body.last_name, body.email, body.phone,
             body.title, body.company_id, body.status, body.linkedin,
             body.twitter, body.notes, ts, ts],
        )
    return {"id": cid, **body.model_dump(), "created_at": ts, "updated_at": ts}


@app.get("/api/contacts/{contact_id}")
async def get_contact(contact_id: str):
    with get_db() as conn:
        result = conn.execute("SELECT * FROM contacts WHERE id = ?", [contact_id])
        cols = [d[0] for d in result.description]
        row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Contact not found")
    return dict(zip(cols, row))


@app.put("/api/contacts/{contact_id}")
async def update_contact(contact_id: str, body: ContactUpdate):
    ts = now_iso()
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [ts, contact_id]
    with get_db() as conn:
        conn.execute(
            f"UPDATE contacts SET {set_clause}, updated_at = ? WHERE id = ?", values
        )
        result = conn.execute("SELECT * FROM contacts WHERE id = ?", [contact_id])
        cols = [d[0] for d in result.description]
        row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Contact not found")
    return dict(zip(cols, row))


@app.delete("/api/contacts/{contact_id}", status_code=204)
async def delete_contact(contact_id: str):
    with get_db() as conn:
        conn.execute("DELETE FROM contacts WHERE id = ?", [contact_id])
    return Response(status_code=204)


# ── Companies ──────────────────────────────────────────────────────────────────

class CompanyCreate(BaseModel):
    name: str
    domain: Optional[str] = None
    industry: Optional[str] = None
    size: Optional[str] = None
    website: Optional[str] = None
    linkedin: Optional[str] = None
    description: Optional[str] = None
    notes: Optional[str] = None


class CompanyUpdate(CompanyCreate):
    name: Optional[str] = None  # type: ignore[assignment]


@app.get("/api/companies")
async def list_companies(
    limit: int = Query(20, ge=1, le=500),
    offset: int = Query(0, ge=0),
    industry: Optional[str] = None,
    q: Optional[str] = None,
):
    with get_db() as conn:
        where_clauses = []
        params: list[Any] = []

        if industry:
            where_clauses.append("industry = ?")
            params.append(industry)
        if q:
            where_clauses.append("(name ILIKE ? OR domain ILIKE ? OR industry ILIKE ?)")
            like = f"%{q}%"
            params.extend([like, like, like])

        where = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
        sql = f"SELECT * FROM companies {where} ORDER BY name ASC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        result = conn.execute(sql, params)
        cols = [d[0] for d in result.description]
        rows = [dict(zip(cols, r)) for r in result.fetchall()]
        total = conn.execute(f"SELECT COUNT(*) FROM companies {where}", params[:-2]).fetchone()[0]

    return {"data": rows, "total": total, "limit": limit, "offset": offset}


@app.post("/api/companies", status_code=201)
async def create_company(body: CompanyCreate):
    cid = str(uuid.uuid4())
    ts = now_iso()
    with get_db() as conn:
        conn.execute(
            """INSERT INTO companies
               (id, name, domain, industry, size, website, linkedin,
                description, notes, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            [cid, body.name, body.domain, body.industry, body.size,
             body.website, body.linkedin, body.description, body.notes, ts, ts],
        )
    return {"id": cid, **body.model_dump(), "created_at": ts, "updated_at": ts}


@app.get("/api/companies/{company_id}")
async def get_company(company_id: str):
    with get_db() as conn:
        result = conn.execute("SELECT * FROM companies WHERE id = ?", [company_id])
        cols = [d[0] for d in result.description]
        row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Company not found")
    return dict(zip(cols, row))


@app.put("/api/companies/{company_id}")
async def update_company(company_id: str, body: CompanyUpdate):
    ts = now_iso()
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [ts, company_id]
    with get_db() as conn:
        conn.execute(
            f"UPDATE companies SET {set_clause}, updated_at = ? WHERE id = ?", values
        )
        result = conn.execute("SELECT * FROM companies WHERE id = ?", [company_id])
        cols = [d[0] for d in result.description]
        row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Company not found")
    return dict(zip(cols, row))


# ── Deals ──────────────────────────────────────────────────────────────────────

class DealCreate(BaseModel):
    name: str
    value: Optional[float] = None
    currency: str = "USD"
    stage_id: Optional[str] = None
    stage: Optional[str] = None
    company_id: Optional[str] = None
    contact_id: Optional[str] = None
    owner: Optional[str] = None
    close_date: Optional[str] = None
    probability: Optional[int] = None
    notes: Optional[str] = None


class DealUpdate(DealCreate):
    name: Optional[str] = None  # type: ignore[assignment]
    currency: Optional[str] = None  # type: ignore[assignment]


@app.get("/api/deals")
async def list_deals(
    limit: int = Query(20, ge=1, le=500),
    offset: int = Query(0, ge=0),
    company_id: Optional[str] = None,
    contact_id: Optional[str] = None,
    stage: Optional[str] = None,
    stage_id: Optional[str] = None,
):
    with get_db() as conn:
        where_clauses = []
        params: list[Any] = []

        if company_id:
            where_clauses.append("company_id = ?")
            params.append(company_id)
        if contact_id:
            where_clauses.append("contact_id = ?")
            params.append(contact_id)
        if stage:
            where_clauses.append("stage = ?")
            params.append(stage)
        if stage_id:
            where_clauses.append("stage_id = ?")
            params.append(stage_id)

        where = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
        sql = f"SELECT * FROM deals {where} ORDER BY created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        result = conn.execute(sql, params)
        cols = [d[0] for d in result.description]
        rows = [dict(zip(cols, r)) for r in result.fetchall()]
        total = conn.execute(f"SELECT COUNT(*) FROM deals {where}", params[:-2]).fetchone()[0]

    return {"data": rows, "total": total, "limit": limit, "offset": offset}


@app.post("/api/deals", status_code=201)
async def create_deal(body: DealCreate):
    did = str(uuid.uuid4())
    ts = now_iso()
    with get_db() as conn:
        conn.execute(
            """INSERT INTO deals
               (id, name, value, currency, stage_id, stage, company_id,
                contact_id, owner, close_date, probability, notes, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            [did, body.name, body.value, body.currency, body.stage_id, body.stage,
             body.company_id, body.contact_id, body.owner, body.close_date,
             body.probability, body.notes, ts, ts],
        )
    return {"id": did, **body.model_dump(), "created_at": ts, "updated_at": ts}


@app.get("/api/deals/{deal_id}")
async def get_deal(deal_id: str):
    with get_db() as conn:
        result = conn.execute("SELECT * FROM deals WHERE id = ?", [deal_id])
        cols = [d[0] for d in result.description]
        row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Deal not found")
    return dict(zip(cols, row))


@app.put("/api/deals/{deal_id}")
async def update_deal(deal_id: str, body: DealUpdate):
    ts = now_iso()
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [ts, deal_id]
    with get_db() as conn:
        conn.execute(
            f"UPDATE deals SET {set_clause}, updated_at = ? WHERE id = ?", values
        )
        result = conn.execute("SELECT * FROM deals WHERE id = ?", [deal_id])
        cols = [d[0] for d in result.description]
        row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Deal not found")
    return dict(zip(cols, row))


# ── Activities ─────────────────────────────────────────────────────────────────

class ActivityCreate(BaseModel):
    type: str = "note"
    subject: Optional[str] = None
    body: Optional[str] = None
    contact_id: Optional[str] = None
    company_id: Optional[str] = None
    deal_id: Optional[str] = None
    completed: bool = False
    due_at: Optional[str] = None
    occurred_at: Optional[str] = None


@app.get("/api/activities")
async def list_activities(
    limit: int = Query(20, ge=1, le=500),
    offset: int = Query(0, ge=0),
    contact_id: Optional[str] = None,
    company_id: Optional[str] = None,
    deal_id: Optional[str] = None,
    type: Optional[str] = None,
):
    with get_db() as conn:
        where_clauses = []
        params: list[Any] = []

        if contact_id:
            where_clauses.append("contact_id = ?")
            params.append(contact_id)
        if company_id:
            where_clauses.append("company_id = ?")
            params.append(company_id)
        if deal_id:
            where_clauses.append("deal_id = ?")
            params.append(deal_id)
        if type:
            where_clauses.append("type = ?")
            params.append(type)

        where = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
        sql = f"SELECT * FROM activities {where} ORDER BY occurred_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        result = conn.execute(sql, params)
        cols = [d[0] for d in result.description]
        rows = [dict(zip(cols, r)) for r in result.fetchall()]
        total = conn.execute(f"SELECT COUNT(*) FROM activities {where}", params[:-2]).fetchone()[0]

    return {"data": rows, "total": total, "limit": limit, "offset": offset}


@app.post("/api/activities", status_code=201)
async def create_activity(body: ActivityCreate):
    aid = str(uuid.uuid4())
    ts = now_iso()
    occurred = body.occurred_at or ts
    with get_db() as conn:
        conn.execute(
            """INSERT INTO activities
               (id, type, subject, body, contact_id, company_id, deal_id,
                completed, due_at, occurred_at, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            [aid, body.type, body.subject, body.body, body.contact_id,
             body.company_id, body.deal_id, body.completed, body.due_at,
             occurred, ts, ts],
        )
    return {"id": aid, **body.model_dump(), "occurred_at": occurred,
            "created_at": ts, "updated_at": ts}


# ── Documents ──────────────────────────────────────────────────────────────────

class DocumentCreate(BaseModel):
    title: str
    content: Optional[str] = None
    type: str = "note"
    contact_id: Optional[str] = None
    company_id: Optional[str] = None
    deal_id: Optional[str] = None


class DocumentUpdate(DocumentCreate):
    title: Optional[str] = None  # type: ignore[assignment]
    type: Optional[str] = None   # type: ignore[assignment]


@app.get("/api/documents")
async def list_documents(
    limit: int = Query(20, ge=1, le=500),
    offset: int = Query(0, ge=0),
    contact_id: Optional[str] = None,
    company_id: Optional[str] = None,
    deal_id: Optional[str] = None,
    type: Optional[str] = None,
):
    with get_db() as conn:
        where_clauses = []
        params: list[Any] = []

        if contact_id:
            where_clauses.append("contact_id = ?")
            params.append(contact_id)
        if company_id:
            where_clauses.append("company_id = ?")
            params.append(company_id)
        if deal_id:
            where_clauses.append("deal_id = ?")
            params.append(deal_id)
        if type:
            where_clauses.append("type = ?")
            params.append(type)

        where = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
        sql = f"SELECT * FROM documents {where} ORDER BY created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        result = conn.execute(sql, params)
        cols = [d[0] for d in result.description]
        rows = [dict(zip(cols, r)) for r in result.fetchall()]
        total = conn.execute(f"SELECT COUNT(*) FROM documents {where}", params[:-2]).fetchone()[0]

    return {"data": rows, "total": total, "limit": limit, "offset": offset}


@app.post("/api/documents", status_code=201)
async def create_document(body: DocumentCreate):
    did = str(uuid.uuid4())
    ts = now_iso()
    with get_db() as conn:
        conn.execute(
            """INSERT INTO documents
               (id, title, content, type, contact_id, company_id, deal_id, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            [did, body.title, body.content, body.type,
             body.contact_id, body.company_id, body.deal_id, ts, ts],
        )
    return {"id": did, **body.model_dump(), "created_at": ts, "updated_at": ts}


@app.put("/api/documents/{doc_id}")
async def update_document(doc_id: str, body: DocumentUpdate):
    ts = now_iso()
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [ts, doc_id]
    with get_db() as conn:
        conn.execute(
            f"UPDATE documents SET {set_clause}, updated_at = ? WHERE id = ?", values
        )
        result = conn.execute("SELECT * FROM documents WHERE id = ?", [doc_id])
        cols = [d[0] for d in result.description]
        row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")
    return dict(zip(cols, row))


# ── Search ─────────────────────────────────────────────────────────────────────

@app.get("/api/search")
async def search(
    q: str = Query(..., min_length=1),
    limit: int = Query(20, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """
    Full-text search across contacts, companies, deals, activities, and documents.
    Uses ILIKE-based search (DuckDB doesn't have a built-in FTS engine).
    """
    like = f"%{q}%"
    results: list[dict[str, Any]] = []

    with get_db() as conn:
        # Contacts
        r = conn.execute(
            """SELECT 'contact' AS entity_type, id,
                      (first_name || ' ' || last_name) AS title,
                      email AS subtitle, created_at
               FROM contacts
               WHERE first_name ILIKE ? OR last_name ILIKE ? OR email ILIKE ? OR title ILIKE ?
               ORDER BY created_at DESC LIMIT ? OFFSET ?""",
            [like, like, like, like, limit, offset],
        )
        cols = [d[0] for d in r.description]
        results.extend(dict(zip(cols, row)) for row in r.fetchall())

        # Companies
        r = conn.execute(
            """SELECT 'company' AS entity_type, id, name AS title,
                      domain AS subtitle, created_at
               FROM companies
               WHERE name ILIKE ? OR domain ILIKE ? OR industry ILIKE ?
               ORDER BY name ASC LIMIT ? OFFSET ?""",
            [like, like, like, limit, offset],
        )
        cols = [d[0] for d in r.description]
        results.extend(dict(zip(cols, row)) for row in r.fetchall())

        # Deals
        r = conn.execute(
            """SELECT 'deal' AS entity_type, id, name AS title,
                      stage AS subtitle, created_at
               FROM deals
               WHERE name ILIKE ? OR stage ILIKE ? OR notes ILIKE ?
               ORDER BY created_at DESC LIMIT ? OFFSET ?""",
            [like, like, like, limit, offset],
        )
        cols = [d[0] for d in r.description]
        results.extend(dict(zip(cols, row)) for row in r.fetchall())

        # Documents
        r = conn.execute(
            """SELECT 'document' AS entity_type, id, title,
                      type AS subtitle, created_at
               FROM documents
               WHERE title ILIKE ? OR content ILIKE ?
               ORDER BY created_at DESC LIMIT ? OFFSET ?""",
            [like, like, limit, offset],
        )
        cols = [d[0] for d in r.description]
        results.extend(dict(zip(cols, row)) for row in r.fetchall())

    # Sort by created_at descending across entity types
    results.sort(key=lambda x: str(x.get("created_at", "")), reverse=True)

    return {
        "data": results[:limit],
        "total": len(results),
        "query": q,
        "limit": limit,
        "offset": offset,
    }


# ── Deal stages (reference data) ───────────────────────────────────────────────

@app.get("/api/deal-stages")
async def list_deal_stages():
    with get_db() as conn:
        result = conn.execute("SELECT * FROM deal_stages ORDER BY position ASC")
        cols = [d[0] for d in result.description]
        rows = [dict(zip(cols, r)) for r in result.fetchall()]
    return {"data": rows}


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=HOST, port=PORT, reload=True)
