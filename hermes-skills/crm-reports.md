---
name: crm-reports
description: Generate CRM reports — pipeline summary, activity stats, contact growth, deal velocity — via DuckDB queries against crm.duckdb.
version: 1.0.0
---

# CRM Reports

All reports query `crm.duckdb` directly. Run these commands against the database to generate reports, then format output as needed (JSON, CSV, markdown table).

```bash
DB=~/sudo-workspace/usefulcrm/api-bridge/crm.duckdb
```

---

## Pipeline Report

```bash
# Full pipeline by stage (count + value + weighted forecast)
duckdb "$DB" -json "
  SELECT
    stage,
    COUNT(*) as deal_count,
    SUM(amount::NUMERIC) as total_value,
    SUM(amount::NUMERIC * probability::NUMERIC / 100) as weighted_value,
    ROUND(AVG(probability::NUMERIC), 1) as avg_probability
  FROM deals
  WHERE stage NOT IN ('Closed Won', 'Closed Lost')
  GROUP BY stage
  ORDER BY total_value DESC
"

# Total pipeline and forecast
duckdb "$DB" -json "
  SELECT
    COUNT(*) as total_deals,
    SUM(amount::NUMERIC) as pipeline_total,
    SUM(amount::NUMERIC * probability::NUMERIC / 100) as weighted_forecast,
    MIN(close_date) as earliest_close,
    MAX(close_date) as latest_close
  FROM deals
  WHERE stage NOT IN ('Closed Won', 'Closed Lost')
"

# Deals by sales rep (if assigned)
duckdb "$DB" -json "
  SELECT
    assigned_to,
    COUNT(*) as deals,
    SUM(amount::NUMERIC) as pipeline
  FROM deals
  WHERE stage NOT IN ('Closed Won', 'Closed Lost')
  GROUP BY assigned_to
  ORDER BY pipeline DESC
"
```

---

## Revenue Report

```bash
# Won revenue by month (YTD)
duckdb "$DB" -json "
  SELECT
    DATE_TRUNC('month', closed_at) as month,
    COUNT(*) as deals_won,
    SUM(amount::NUMERIC) as revenue
  FROM deals
  WHERE stage = 'Closed Won'
    AND closed_at >= DATE_TRUNC('year', now())
  GROUP BY month
  ORDER BY month ASC
"

# Win rate and average deal size
duckdb "$DB" -json "
  SELECT
    COUNT(*) FILTER (WHERE stage = 'Closed Won') as won,
    COUNT(*) FILTER (WHERE stage = 'Closed Lost') as lost,
    ROUND(100.0 * COUNT(*) FILTER (WHERE stage = 'Closed Won') /
          NULLIF(COUNT(*) FILTER (WHERE stage IN ('Closed Won', 'Closed Lost')), 0), 1) as win_rate_pct,
    ROUND(AVG(amount::NUMERIC) FILTER (WHERE stage = 'Closed Won'), 0) as avg_deal_size
  FROM deals
"

# Revenue by company (top 10)
duckdb "$DB" -json "
  SELECT
    co.name as company,
    SUM(d.amount::NUMERIC) as total_revenue,
    COUNT(*) as deals_won
  FROM deals d
  JOIN companies co ON d.company_id = co.id
  WHERE d.stage = 'Closed Won'
  GROUP BY co.name
  ORDER BY total_revenue DESC
  LIMIT 10
"
```

---

## Activity Report

```bash
# Activity volume by type (last 30 days)
duckdb "$DB" -json "
  SELECT type, COUNT(*) as count
  FROM activities
  WHERE occurred_at >= now() - INTERVAL 30 DAY
  GROUP BY type
  ORDER BY count DESC
"

# Daily activity trend (last 14 days)
duckdb "$DB" -json "
  SELECT
    DATE_TRUNC('day', occurred_at) as day,
    COUNT(*) as activities
  FROM activities
  WHERE occurred_at >= now() - INTERVAL 14 DAY
  GROUP BY day
  ORDER BY day ASC
"

# Most active reps/users
duckdb "$DB" -json "
  SELECT
    c.name as contact,
    COUNT(a.id) as activities_logged,
    MAX(a.occurred_at) as last_activity
  FROM activities a
  JOIN contacts c ON a.contact_id = c.id
  WHERE a.occurred_at >= now() - INTERVAL 30 DAY
  GROUP BY c.name
  ORDER BY activities_logged DESC
  LIMIT 10
"
```

---

## Contact Report

```bash
# New contacts by month
duckdb "$DB" -json "
  SELECT
    DATE_TRUNC('month', created_at) as month,
    COUNT(*) as new_contacts
  FROM contacts
  GROUP BY month
  ORDER BY month DESC
  LIMIT 12
"

# Contacts by company size
duckdb "$DB" -json "
  SELECT
    co.size,
    COUNT(c.id) as contacts
  FROM contacts c
  JOIN companies co ON c.company_id = co.id
  GROUP BY co.size
  ORDER BY contacts DESC
"

# Contacts with no deals (unworked leads)
duckdb "$DB" -json "
  SELECT c.name, c.email, c.created_at
  FROM contacts c
  LEFT JOIN deals d ON d.contact_id = c.id
  WHERE d.id IS NULL
  ORDER BY c.created_at DESC
"

# At-risk contacts (no activity in 60+ days)
duckdb "$DB" -json "
  SELECT
    c.name, c.email,
    MAX(a.occurred_at) as last_activity,
    DATE_DIFF('day', MAX(a.occurred_at), now()) as days_since
  FROM contacts c
  LEFT JOIN activities a ON a.contact_id = c.id
  GROUP BY c.name, c.email
  HAVING MAX(a.occurred_at) < now() - INTERVAL 60 DAY OR MAX(a.occurred_at) IS NULL
  ORDER BY days_since DESC
"
```

---

## Deal Velocity Report

```bash
# Average time to close (days) by stage path
duckdb "$DB" -json "
  SELECT
    stage,
    ROUND(AVG(DATE_DIFF('day', created_at, closed_at)), 1) as avg_days_to_close
  FROM deals
  WHERE stage = 'Closed Won' AND closed_at IS NOT NULL
  GROUP BY stage
"

# Deals stalled (no activity in 14+ days)
duckdb "$DB" -json "
  SELECT
    d.name, d.stage, d.amount,
    MAX(a.occurred_at) as last_activity,
    DATE_DIFF('day', MAX(a.occurred_at), now()) as days_stalled
  FROM deals d
  LEFT JOIN activities a ON a.deal_id = d.id
  WHERE d.stage NOT IN ('Closed Won', 'Closed Lost')
  GROUP BY d.name, d.stage, d.amount
  HAVING MAX(a.occurred_at) < now() - INTERVAL 14 DAY OR MAX(a.occurred_at) IS NULL
  ORDER BY days_stalled DESC
"
```

---

## Export Report to CSV

```bash
# Export pipeline to CSV
duckdb "$DB" -csv "
  SELECT d.name, d.stage, d.amount, d.close_date, c.name as contact, co.name as company
  FROM deals d
  LEFT JOIN contacts c ON d.contact_id = c.id
  LEFT JOIN companies co ON d.company_id = co.id
  WHERE d.stage NOT IN ('Closed Won', 'Closed Lost')
  ORDER BY d.close_date
" > ~/Downloads/pipeline-$(date +%Y-%m-%d).csv

echo "Exported to ~/Downloads/pipeline-$(date +%Y-%m-%d).csv"
```

## Tips

- Use `-json` flag for structured output, `-csv` for spreadsheet export, `-markdown` for formatted tables
- All numeric fields (amount, probability) require `::NUMERIC` cast in aggregations
- `DATE_DIFF('day', a, b)` computes day difference in DuckDB
- Use `DATE_TRUNC('month', ...)` for monthly grouping in trend reports
