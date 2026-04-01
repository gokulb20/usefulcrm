---
name: data-builder
description: Build data-driven UsefulCRM apps with full CRUD access to workspace objects (.object.yaml tables), DuckDB queries and mutations, data dashboards with Chart.js and D3.js, and interactive tools.
metadata: { "hermes": { "inject": true, "always": true, "emoji": "📊" } }
---

# App Data Builder

This skill covers building data apps that interact with workspace objects and DuckDB. For core app structure and manifest basics, see the parent **app-builder** skill (`app-builder/SKILL.md`).

---

## Objects CRUD API (`objects` permission required)

The `window.useful.objects.*` API provides full CRUD access to workspace objects (`.object.yaml` tables). Add `objects` to your manifest permissions:

```yaml
permissions:
  - objects
```

### List Entries

```javascript
const result = await useful.objects.list("people", {
  search: "john",
  filters: JSON.stringify([{ field: "Status", operator: "eq", value: "Active" }]),
  sort: JSON.stringify({ field: "Full Name", direction: "asc" }),
  page: 1,
  pageSize: 50
});
// Returns { object, fields, entries, totalCount, statuses }
```

Filter operators: `eq`, `neq`, `contains`, `not_contains`, `starts_with`, `ends_with`, `gt`, `gte`, `lt`, `lte`, `is_empty`, `is_not_empty`.

### Get a Single Entry

```javascript
const entry = await useful.objects.get("people", "entry_id_here");
// Returns { entry: { id, fields: { "Full Name": "...", ... }, created_at, updated_at } }
```

### Create an Entry

```javascript
const { entryId } = await useful.objects.create("people", {
  "Full Name": "Jane Doe",
  "Email Address": "jane@example.com",
  "Status": "Active"
});
```

### Update an Entry

```javascript
await useful.objects.update("people", entryId, {
  "Status": "Lead"
});
```

### Delete an Entry

```javascript
await useful.objects.delete("people", entryId);
```

### Bulk Delete Entries

```javascript
await useful.objects.bulkDelete("people", [id1, id2, id3]);
```

### Get Object Schema

```javascript
const schema = await useful.objects.getSchema("people");
// Returns { object, fields, statuses }
```

### Get Relation Options

```javascript
const options = await useful.objects.getOptions("people", "jane");
// Returns filtered list of entries matching query
```

Use this for building relation dropdowns and autocomplete fields that reference entries in other objects.

---

## Database Access (`database` / `database:write` permissions)

The `database` permission grants read-only query access. The `database:write` permission grants full mutation access (INSERT, UPDATE, DELETE, CREATE TABLE, etc.).

```yaml
permissions:
  - database         # SELECT queries only
  - database:write   # SELECT + mutations
```

### Read Queries (`database` permission)

```javascript
const result = await useful.db.query("SELECT * FROM objects");
// Returns { rows: [...] }
```

### Mutations (`database:write` permission)

```javascript
await useful.db.execute("INSERT INTO game_scores (game, score) VALUES ('my-game', 1500)");
await useful.db.execute("CREATE TABLE IF NOT EXISTS app_data (key TEXT PRIMARY KEY, value TEXT)");
await useful.db.execute("UPDATE app_data SET value = 'new' WHERE key = 'setting1'");
await useful.db.execute("DELETE FROM app_data WHERE key = 'old'");
```

### DuckDB Workspace Schema

The workspace database uses an Entity-Attribute-Value (EAV) schema:

| Table | Columns | Description |
|-------|---------|-------------|
| `objects` | id, name, description, icon | Workspace object definitions |
| `fields` | id, object_id, name, type, required, position | Field definitions for each object |
| `entries` | id, object_id, created_at, updated_at | Row entries in each object |
| `entry_fields` | id, entry_id, field_id, value | Individual cell values (EAV) |
| `statuses` | id, object_id, name, color, position | Status options for status-type fields |

**PIVOT views** provide columnar access to object data:

```sql
SELECT * FROM v_people
-- Returns rows with columns like: id, "Full Name", "Email Address", "Status", ...
```

The view name is `v_{object_name}` where the object name is lowercased with spaces replaced by underscores.

### Common Queries

```javascript
// List all objects
const objects = await useful.db.query("SELECT * FROM objects");

// Get entries via PIVOT view
const people = await useful.db.query("SELECT * FROM v_people");

// Aggregate stats
const stats = await useful.db.query(`
  SELECT o.name, COUNT(e.id) as count
  FROM objects o LEFT JOIN entries e ON e.object_id = o.id
  GROUP BY o.name ORDER BY count DESC
`);

// Get field definitions
const fields = await useful.db.query(
  "SELECT * FROM fields WHERE object_id = (SELECT id FROM objects WHERE name = 'people')"
);
```

### Creating App-Specific Tables

Apps can create their own tables for storing app-specific data. Always use `CREATE TABLE IF NOT EXISTS` for idempotency:

```javascript
await useful.db.execute(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY, value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);
```

---

## Data Dashboards & Visualization

### Chart.js Dashboard

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chart Dashboard</title>
  <script src="https://unpkg.com/chart.js@4/dist/chart.umd.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      padding: 24px;
      transition: background 0.2s, color 0.2s;
    }
    body.dark {
      --app-bg: #0f0f1a; --app-surface: #1a1a2e; --app-border: #2a2a45;
      --app-text: #e8e8f0; --app-text-muted: #8888a8; --app-accent: #6366f1;
      background: var(--app-bg); color: var(--app-text);
    }
    body.light {
      --app-bg: #ffffff; --app-surface: #f8f9fa; --app-border: #e2e4e8;
      --app-text: #1a1a2e; --app-text-muted: #6b7280; --app-accent: #6366f1;
      background: var(--app-bg); color: var(--app-text);
    }
    h1 { font-size: 24px; margin-bottom: 24px; }
    .chart-container {
      position: relative;
      height: 400px;
      padding: 20px;
      border-radius: 12px;
      background: var(--app-surface);
      border: 1px solid var(--app-border);
    }
  </style>
</head>
<body>
  <h1>Object Entries</h1>
  <div class="chart-container">
    <canvas id="barChart"></canvas>
  </div>
  <script>
    async function init() {
      try {
        const theme = await window.useful.app.getTheme();
        document.body.className = theme;
      } catch { document.body.className = 'dark'; }

      try {
        const result = await window.useful.db.query(`
          SELECT o.name, COUNT(e.id) as entry_count
          FROM objects o LEFT JOIN entries e ON e.object_id = o.id
          GROUP BY o.name ORDER BY entry_count DESC
        `);

        const isDark = document.body.classList.contains('dark');
        const textColor = isDark ? '#e8e8f0' : '#1a1a2e';
        const gridColor = isDark ? '#2a2a4530' : '#e2e4e830';

        const ctx = document.getElementById('barChart').getContext('2d');
        new Chart(ctx, {
          type: 'bar',
          data: {
            labels: result.rows.map(r => r.name),
            datasets: [{
              label: 'Entries',
              data: result.rows.map(r => r.entry_count),
              backgroundColor: '#6366f180',
              borderColor: '#6366f1',
              borderWidth: 1,
              borderRadius: 6,
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
            },
            scales: {
              y: {
                beginAtZero: true,
                grid: { color: gridColor },
                ticks: { color: textColor },
              },
              x: {
                grid: { display: false },
                ticks: { color: textColor },
              },
            },
          }
        });
      } catch (err) {
        document.querySelector('.chart-container').innerHTML =
          '<p style="color:#ef4444">Error: ' + err.message + '</p>';
      }
    }
    init();
  </script>
</body>
</html>
```

### D3.js Visualization

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>D3 Visualization</title>
  <script src="https://unpkg.com/d3@7/dist/d3.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      padding: 24px;
      transition: background 0.2s, color 0.2s;
    }
    body.dark {
      --app-bg: #0f0f1a; --app-text: #e8e8f0; --app-accent: #6366f1;
      background: var(--app-bg); color: var(--app-text);
    }
    body.light {
      --app-bg: #ffffff; --app-text: #1a1a2e; --app-accent: #6366f1;
      background: var(--app-bg); color: var(--app-text);
    }
    h1 { font-size: 24px; margin-bottom: 24px; }
    #chart { width: 100%; }
    .bar { transition: opacity 0.2s; }
    .bar:hover { opacity: 0.8; }
    .axis text { fill: var(--app-text); font-size: 12px; }
    .axis path, .axis line { stroke: var(--app-text); opacity: 0.2; }
  </style>
</head>
<body>
  <h1>Workspace Overview</h1>
  <div id="chart"></div>
  <script>
    async function init() {
      try {
        const theme = await window.useful.app.getTheme();
        document.body.className = theme;
      } catch { document.body.className = 'dark'; }

      try {
        const result = await window.useful.db.query(`
          SELECT o.name, COUNT(e.id) as count
          FROM objects o LEFT JOIN entries e ON e.object_id = o.id
          GROUP BY o.name ORDER BY count DESC
        `);
        const data = result.rows;

        const margin = { top: 20, right: 20, bottom: 40, left: 60 };
        const width = Math.min(window.innerWidth - 48, 800) - margin.left - margin.right;
        const height = 400 - margin.top - margin.bottom;

        const svg = d3.select('#chart')
          .append('svg')
          .attr('width', width + margin.left + margin.right)
          .attr('height', height + margin.top + margin.bottom)
          .append('g')
          .attr('transform', `translate(${margin.left},${margin.top})`);

        const x = d3.scaleBand()
          .domain(data.map(d => d.name))
          .range([0, width])
          .padding(0.3);

        const y = d3.scaleLinear()
          .domain([0, d3.max(data, d => d.count) || 1])
          .nice()
          .range([height, 0]);

        svg.append('g')
          .attr('class', 'axis')
          .attr('transform', `translate(0,${height})`)
          .call(d3.axisBottom(x));

        svg.append('g')
          .attr('class', 'axis')
          .call(d3.axisLeft(y).ticks(5));

        svg.selectAll('.bar')
          .data(data)
          .join('rect')
          .attr('class', 'bar')
          .attr('x', d => x(d.name))
          .attr('y', d => y(d.count))
          .attr('width', x.bandwidth())
          .attr('height', d => height - y(d.count))
          .attr('rx', 4)
          .attr('fill', '#6366f1');
      } catch (err) {
        document.getElementById('chart').innerHTML =
          '<p style="color:#ef4444">Error: ' + err.message + '</p>';
      }
    }
    init();
  </script>
</body>
</html>
```

### CSS-Only Stat Cards

No charting library needed — use CSS grid and custom properties for simple metric displays:

```html
<div class="stats-grid">
  <div class="stat-card">
    <div class="stat-label">Total Records</div>
    <div class="stat-value" id="total">—</div>
    <div class="stat-change positive">+12% this week</div>
  </div>
  <div class="stat-card">
    <div class="stat-label">Active Users</div>
    <div class="stat-value" id="active">—</div>
    <div class="stat-change positive">+5 today</div>
  </div>
  <div class="stat-card">
    <div class="stat-label">Objects</div>
    <div class="stat-value" id="objects">—</div>
  </div>
</div>
```

```css
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  padding: 24px;
}

.stat-card {
  padding: 20px;
  border-radius: 12px;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
}

.stat-label {
  font-size: 13px;
  color: var(--app-text-muted);
  margin-bottom: 8px;
}

.stat-value {
  font-size: 36px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.stat-change {
  font-size: 12px;
  margin-top: 4px;
}

.stat-change.positive { color: var(--app-success); }
.stat-change.negative { color: var(--app-error); }
```

---

## Interactive Tools & Utilities

### Form-Based Tools

Template for tools that collect input, process it, and display output:

```html
<div class="tool-container">
  <form id="tool-form">
    <div class="field">
      <label for="input">Input</label>
      <textarea id="input" rows="6" placeholder="Paste your data here..."></textarea>
    </div>
    <button type="submit">Process</button>
    <div id="output" class="output-box"></div>
  </form>
</div>
```

```css
.tool-container {
  max-width: 720px;
  margin: 0 auto;
  padding: 24px;
}

.field { margin-bottom: 16px; }

.field label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--app-text-muted);
  margin-bottom: 6px;
}

.field textarea, .field input, .field select {
  width: 100%;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--app-border);
  background: var(--app-surface);
  color: var(--app-text);
  font-size: 14px;
  font-family: inherit;
  resize: vertical;
}

.field textarea:focus, .field input:focus {
  outline: none;
  border-color: var(--app-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--app-accent) 20%, transparent);
}

button[type="submit"] {
  padding: 10px 20px;
  border: none;
  border-radius: 8px;
  background: var(--app-accent);
  color: white;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}

button[type="submit"]:hover { background: var(--app-accent-hover); }

.output-box {
  margin-top: 16px;
  padding: 16px;
  border-radius: 8px;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 13px;
  white-space: pre-wrap;
  max-height: 400px;
  overflow: auto;
}
```

### Kanban / Drag-and-Drop

Use SortableJS for draggable interfaces backed by workspace objects:

```html
<script src="https://unpkg.com/sortablejs@1/Sortable.min.js"></script>
```

```javascript
async function initKanban() {
  const schema = await useful.objects.getSchema("tasks");
  const statuses = schema.statuses || [];

  const board = document.getElementById('board');
  for (const status of statuses) {
    const column = document.createElement('div');
    column.className = 'kanban-column';
    column.dataset.status = status.name;
    column.innerHTML = `
      <div class="column-header" style="border-color: ${status.color}">
        ${status.name}
      </div>
      <div class="column-body" data-status="${status.name}"></div>
    `;
    board.appendChild(column);
  }

  const result = await useful.objects.list("tasks", { pageSize: 200 });
  for (const entry of result.entries) {
    const status = entry.fields["Status"] || statuses[0]?.name;
    const body = board.querySelector(`.column-body[data-status="${status}"]`);
    if (body) {
      const card = document.createElement('div');
      card.className = 'kanban-card';
      card.dataset.id = entry.id;
      card.textContent = entry.fields["Title"] || entry.id;
      body.appendChild(card);
    }
  }

  document.querySelectorAll('.column-body').forEach(col => {
    Sortable.create(col, {
      group: 'tasks',
      animation: 150,
      ghostClass: 'drag-ghost',
      onEnd: async (evt) => {
        const entryId = evt.item.dataset.id;
        const newStatus = evt.to.dataset.status;
        try {
          await useful.objects.update("tasks", entryId, { "Status": newStatus });
        } catch (err) {
          console.error('Failed to update status:', err);
        }
      },
    });
  });
}
```

---

## Patterns

### CRUD Form App Pattern

A complete pattern for a form that creates, reads, updates, and deletes entries in a workspace object:

```javascript
let currentEntries = [];
let editingId = null;

async function loadEntries() {
  const result = await useful.objects.list("tasks", { pageSize: 100 });
  currentEntries = result.entries;
  renderTable(result.entries);
}

function renderTable(entries) {
  const tbody = document.getElementById('entries-body');
  tbody.innerHTML = entries.map(e => `
    <tr>
      <td>${e.fields["Title"] || ''}</td>
      <td>${e.fields["Status"] || ''}</td>
      <td>${new Date(e.created_at).toLocaleDateString()}</td>
      <td>
        <button onclick="editEntry('${e.id}')">Edit</button>
        <button onclick="deleteEntry('${e.id}')">Delete</button>
      </td>
    </tr>
  `).join('');
}

async function createEntry(formData) {
  try {
    const { entryId } = await useful.objects.create("tasks", formData);
    await loadEntries();
    useful.ui.toast("Entry created", { type: "success" });
    resetForm();
  } catch (err) {
    useful.ui.toast("Failed: " + err.message, { type: "error" });
  }
}

async function updateEntry(id, formData) {
  try {
    await useful.objects.update("tasks", id, formData);
    await loadEntries();
    useful.ui.toast("Entry updated", { type: "success" });
    resetForm();
  } catch (err) {
    useful.ui.toast("Failed: " + err.message, { type: "error" });
  }
}

async function deleteEntry(id) {
  if (!confirm('Delete this entry?')) return;
  try {
    await useful.objects.delete("tasks", id);
    await loadEntries();
    useful.ui.toast("Entry deleted", { type: "success" });
  } catch (err) {
    useful.ui.toast("Failed: " + err.message, { type: "error" });
  }
}

function editEntry(id) {
  const entry = currentEntries.find(e => e.id === id);
  if (!entry) return;
  editingId = id;
  document.getElementById('title').value = entry.fields["Title"] || '';
  document.getElementById('status').value = entry.fields["Status"] || '';
  document.getElementById('submit-btn').textContent = 'Update';
}

function resetForm() {
  editingId = null;
  document.getElementById('task-form').reset();
  document.getElementById('submit-btn').textContent = 'Create';
}

document.getElementById('task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = {
    "Title": document.getElementById('title').value,
    "Status": document.getElementById('status').value,
  };
  if (editingId) {
    await updateEntry(editingId, formData);
  } else {
    await createEntry(formData);
  }
});

loadEntries();
```

### Dashboard with Live Refresh

Pattern for an auto-refreshing dashboard that polls for updated data:

```javascript
const REFRESH_INTERVAL = 30000; // 30 seconds
let refreshTimer = null;

async function loadDashboard() {
  try {
    const stats = await useful.db.query(`
      SELECT o.name, COUNT(e.id) as count
      FROM objects o LEFT JOIN entries e ON e.object_id = o.id
      GROUP BY o.name ORDER BY count DESC
    `);

    renderStats(stats.rows);
    document.getElementById('last-updated').textContent =
      'Updated: ' + new Date().toLocaleTimeString();
  } catch (err) {
    console.error('Refresh failed:', err);
  }
}

function startAutoRefresh() {
  loadDashboard();
  refreshTimer = setInterval(loadDashboard, REFRESH_INTERVAL);
}

function stopAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopAutoRefresh();
  } else {
    startAutoRefresh();
  }
});

startAutoRefresh();
```

---

## Full Example: Data Dashboard

A complete workspace dashboard app with stat cards, theme support, and live data from DuckDB.

**`.useful.yaml`:**

```yaml
name: "Dashboard"
description: "Workspace overview dashboard"
icon: "layout-dashboard"
version: "1.0.0"
entry: "index.html"
runtime: "static"
permissions:
  - database
```

**`index.html`:**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Workspace Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
        'Helvetica Neue', Arial, sans-serif;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      padding: 24px;
      transition: background 0.2s, color 0.2s;
    }

    body.dark {
      --app-bg: #0f0f1a;
      --app-surface: #1a1a2e;
      --app-surface-hover: #252540;
      --app-border: #2a2a45;
      --app-text: #e8e8f0;
      --app-text-muted: #8888a8;
      --app-accent: #6366f1;
      --app-success: #22c55e;
      --app-warning: #f59e0b;
      --app-error: #ef4444;
      background: var(--app-bg);
      color: var(--app-text);
    }

    body.light {
      --app-bg: #ffffff;
      --app-surface: #f8f9fa;
      --app-surface-hover: #f0f1f3;
      --app-border: #e2e4e8;
      --app-text: #1a1a2e;
      --app-text-muted: #6b7280;
      --app-accent: #6366f1;
      --app-success: #16a34a;
      --app-warning: #d97706;
      --app-error: #dc2626;
      background: var(--app-bg);
      color: var(--app-text);
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 24px;
    }

    .header h1 { font-size: 24px; font-weight: 700; }

    .header .meta {
      font-size: 13px;
      color: var(--app-text-muted);
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 32px;
    }

    .stat-card {
      padding: 20px;
      border-radius: 12px;
      background: var(--app-surface);
      border: 1px solid var(--app-border);
      transition: background 0.15s;
    }

    .stat-card:hover {
      background: var(--app-surface-hover);
    }

    .stat-label {
      font-size: 13px;
      color: var(--app-text-muted);
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .stat-value {
      font-size: 36px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }

    .objects-table {
      width: 100%;
      border-collapse: collapse;
      background: var(--app-surface);
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid var(--app-border);
    }

    .objects-table th {
      text-align: left;
      padding: 12px 16px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--app-text-muted);
      border-bottom: 1px solid var(--app-border);
    }

    .objects-table td {
      padding: 12px 16px;
      font-size: 14px;
      border-bottom: 1px solid var(--app-border);
    }

    .objects-table tr:last-child td { border-bottom: none; }

    .objects-table tr:hover td {
      background: var(--app-surface-hover);
    }

    .error-box {
      padding: 16px;
      background: color-mix(in srgb, var(--app-error) 10%, transparent);
      border: 1px solid color-mix(in srgb, var(--app-error) 30%, transparent);
      border-radius: 8px;
      color: var(--app-error);
      font-size: 14px;
    }

    .empty-state {
      text-align: center;
      padding: 48px 24px;
      color: var(--app-text-muted);
      font-size: 15px;
    }

    .loading {
      text-align: center;
      padding: 48px 24px;
      color: var(--app-text-muted);
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Workspace Dashboard</h1>
    <div class="meta" id="last-updated"></div>
  </div>
  <div class="stats-grid" id="stats"></div>
  <div id="table-container">
    <div class="loading">Loading workspace data...</div>
  </div>
  <script>
    async function init() {
      try {
        const theme = await window.useful.app.getTheme();
        document.body.className = theme;
      } catch {
        document.body.className = 'dark';
      }

      await loadDashboard();
    }

    async function loadDashboard() {
      try {
        const result = await window.useful.db.query(`
          SELECT o.name, o.description, o.icon, COUNT(e.id) as entry_count
          FROM objects o
          LEFT JOIN entries e ON e.object_id = o.id
          GROUP BY o.name, o.description, o.icon
          ORDER BY entry_count DESC
        `);

        const rows = result.rows || [];
        const totalObjects = rows.length;
        const totalEntries = rows.reduce((sum, r) => sum + (r.entry_count || 0), 0);

        const statsEl = document.getElementById('stats');
        statsEl.innerHTML = `
          <div class="stat-card">
            <div class="stat-label">Objects</div>
            <div class="stat-value">${totalObjects}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Total Entries</div>
            <div class="stat-value">${totalEntries.toLocaleString()}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Avg Entries / Object</div>
            <div class="stat-value">${totalObjects ? Math.round(totalEntries / totalObjects) : 0}</div>
          </div>
        `;

        const tableContainer = document.getElementById('table-container');
        if (rows.length === 0) {
          tableContainer.innerHTML = '<div class="empty-state">No objects in workspace yet.</div>';
        } else {
          tableContainer.innerHTML = `
            <table class="objects-table">
              <thead>
                <tr>
                  <th>Object</th>
                  <th>Description</th>
                  <th>Entries</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map(r => `
                  <tr>
                    <td><strong>${r.name}</strong></td>
                    <td style="color: var(--app-text-muted)">${r.description || '—'}</td>
                    <td>${r.entry_count || 0}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `;
        }

        document.getElementById('last-updated').textContent =
          'Updated ' + new Date().toLocaleTimeString();
      } catch (err) {
        document.getElementById('stats').innerHTML = '';
        document.getElementById('table-container').innerHTML =
          '<div class="error-box">Error loading data: ' + err.message + '</div>';
      }
    }

    init();
  </script>
</body>
</html>
```
