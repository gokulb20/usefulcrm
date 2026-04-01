---
name: crm-contacts
description: Manage CRM contacts — create, read, update, search, list, and merge duplicate contacts via the UsefulCRM API bridge or direct DuckDB queries.
version: 1.0.0
---

# CRM Contacts

Contacts are people stored in the `contacts` table of `crm.duckdb`. All operations go through the API bridge at `http://localhost:3200` or directly via `duckdb`.

## API Bridge: http://localhost:3200

### List contacts (paginated)
```bash
curl -s "http://localhost:3200/api/contacts?limit=20&offset=0" | jq .
# Filter by company:
curl -s "http://localhost:3200/api/contacts?company_id=<id>&limit=20" | jq .
# Text search:
curl -s "http://localhost:3200/api/contacts?q=john" | jq .
```

### Create a contact
```bash
curl -s -X POST "http://localhost:3200/api/contacts" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Jane Smith",
    "email": "jane@example.com",
    "phone": "+1-555-0100",
    "company_id": "<company_uuid>",
    "title": "VP Sales",
    "notes": "Met at SaaStr 2025"
  }' | jq .
```

### Get a contact by ID
```bash
curl -s "http://localhost:3200/api/contacts/<id>" | jq .
```

### Update a contact
```bash
curl -s -X PUT "http://localhost:3200/api/contacts/<id>" \
  -H "Content-Type: application/json" \
  -d '{"title": "CTO", "notes": "Promoted in Q2 2026"}' | jq .
```

### Delete a contact
```bash
curl -s -X DELETE "http://localhost:3200/api/contacts/<id>" | jq .
```

### Full-text search (across all entities)
```bash
curl -s "http://localhost:3200/api/search?q=jane+smith" | jq '.contacts'
```

---

## Direct DuckDB Queries

```bash
DB=~/sudo-workspace/usefulcrm/api-bridge/crm.duckdb

# List all contacts
duckdb "$DB" -json "SELECT id, name, email, phone, title FROM contacts ORDER BY name LIMIT 50"

# Search by name or email
duckdb "$DB" -json "SELECT * FROM contacts WHERE name ILIKE '%john%' OR email ILIKE '%john%'"

# Filter by company
duckdb "$DB" -json "SELECT c.name, c.email, co.name as company FROM contacts c LEFT JOIN companies co ON c.company_id = co.id WHERE co.name ILIKE '%acme%'"

# Count by company
duckdb "$DB" -json "SELECT co.name, COUNT(c.id) as contact_count FROM contacts c JOIN companies co ON c.company_id = co.id GROUP BY co.name ORDER BY contact_count DESC"

# Find duplicates (same email)
duckdb "$DB" -json "SELECT email, COUNT(*) as dupes FROM contacts WHERE email IS NOT NULL GROUP BY email HAVING COUNT(*) > 1"

# Find duplicates (similar name)
duckdb "$DB" -json "SELECT name, COUNT(*) as dupes FROM contacts GROUP BY name HAVING COUNT(*) > 1"

# Recent contacts (last 30 days)
duckdb "$DB" -json "SELECT name, email, created_at FROM contacts WHERE created_at >= now() - INTERVAL 30 DAY ORDER BY created_at DESC"
```

### Merge duplicate contacts

```bash
DB=~/sudo-workspace/usefulcrm/api-bridge/crm.duckdb
KEEP_ID="<uuid-to-keep>"
DROP_ID="<uuid-to-drop>"

# Re-link all activities to the kept contact
duckdb "$DB" "UPDATE activities SET contact_id = '$KEEP_ID' WHERE contact_id = '$DROP_ID'"
# Re-link all deals
duckdb "$DB" "UPDATE deals SET contact_id = '$KEEP_ID' WHERE contact_id = '$DROP_ID'"
# Re-link all documents
duckdb "$DB" "UPDATE documents SET contact_id = '$KEEP_ID' WHERE contact_id = '$DROP_ID'"
# Delete the duplicate
duckdb "$DB" "DELETE FROM contacts WHERE id = '$DROP_ID'"
echo "Merged $DROP_ID into $KEEP_ID"
```

---

## Schema Reference

```sql
-- contacts table
CREATE TABLE contacts (
  id VARCHAR PRIMARY KEY,
  name VARCHAR NOT NULL,
  email VARCHAR,
  phone VARCHAR,
  title VARCHAR,
  company_id VARCHAR REFERENCES companies(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

## Tips

- Always check for duplicates before creating: `curl "http://localhost:3200/api/contacts?q=<email>"`
- Use `company_id` to link contacts to companies (foreign key)
- `updated_at` is auto-updated by the API bridge on PUT requests
- For bulk import, use the `crm-import` skill
