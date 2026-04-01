---
name: crm-companies
description: Manage CRM companies — create, update, list, and link contacts to companies via the UsefulCRM API bridge or DuckDB.
version: 1.0.0
---

# CRM Companies

Companies are organizations stored in the `companies` table of `crm.duckdb`. Contacts, deals, and activities reference companies by `company_id`.

## API Bridge: http://localhost:3200

### List all companies
```bash
curl -s "http://localhost:3200/api/companies?limit=50&offset=0" | jq .
# Search by name:
curl -s "http://localhost:3200/api/companies?q=acme" | jq .
```

### Create a company
```bash
curl -s -X POST "http://localhost:3200/api/companies" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Acme Corp",
    "domain": "acmecorp.com",
    "industry": "SaaS",
    "size": "51-200",
    "location": "San Francisco, CA",
    "notes": "Enterprise prospect, warm intro via Sarah"
  }' | jq .
```

### Get a company by ID
```bash
curl -s "http://localhost:3200/api/companies/<id>" | jq .
```

### Update a company
```bash
curl -s -X PUT "http://localhost:3200/api/companies/<id>" \
  -H "Content-Type: application/json" \
  -d '{"industry": "Fintech", "size": "201-500"}' | jq .
```

### Link a contact to a company
```bash
# Update the contact's company_id field
curl -s -X PUT "http://localhost:3200/api/contacts/<contact_id>" \
  -H "Content-Type: application/json" \
  -d '{"company_id": "<company_id>"}' | jq .
```

---

## Direct DuckDB Queries

```bash
DB=~/sudo-workspace/usefulcrm/api-bridge/crm.duckdb

# List all companies with contact counts
duckdb "$DB" -json "
  SELECT co.id, co.name, co.domain, co.industry, co.size,
         COUNT(c.id) as contact_count
  FROM companies co
  LEFT JOIN contacts c ON c.company_id = co.id
  GROUP BY co.id, co.name, co.domain, co.industry, co.size
  ORDER BY contact_count DESC
"

# Companies with open deals
duckdb "$DB" -json "
  SELECT co.name, COUNT(d.id) as open_deals, SUM(d.amount::NUMERIC) as pipeline_value
  FROM companies co
  JOIN deals d ON d.company_id = co.id
  WHERE d.stage NOT IN ('Closed Won', 'Closed Lost')
  GROUP BY co.name
  ORDER BY pipeline_value DESC
"

# Companies without any contacts
duckdb "$DB" -json "
  SELECT co.name, co.domain
  FROM companies co
  LEFT JOIN contacts c ON c.company_id = co.id
  WHERE c.id IS NULL
"

# Find company by domain
duckdb "$DB" -json "SELECT * FROM companies WHERE domain ILIKE '%stripe.com%'"

# Duplicate company check
duckdb "$DB" -json "SELECT name, COUNT(*) as dupes FROM companies GROUP BY name HAVING COUNT(*) > 1"
```

### Merge duplicate companies

```bash
DB=~/sudo-workspace/usefulcrm/api-bridge/crm.duckdb
KEEP_ID="<uuid-to-keep>"
DROP_ID="<uuid-to-drop>"

# Re-link all contacts
duckdb "$DB" "UPDATE contacts SET company_id = '$KEEP_ID' WHERE company_id = '$DROP_ID'"
# Re-link all deals
duckdb "$DB" "UPDATE deals SET company_id = '$KEEP_ID' WHERE company_id = '$DROP_ID'"
# Delete the duplicate company
duckdb "$DB" "DELETE FROM companies WHERE id = '$DROP_ID'"
echo "Merged $DROP_ID into $KEEP_ID"
```

---

## Schema Reference

```sql
CREATE TABLE companies (
  id VARCHAR PRIMARY KEY,
  name VARCHAR NOT NULL,
  domain VARCHAR,
  industry VARCHAR,
  size VARCHAR,       -- e.g. "1-10", "11-50", "51-200", "201-500", "500+"
  location VARCHAR,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

## Tips

- Before creating a company, search by domain to avoid duplicates
- `domain` is the canonical dedup key (e.g. `stripe.com`)
- Link contacts to companies by updating `company_id` on the contact
- Deals and activities inherit the company context via their `contact_id → company_id` chain
