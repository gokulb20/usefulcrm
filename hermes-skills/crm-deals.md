---
name: crm-deals
description: Manage CRM deals — create, update stage, track pipeline, and forecast revenue via the UsefulCRM API bridge or DuckDB.
version: 1.0.0
---

# CRM Deals

Deals track sales opportunities. Stored in the `deals` table of `crm.duckdb`. Linked to contacts, companies, and activities.

## Deal Stages

Default stages (from `deal_stages` table):
- **Discovery** — Initial qualification
- **Proposal** — Proposal sent
- **Negotiation** — In active negotiation
- **Closed Won** — Won
- **Closed Lost** — Lost

```bash
# List all configured stages
curl -s "http://localhost:3200/api/deal-stages" | jq .
```

---

## API Bridge: http://localhost:3200

### List deals
```bash
# All deals
curl -s "http://localhost:3200/api/deals?limit=50" | jq .
# Filter by stage
curl -s "http://localhost:3200/api/deals?stage=Negotiation" | jq .
# Filter by company
curl -s "http://localhost:3200/api/deals?company_id=<id>" | jq .
```

### Create a deal
```bash
curl -s -X POST "http://localhost:3200/api/deals" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Acme Corp — Enterprise License",
    "amount": 48000,
    "stage": "Proposal",
    "contact_id": "<contact_uuid>",
    "company_id": "<company_uuid>",
    "close_date": "2026-06-30",
    "probability": 60,
    "notes": "Annual contract, 50 seats"
  }' | jq .
```

### Update deal stage
```bash
curl -s -X PUT "http://localhost:3200/api/deals/<id>" \
  -H "Content-Type: application/json" \
  -d '{"stage": "Negotiation", "probability": 80}' | jq .
```

### Close a deal (won/lost)
```bash
# Won
curl -s -X PUT "http://localhost:3200/api/deals/<id>" \
  -H "Content-Type: application/json" \
  -d '{"stage": "Closed Won", "probability": 100, "closed_at": "2026-05-01"}' | jq .

# Lost
curl -s -X PUT "http://localhost:3200/api/deals/<id>" \
  -H "Content-Type: application/json" \
  -d '{"stage": "Closed Lost", "probability": 0, "lost_reason": "Budget cut"}' | jq .
```

---

## Direct DuckDB Queries

```bash
DB=~/sudo-workspace/usefulcrm/api-bridge/crm.duckdb

# Full pipeline view
duckdb "$DB" -json "
  SELECT d.name, d.stage, d.amount::NUMERIC as amount, d.probability::NUMERIC as prob,
         d.close_date, c.name as contact, co.name as company
  FROM deals d
  LEFT JOIN contacts c ON d.contact_id = c.id
  LEFT JOIN companies co ON d.company_id = co.id
  WHERE d.stage NOT IN ('Closed Won', 'Closed Lost')
  ORDER BY d.close_date ASC
"

# Pipeline value by stage
duckdb "$DB" -json "
  SELECT stage,
         COUNT(*) as deal_count,
         SUM(amount::NUMERIC) as total_value,
         ROUND(AVG(probability::NUMERIC), 1) as avg_probability
  FROM deals
  WHERE stage NOT IN ('Closed Won', 'Closed Lost')
  GROUP BY stage
  ORDER BY total_value DESC
"

# Weighted forecast (amount × probability)
duckdb "$DB" -json "
  SELECT stage,
         SUM(amount::NUMERIC * probability::NUMERIC / 100) as weighted_value
  FROM deals
  WHERE stage NOT IN ('Closed Won', 'Closed Lost')
  GROUP BY stage
"

# Won revenue by month
duckdb "$DB" -json "
  SELECT DATE_TRUNC('month', closed_at) as month,
         COUNT(*) as deals_won,
         SUM(amount::NUMERIC) as revenue
  FROM deals
  WHERE stage = 'Closed Won'
  GROUP BY month
  ORDER BY month DESC
"

# Deals closing this month
duckdb "$DB" -json "
  SELECT name, stage, amount, close_date, probability
  FROM deals
  WHERE close_date BETWEEN DATE_TRUNC('month', now()) AND DATE_TRUNC('month', now()) + INTERVAL 1 MONTH
    AND stage NOT IN ('Closed Won', 'Closed Lost')
  ORDER BY close_date
"

# Win rate by quarter
duckdb "$DB" -json "
  SELECT DATE_TRUNC('quarter', closed_at) as quarter,
         COUNT(*) FILTER (WHERE stage = 'Closed Won') as won,
         COUNT(*) FILTER (WHERE stage = 'Closed Lost') as lost,
         ROUND(100.0 * COUNT(*) FILTER (WHERE stage = 'Closed Won') / COUNT(*), 1) as win_rate_pct
  FROM deals
  WHERE stage IN ('Closed Won', 'Closed Lost')
  GROUP BY quarter
  ORDER BY quarter DESC
"

# Average deal size by source (if source tracked on contact)
duckdb "$DB" -json "
  SELECT AVG(d.amount::NUMERIC) as avg_deal_size, COUNT(*) as deals
  FROM deals d
  WHERE d.stage = 'Closed Won'
"
```

---

## Schema Reference

```sql
CREATE TABLE deals (
  id VARCHAR PRIMARY KEY,
  name VARCHAR NOT NULL,
  amount NUMERIC,
  stage VARCHAR,           -- references deal_stages
  contact_id VARCHAR REFERENCES contacts(id),
  company_id VARCHAR REFERENCES companies(id),
  close_date DATE,
  closed_at TIMESTAMPTZ,
  probability INTEGER,     -- 0-100
  lost_reason VARCHAR,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

## Tips

- Always set `company_id` AND `contact_id` — orphan deals are hard to find later
- `probability` should reflect deal confidence (0-100), not stage default
- Use weighted forecast (`amount × probability / 100`) for realistic pipeline views
- Log every stage change as an activity using the `crm-activities` skill
