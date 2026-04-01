---
name: crm-activities
description: Log and query CRM activities and interactions — calls, emails, meetings, notes — via the UsefulCRM API bridge or DuckDB.
version: 1.0.0
---

# CRM Activities

Activities are logged interactions stored in the `activities` table of `crm.duckdb`. Every touchpoint with a contact should be logged here — calls, emails, meetings, demos, notes.

## Activity Types

- `call` — Phone or video call
- `email` — Email sent or received
- `meeting` — In-person or virtual meeting
- `demo` — Product demo
- `note` — Internal note or memo
- `task` — Follow-up task or to-do

---

## API Bridge: http://localhost:3200

### Log an activity
```bash
curl -s -X POST "http://localhost:3200/api/activities" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "call",
    "title": "Discovery call with Jane",
    "contact_id": "<contact_uuid>",
    "deal_id": "<deal_uuid>",
    "notes": "Discussed pricing. She wants a 20% discount. Following up Friday.",
    "occurred_at": "2026-04-01T14:30:00Z",
    "duration_minutes": 45
  }' | jq .
```

### List activities
```bash
# All activities (recent first)
curl -s "http://localhost:3200/api/activities?limit=50" | jq .
# Filter by contact
curl -s "http://localhost:3200/api/activities?contact_id=<id>" | jq .
# Filter by deal
curl -s "http://localhost:3200/api/activities?deal_id=<id>" | jq .
# Filter by type
curl -s "http://localhost:3200/api/activities?type=call" | jq .
```

---

## Direct DuckDB Queries

```bash
DB=~/sudo-workspace/usefulcrm/api-bridge/crm.duckdb

# All activities for a contact (most recent first)
duckdb "$DB" -json "
  SELECT a.type, a.title, a.notes, a.occurred_at, a.duration_minutes
  FROM activities a
  WHERE a.contact_id = '<contact_id>'
  ORDER BY a.occurred_at DESC
"

# All activities for a deal
duckdb "$DB" -json "
  SELECT a.type, a.title, a.notes, a.occurred_at,
         c.name as contact_name
  FROM activities a
  LEFT JOIN contacts c ON a.contact_id = c.id
  WHERE a.deal_id = '<deal_id>'
  ORDER BY a.occurred_at DESC
"

# Activity count by type (last 30 days)
duckdb "$DB" -json "
  SELECT type, COUNT(*) as count
  FROM activities
  WHERE occurred_at >= now() - INTERVAL 30 DAY
  GROUP BY type
  ORDER BY count DESC
"

# Most active contacts (by activity count)
duckdb "$DB" -json "
  SELECT c.name, c.email, COUNT(a.id) as activity_count,
         MAX(a.occurred_at) as last_contact
  FROM activities a
  JOIN contacts c ON a.contact_id = c.id
  GROUP BY c.name, c.email
  ORDER BY activity_count DESC
  LIMIT 20
"

# Contacts with no activity in last 60 days (at-risk)
duckdb "$DB" -json "
  SELECT c.name, c.email, MAX(a.occurred_at) as last_activity
  FROM contacts c
  LEFT JOIN activities a ON a.contact_id = c.id
  GROUP BY c.name, c.email
  HAVING MAX(a.occurred_at) < now() - INTERVAL 60 DAY
     OR MAX(a.occurred_at) IS NULL
  ORDER BY last_activity ASC
"

# Activity timeline for a company (all contacts)
duckdb "$DB" -json "
  SELECT a.type, a.title, a.occurred_at, c.name as contact
  FROM activities a
  JOIN contacts c ON a.contact_id = c.id
  WHERE c.company_id = '<company_id>'
  ORDER BY a.occurred_at DESC
  LIMIT 50
"

# Total call time logged (minutes)
duckdb "$DB" -json "
  SELECT SUM(duration_minutes) as total_minutes,
         COUNT(*) as call_count
  FROM activities
  WHERE type = 'call'
    AND occurred_at >= DATE_TRUNC('month', now())
"
```

---

## Log a Stage Change (as Activity)

When a deal moves stages, log it as an activity:

```bash
curl -s -X POST "http://localhost:3200/api/activities" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "note",
    "title": "Stage moved: Proposal → Negotiation",
    "deal_id": "<deal_id>",
    "contact_id": "<contact_id>",
    "notes": "Client accepted proposal, now negotiating contract terms.",
    "occurred_at": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
  }' | jq .
```

---

## Schema Reference

```sql
CREATE TABLE activities (
  id VARCHAR PRIMARY KEY,
  type VARCHAR NOT NULL,        -- call, email, meeting, demo, note, task
  title VARCHAR NOT NULL,
  contact_id VARCHAR REFERENCES contacts(id),
  deal_id VARCHAR REFERENCES deals(id),
  notes TEXT,
  occurred_at TIMESTAMPTZ DEFAULT now(),
  duration_minutes INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

## Tips

- Log every meaningful touchpoint — even short emails
- Set `occurred_at` to the actual time of the interaction, not now()
- Link activities to both `contact_id` AND `deal_id` when applicable
- Use the `crm-auto-log` skill to automate logging from email/calendar
