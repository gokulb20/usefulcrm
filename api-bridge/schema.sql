-- UsefulCRM API Bridge — DuckDB Schema
-- Standalone CRM schema for the Hermes API bridge.
-- Run: duckdb crm.duckdb < schema.sql

-- ── Deal Stages ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deal_stages (
    id          VARCHAR PRIMARY KEY DEFAULT (uuid()),
    name        VARCHAR NOT NULL UNIQUE,
    position    INTEGER NOT NULL DEFAULT 0,
    color       VARCHAR,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT OR IGNORE INTO deal_stages (name, position, color) VALUES
    ('Lead',        0, '#6366f1'),
    ('Qualified',   1, '#3b82f6'),
    ('Proposal',    2, '#f59e0b'),
    ('Negotiation', 3, '#ef4444'),
    ('Closed Won',  4, '#10b981'),
    ('Closed Lost', 5, '#6b7280');

-- ── Tags ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tags (
    id          VARCHAR PRIMARY KEY DEFAULT (uuid()),
    name        VARCHAR NOT NULL UNIQUE,
    color       VARCHAR,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Companies ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS companies (
    id          VARCHAR PRIMARY KEY DEFAULT (uuid()),
    name        VARCHAR NOT NULL,
    domain      VARCHAR,
    industry    VARCHAR,
    size        VARCHAR,           -- "1-10", "11-50", "51-200", etc.
    website     VARCHAR,
    linkedin    VARCHAR,
    description TEXT,
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_companies_name   ON companies (name);
CREATE INDEX IF NOT EXISTS idx_companies_domain ON companies (domain);

-- ── Contacts ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contacts (
    id          VARCHAR PRIMARY KEY DEFAULT (uuid()),
    first_name  VARCHAR NOT NULL DEFAULT '',
    last_name   VARCHAR NOT NULL DEFAULT '',
    email       VARCHAR,
    phone       VARCHAR,
    title       VARCHAR,
    company_id  VARCHAR REFERENCES companies(id) ON DELETE SET NULL,
    status      VARCHAR NOT NULL DEFAULT 'active',  -- active | lead | customer | churned
    linkedin    VARCHAR,
    twitter     VARCHAR,
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contacts_email      ON contacts (email);
CREATE INDEX IF NOT EXISTS idx_contacts_company_id ON contacts (company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_status     ON contacts (status);

-- ── Contact Tags (many-to-many) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contact_tags (
    contact_id VARCHAR NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    tag_id     VARCHAR NOT NULL REFERENCES tags(id)     ON DELETE CASCADE,
    PRIMARY KEY (contact_id, tag_id)
);

-- ── Deals ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deals (
    id           VARCHAR PRIMARY KEY DEFAULT (uuid()),
    name         VARCHAR NOT NULL,
    value        DECIMAL(18, 2),
    currency     VARCHAR NOT NULL DEFAULT 'USD',
    stage_id     VARCHAR REFERENCES deal_stages(id) ON DELETE SET NULL,
    stage        VARCHAR,           -- denormalized stage name for quick access
    company_id   VARCHAR REFERENCES companies(id)   ON DELETE SET NULL,
    contact_id   VARCHAR REFERENCES contacts(id)    ON DELETE SET NULL,
    owner        VARCHAR,           -- free-text owner name / email
    close_date   DATE,
    probability  INTEGER,           -- 0-100
    notes        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deals_stage_id   ON deals (stage_id);
CREATE INDEX IF NOT EXISTS idx_deals_company_id ON deals (company_id);
CREATE INDEX IF NOT EXISTS idx_deals_contact_id ON deals (contact_id);

-- ── Activities ────────────────────────────────────────────────────────────────
-- Interactions / timeline events (calls, emails, meetings, notes, tasks)
CREATE TABLE IF NOT EXISTS activities (
    id           VARCHAR PRIMARY KEY DEFAULT (uuid()),
    type         VARCHAR NOT NULL DEFAULT 'note',  -- note | call | email | meeting | task
    subject      VARCHAR,
    body         TEXT,
    contact_id   VARCHAR REFERENCES contacts(id)  ON DELETE SET NULL,
    company_id   VARCHAR REFERENCES companies(id) ON DELETE SET NULL,
    deal_id      VARCHAR REFERENCES deals(id)     ON DELETE SET NULL,
    completed    BOOLEAN NOT NULL DEFAULT false,
    due_at       TIMESTAMPTZ,
    occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activities_contact_id ON activities (contact_id);
CREATE INDEX IF NOT EXISTS idx_activities_company_id ON activities (company_id);
CREATE INDEX IF NOT EXISTS idx_activities_deal_id    ON activities (deal_id);
CREATE INDEX IF NOT EXISTS idx_activities_type       ON activities (type);

-- ── Documents ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
    id           VARCHAR PRIMARY KEY DEFAULT (uuid()),
    title        VARCHAR NOT NULL,
    content      TEXT,
    type         VARCHAR NOT NULL DEFAULT 'note',  -- note | proposal | contract | report
    contact_id   VARCHAR REFERENCES contacts(id)  ON DELETE SET NULL,
    company_id   VARCHAR REFERENCES companies(id) ON DELETE SET NULL,
    deal_id      VARCHAR REFERENCES deals(id)     ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_contact_id ON documents (contact_id);
CREATE INDEX IF NOT EXISTS idx_documents_company_id ON documents (company_id);
CREATE INDEX IF NOT EXISTS idx_documents_deal_id    ON documents (deal_id);

-- ── FTS helper view (used by /api/search) ─────────────────────────────────────
-- DuckDB doesn't have full FTS built-in; we do ILIKE-based search in Python.
-- This view consolidates searchable text for convenience.
CREATE VIEW IF NOT EXISTS v_search AS
    SELECT 'contact'  AS entity_type, id, (first_name || ' ' || last_name || ' ' || COALESCE(email,'') || ' ' || COALESCE(title,'') || ' ' || COALESCE(notes,'')) AS text FROM contacts
    UNION ALL
    SELECT 'company'  AS entity_type, id, (name || ' ' || COALESCE(domain,'') || ' ' || COALESCE(industry,'') || ' ' || COALESCE(description,'') || ' ' || COALESCE(notes,'')) AS text FROM companies
    UNION ALL
    SELECT 'deal'     AS entity_type, id, (name || ' ' || COALESCE(stage,'') || ' ' || COALESCE(notes,'')) AS text FROM deals
    UNION ALL
    SELECT 'activity' AS entity_type, id, (type || ' ' || COALESCE(subject,'') || ' ' || COALESCE(body,'')) AS text FROM activities
    UNION ALL
    SELECT 'document' AS entity_type, id, (title || ' ' || COALESCE(content,'')) AS text FROM documents;
