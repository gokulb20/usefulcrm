---
name: crm-documents
description: Create and manage CRM documents — notes, proposals, meeting summaries, and reports — linked to contacts, companies, or deals via the API bridge or DuckDB.
version: 1.0.0
---

# CRM Documents

Documents are markdown files linked to CRM entities, stored in the `documents` table of `crm.duckdb`. Use documents for proposals, meeting notes, SOPs, and any prose content tied to a contact, company, or deal.

## Document Types

- `note` — General notes or memos
- `proposal` — Sales proposals or quotes
- `meeting_summary` — Notes from a meeting
- `contract` — Contract or agreement
- `report` — Custom report or analysis
- `sop` — Standard operating procedure

---

## API Bridge: http://localhost:3200

### List documents
```bash
# All documents
curl -s "http://localhost:3200/api/documents?limit=50" | jq .
# Filter by contact
curl -s "http://localhost:3200/api/documents?contact_id=<id>" | jq .
# Filter by deal
curl -s "http://localhost:3200/api/documents?deal_id=<id>" | jq .
```

### Create a document
```bash
curl -s -X POST "http://localhost:3200/api/documents" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Acme Corp Proposal — Q2 2026",
    "type": "proposal",
    "contact_id": "<contact_uuid>",
    "deal_id": "<deal_uuid>",
    "content": "# Proposal\n\n## Executive Summary\n\nWe propose an annual license for 50 seats at $48,000/year...",
    "is_published": false
  }' | jq .
```

### Update a document
```bash
curl -s -X PUT "http://localhost:3200/api/documents/<id>" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "# Updated Proposal\n\n...",
    "is_published": true
  }' | jq .
```

---

## Direct DuckDB Queries

```bash
DB=~/sudo-workspace/usefulcrm/api-bridge/crm.duckdb

# List all documents for a deal
duckdb "$DB" -json "
  SELECT d.title, d.type, d.is_published, d.created_at
  FROM documents d
  WHERE d.deal_id = '<deal_id>'
  ORDER BY d.created_at DESC
"

# List all proposals
duckdb "$DB" -json "
  SELECT d.title, d.is_published, c.name as contact, co.name as company
  FROM documents d
  LEFT JOIN contacts c ON d.contact_id = c.id
  LEFT JOIN companies co ON c.company_id = co.id
  WHERE d.type = 'proposal'
  ORDER BY d.created_at DESC
"

# Recent meeting notes (last 7 days)
duckdb "$DB" -json "
  SELECT d.title, c.name as contact, d.created_at
  FROM documents d
  LEFT JOIN contacts c ON d.contact_id = c.id
  WHERE d.type = 'meeting_summary'
    AND d.created_at >= now() - INTERVAL 7 DAY
  ORDER BY d.created_at DESC
"

# Documents for a company (via contacts)
duckdb "$DB" -json "
  SELECT d.title, d.type, c.name as contact, d.created_at
  FROM documents d
  JOIN contacts c ON d.contact_id = c.id
  WHERE c.company_id = '<company_id>'
  ORDER BY d.created_at DESC
"

# Full-text search in document content
duckdb "$DB" -json "
  SELECT title, type, content
  FROM documents
  WHERE content ILIKE '%discount%'
  LIMIT 10
"
```

---

## Create a Proposal from Template

```bash
DB=~/sudo-workspace/usefulcrm/api-bridge/crm.duckdb
CONTACT_ID="<contact_uuid>"
DEAL_ID="<deal_uuid>"

# Fetch contact and deal data first
CONTACT=$(duckdb "$DB" -json "SELECT name, email, title FROM contacts WHERE id = '$CONTACT_ID'" | jq -r '.[0]')
DEAL=$(duckdb "$DB" -json "SELECT name, amount FROM deals WHERE id = '$DEAL_ID'" | jq -r '.[0]')

CONTACT_NAME=$(echo "$CONTACT" | jq -r '.name')
DEAL_NAME=$(echo "$DEAL" | jq -r '.name')
DEAL_AMOUNT=$(echo "$DEAL" | jq -r '.amount')

# Create the proposal document
curl -s -X POST "http://localhost:3200/api/documents" \
  -H "Content-Type: application/json" \
  -d "{
    \"title\": \"Proposal: $DEAL_NAME\",
    \"type\": \"proposal\",
    \"contact_id\": \"$CONTACT_ID\",
    \"deal_id\": \"$DEAL_ID\",
    \"content\": \"# Proposal: $DEAL_NAME\n\nPrepared for: $CONTACT_NAME\n\n## Investment\n\n\$${DEAL_AMOUNT}/year\n\n## Scope\n\n[Fill in scope here]\n\n## Terms\n\n[Fill in terms here]\"
  }" | jq .
```

---

## Schema Reference

```sql
CREATE TABLE documents (
  id VARCHAR PRIMARY KEY,
  title VARCHAR NOT NULL,
  type VARCHAR DEFAULT 'note',
  content TEXT,
  contact_id VARCHAR REFERENCES contacts(id),
  deal_id VARCHAR REFERENCES deals(id),
  is_published BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

## Tips

- Every proposal should be linked to both a `contact_id` and a `deal_id`
- Use `is_published = true` to mark documents ready to share externally
- For meeting notes, create a document AND log an activity (`crm-activities`) for the same event
- Store document content as markdown — the frontend renders it with a rich editor
