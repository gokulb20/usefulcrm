"""
UsefulCRM — Database Initializer
=================================
Creates the DuckDB database, applies schema.sql, seeds deal stages,
and inserts sample companies, contacts, and deals.

Usage:
    python3 api-bridge/init_db.py
    # or from inside api-bridge/
    python3 init_db.py
"""

import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import duckdb

# ── Paths ──────────────────────────────────────────────────────────────────────
SCRIPT_DIR  = Path(__file__).parent
DATA_DIR    = SCRIPT_DIR / "data"
DB_PATH     = DATA_DIR / "usefulcrm.duckdb"
SCHEMA_PATH = SCRIPT_DIR / "schema.sql"


def ts() -> str:
    return datetime.now(timezone.utc).isoformat()


def uid() -> str:
    return str(uuid.uuid4())


def apply_schema(conn: duckdb.DuckDBPyConnection) -> None:
    import re
    print(f"  Applying schema from {SCHEMA_PATH} ...")
    sql = SCHEMA_PATH.read_text()
    # Strip single-line SQL comments before splitting on semicolons
    sql_clean = re.sub(r"--[^\n]*", "", sql)
    for stmt in sql_clean.split(";"):
        stmt = stmt.strip()
        if stmt:
            try:
                conn.execute(stmt)
            except Exception as exc:
                err = str(exc).lower()
                if "already exists" not in err:
                    print(f"  [WARN] {exc}")
    print("  Schema applied.")


def seed_deal_stages(conn: duckdb.DuckDBPyConnection) -> list[dict]:
    print("  Seeding deal stages ...")
    existing = conn.execute("SELECT COUNT(*) FROM deal_stages").fetchone()[0]
    if existing > 0:
        print(f"  Deal stages already exist ({existing} rows) — skipping seed.")
        rows = conn.execute("SELECT id, name FROM deal_stages ORDER BY position").fetchall()
        return [{"id": r[0], "name": r[1]} for r in rows]

    stages = [
        {"name": "Lead",        "position": 0, "color": "#6366f1"},
        {"name": "Qualified",   "position": 1, "color": "#3b82f6"},
        {"name": "Proposal",    "position": 2, "color": "#f59e0b"},
        {"name": "Negotiation", "position": 3, "color": "#ef4444"},
        {"name": "Closed Won",  "position": 4, "color": "#10b981"},
        {"name": "Closed Lost", "position": 5, "color": "#6b7280"},
    ]
    result = []
    for s in stages:
        sid = uid()
        now = ts()
        conn.execute(
            "INSERT INTO deal_stages (id, name, position, color, created_at, updated_at) VALUES (?,?,?,?,?,?)",
            [sid, s["name"], s["position"], s["color"], now, now],
        )
        result.append({"id": sid, "name": s["name"]})
        print(f"    + Stage: {s['name']}")
    return result


def seed_companies(conn: duckdb.DuckDBPyConnection) -> list[dict]:
    print("  Seeding example companies ...")
    existing = conn.execute("SELECT COUNT(*) FROM companies").fetchone()[0]
    if existing > 0:
        print(f"  Companies already exist ({existing} rows) — skipping seed.")
        rows = conn.execute("SELECT id, name FROM companies").fetchall()
        return [{"id": r[0], "name": r[1]} for r in rows]

    companies = [
        {
            "name": "Acme Corp",
            "domain": "acme.com",
            "industry": "Technology",
            "size": "51-200",
            "website": "https://acme.com",
            "description": "Enterprise software solutions",
        },
        {
            "name": "Globex Industries",
            "domain": "globex.io",
            "industry": "Manufacturing",
            "size": "201-500",
            "website": "https://globex.io",
            "description": "Industrial automation and robotics",
        },
        {
            "name": "Initech Solutions",
            "domain": "initech.co",
            "industry": "Consulting",
            "size": "11-50",
            "website": "https://initech.co",
            "description": "IT consulting and digital transformation",
        },
    ]
    result = []
    for c in companies:
        cid = uid()
        now = ts()
        conn.execute(
            """INSERT INTO companies (id, name, domain, industry, size, website, description, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            [cid, c["name"], c["domain"], c["industry"], c["size"], c["website"], c["description"], now, now],
        )
        result.append({"id": cid, "name": c["name"]})
        print(f"    + Company: {c['name']}")
    return result


def seed_contacts(conn: duckdb.DuckDBPyConnection, companies: list[dict]) -> list[dict]:
    print("  Seeding example contacts ...")
    existing = conn.execute("SELECT COUNT(*) FROM contacts").fetchone()[0]
    if existing > 0:
        print(f"  Contacts already exist ({existing} rows) — skipping seed.")
        rows = conn.execute("SELECT id, first_name, last_name FROM contacts").fetchall()
        return [{"id": r[0], "name": f"{r[1]} {r[2]}"} for r in rows]

    company_map = {c["name"]: c["id"] for c in companies}
    contacts = [
        {
            "first_name": "Alice",
            "last_name": "Johnson",
            "email": "alice@acme.com",
            "phone": "+1-555-0101",
            "title": "VP of Engineering",
            "company": "Acme Corp",
            "status": "customer",
            "linkedin": "https://linkedin.com/in/alicejohnson",
            "notes": "Key decision maker. Prefers email communication.",
        },
        {
            "first_name": "Bob",
            "last_name": "Martinez",
            "email": "bob@globex.io",
            "phone": "+1-555-0202",
            "title": "Director of Operations",
            "company": "Globex Industries",
            "status": "lead",
            "linkedin": "https://linkedin.com/in/bobmartinez",
            "notes": "Interested in our automation suite. Follow up Q2.",
        },
        {
            "first_name": "Carol",
            "last_name": "Chen",
            "email": "carol@initech.co",
            "phone": "+1-555-0303",
            "title": "CEO",
            "company": "Initech Solutions",
            "status": "active",
            "notes": "Met at SaaStr 2024. Strong referral potential.",
        },
    ]
    result = []
    for c in contacts:
        cid = uid()
        now = ts()
        company_id = company_map.get(c.get("company"))
        conn.execute(
            """INSERT INTO contacts
               (id, first_name, last_name, email, phone, title, company_id,
                status, linkedin, notes, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            [cid, c["first_name"], c["last_name"], c["email"], c["phone"],
             c["title"], company_id, c["status"], c.get("linkedin"), c.get("notes"), now, now],
        )
        result.append({"id": cid, "name": f"{c['first_name']} {c['last_name']}"})
        print(f"    + Contact: {c['first_name']} {c['last_name']}")
    return result


def seed_deals(
    conn: duckdb.DuckDBPyConnection,
    stages: list[dict],
    companies: list[dict],
    contacts: list[dict],
) -> None:
    print("  Seeding example deals ...")
    existing = conn.execute("SELECT COUNT(*) FROM deals").fetchone()[0]
    if existing > 0:
        print(f"  Deals already exist ({existing} rows) — skipping seed.")
        return

    stage_map   = {s["name"]: s["id"] for s in stages}
    company_map = {c["name"]: c["id"] for c in companies}
    contact_map = {c["name"]: c["id"] for c in contacts}

    deals = [
        {
            "name": "Acme — Enterprise License",
            "value": 48000.00,
            "stage": "Proposal",
            "company": "Acme Corp",
            "contact": "Alice Johnson",
            "owner": "gokul@useful.ventures",
            "close_date": "2026-06-30",
            "probability": 60,
            "notes": "Annual renewal + expanded seat count. Proposal sent.",
        },
        {
            "name": "Globex — Automation Suite",
            "value": 120000.00,
            "stage": "Qualified",
            "company": "Globex Industries",
            "contact": "Bob Martinez",
            "owner": "gokul@useful.ventures",
            "close_date": "2026-07-15",
            "probability": 30,
            "notes": "Pilot POC approved. Budget confirmed Q3.",
        },
        {
            "name": "Initech — Starter Pack",
            "value": 9600.00,
            "stage": "Lead",
            "company": "Initech Solutions",
            "contact": "Carol Chen",
            "owner": "gokul@useful.ventures",
            "close_date": "2026-05-01",
            "probability": 20,
            "notes": "Early conversations. Needs discovery call.",
        },
    ]

    for d in deals:
        did = uid()
        now = ts()
        stage_id   = stage_map.get(d["stage"])
        company_id = company_map.get(d["company"])
        contact_id = contact_map.get(d["contact"])
        conn.execute(
            """INSERT INTO deals
               (id, name, value, currency, stage_id, stage, company_id, contact_id,
                owner, close_date, probability, notes, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            [did, d["name"], d["value"], "USD", stage_id, d["stage"],
             company_id, contact_id, d["owner"], d["close_date"],
             d["probability"], d["notes"], now, now],
        )
        print(f"    + Deal: {d['name']} (${d['value']:,.0f}, {d['stage']})")


def print_summary(conn: duckdb.DuckDBPyConnection) -> None:
    print()
    print("=" * 55)
    print("  UsefulCRM Database Initialized")
    print("=" * 55)
    for table in ["deal_stages", "companies", "contacts", "deals", "activities", "documents", "tags"]:
        count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        print(f"  {table:<20} {count:>4} rows")
    print("=" * 55)
    print(f"  Database: {DB_PATH}")
    print("=" * 55)


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    print(f"\nUsefulCRM — Initializing database at {DB_PATH}\n")

    # Remove stale DB so we get a clean run (comment out to preserve data)
    if DB_PATH.exists():
        print(f"  Existing database found — will upsert/skip existing rows.\n")

    conn = duckdb.connect(str(DB_PATH))

    apply_schema(conn)
    print()

    stages   = seed_deal_stages(conn)
    print()
    companies = seed_companies(conn)
    print()
    contacts  = seed_contacts(conn, companies)
    print()
    seed_deals(conn, stages, companies, contacts)

    print_summary(conn)
    conn.close()
    print("\nDone! Run: uvicorn main:app --port 3200")


if __name__ == "__main__":
    main()
