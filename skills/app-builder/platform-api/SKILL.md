---
name: platform-api
description: Platform API reference for UsefulCRM apps — UI integration, per-app storage, HTTP proxy, real-time events, inter-app messaging, cron scheduling, webhooks, clipboard, context, and widget mode.
metadata: { "hermes": { "inject": true, "always": true, "emoji": "⚡" } }
---

# App Platform API

This skill documents the platform-level APIs available to UsefulCRM apps. For core app structure, see the parent **app-builder** skill. For data/objects, see **data-builder**. For AI chat, see **agent-builder**.

## UI Integration (`ui` permission required)

```javascript
// Show a toast notification in the parent UsefulCRM UI
await useful.ui.toast("Record saved successfully", { type: "success" });
await useful.ui.toast("Something went wrong", { type: "error" });
await useful.ui.toast("Processing...", { type: "info" });

// Navigate UsefulCRM to a workspace path (opens object, file, or app)
await useful.ui.navigate("/people");           // open the people object
await useful.ui.navigate("/apps/my-app.useful.app"); // open another app

// Open an entry detail modal
await useful.ui.openEntry("people", "entry_id_here");

// Update the app's tab title dynamically
await useful.ui.setTitle("My App — 5 results");

// Show a confirmation dialog
const confirmed = await useful.ui.confirm("Delete this record?");
if (confirmed) { /* proceed */ }

// Show a prompt dialog
const name = await useful.ui.prompt("Enter a name:", "Default Name");
if (name !== null) { /* use name */ }
```

## Per-App KV Store (`store` permission required)

Persistent key-value storage scoped to each app. Data survives app reloads and is stored in the workspace.

```javascript
// Store a value (any JSON-serializable value)
await useful.store.set("lastQuery", { sql: "SELECT * FROM people", timestamp: Date.now() });
await useful.store.set("theme", "custom-dark");
await useful.store.set("counter", 42);

// Read a value
const lastQuery = await useful.store.get("lastQuery");
// Returns the value, or null if not found

// Delete a key
await useful.store.delete("lastQuery");

// List all keys
const keys = await useful.store.list();
// Returns ["theme", "counter"]

// Clear all stored data
await useful.store.clear();
```

Storage is backed by a JSON file at `{workspace}/.useful-app-data/{appName}/store.json`. Each app gets its own isolated namespace.

## HTTP Proxy (`http` permission required)

Make HTTP requests from apps without CORS restrictions. Requests are proxied through the UsefulCRM server.

```javascript
// Simple GET
const data = await useful.http.fetch("https://api.example.com/data");
// Returns { status, statusText, headers, body }

// POST with headers and body
const result = await useful.http.fetch("https://api.example.com/submit", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer sk-..."
  },
  body: JSON.stringify({ query: "test" })
});

console.log(result.status);  // 200
console.log(result.body);    // response body as string
```

Security: requests to localhost, private IPs, and internal UsefulCRM URLs are blocked.

## Real-time Events (`events` permission required)

Subscribe to workspace events for live updates.

```javascript
// Subscribe to theme changes
useful.events.on("theme.changed", (data) => {
  document.body.className = data.theme;
});

// Subscribe to object entry changes
useful.events.on("object.entry.created", (data) => {
  console.log(`New entry in ${data.objectName}: ${data.entryId}`);
  refreshList();
});

useful.events.on("object.entry.updated", (data) => {
  console.log(`Entry ${data.entryId} updated in ${data.objectName}`);
});

useful.events.on("object.entry.deleted", (data) => {
  console.log(`Entry ${data.entryId} deleted from ${data.objectName}`);
});

// App visibility events
useful.events.on("app.visible", () => { resumeAnimations(); });
useful.events.on("app.hidden", () => { pauseAnimations(); });

// File change events
useful.events.on("file.changed", (data) => {
  console.log(`File changed: ${data.path}`);
});

// Unsubscribe
useful.events.off("theme.changed");
```

## Context (no permission required)

```javascript
// Get workspace info
const workspace = await useful.context.getWorkspace();
// Returns { name, path, agentId }

// Get app info
const app = await useful.context.getAppInfo();
// Returns { appPath, folderName, permissions, manifest }
```

## Inter-App Messaging (`apps` permission required)

Apps can communicate with other open apps for composite workflows.

```javascript
// Send a message to another app
await useful.apps.send("analytics-dashboard.useful.app", {
  action: "refresh",
  filter: { status: "Active" }
});

// Listen for messages from other apps
useful.apps.on("message", (event) => {
  console.log(`Message from ${event.from}:`, event.message);
  if (event.message.action === "refresh") {
    reloadData(event.message.filter);
  }
});

// List currently active (open) apps
const activeApps = await useful.apps.list();
// Returns [{ name: "analytics-dashboard.useful.app", manifest: {...} }, ...]
```

## Cron Scheduling (`cron` permission required)

Schedule recurring tasks that send messages to the agent.

```javascript
// Schedule a cron job
const { jobId } = await useful.cron.schedule({
  expression: "0 9 * * *",          // 9 AM daily
  message: "Generate the daily sales report and save it to workspace",
  channel: "announce"                 // "announce" (delivers result) or "none" (silent)
});

// List all cron jobs
const jobs = await useful.cron.list();
// Returns array of { id, expression, message, enabled, nextRunAt, ... }

// Run a job immediately
await useful.cron.run(jobId);

// Cancel/remove a job
await useful.cron.cancel(jobId);
```

## Webhooks (`webhooks` permission required)

Receive external HTTP webhooks inside your app.

```javascript
// Register a webhook endpoint
const hook = await useful.webhooks.register("github-push");
console.log(hook.url);
// e.g. "https://your-usefulcrm-host/api/apps/webhooks/my-app.useful.app/github-push"

// Listen for incoming webhooks
useful.webhooks.on("github-push", (payload) => {
  console.log("Received webhook:", payload);
  // payload: { method: "POST", headers: {...}, body: "...", receivedAt: 1234567890 }
  processGithubPush(JSON.parse(payload.body));
});

// Poll for webhooks (useful for catching events received while app was closed)
const events = await useful.webhooks.poll("github-push", { since: lastTimestamp });
```

## Clipboard (`clipboard` permission required)

```javascript
// Write to clipboard
await useful.clipboard.write("Copied text content");

// Read from clipboard
const text = await useful.clipboard.read();
```

Note: clipboard operations are proxied through the parent UsefulCRM window.

## Widget Mode

Apps can render as compact widgets in a dashboard grid instead of full-page tabs.

### Manifest Configuration

```yaml
name: "Quick Stats"
display: "widget"
widget:
  width: 2              # Grid columns (1-4)
  height: 1             # Grid rows (1-4)
  refreshInterval: 60   # Auto-refresh in seconds (optional)
permissions:
  - database
```

### Widget Design Guidelines

- Keep the UI compact — widgets have limited space
- Use large, readable numbers and minimal text
- Avoid scroll bars — all content should be visible
- Support both light and dark themes
- Use the refresh interval for auto-updating data

### Widget Example

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, sans-serif;
      padding: 16px;
      height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    body.dark { background: #0f0f1a; color: #e8e8f0; }
    body.light { background: #fff; color: #1a1a2e; }
    .metric { font-size: 48px; font-weight: 700; }
    .label { font-size: 13px; opacity: 0.6; margin-bottom: 4px; }
  </style>
</head>
<body>
  <div class="label">Total Records</div>
  <div class="metric" id="count">—</div>
  <script>
    async function init() {
      const theme = await useful.app.getTheme().catch(() => "dark");
      document.body.className = theme;
      
      const result = await useful.db.query("SELECT SUM(entry_count) as total FROM objects");
      document.getElementById("count").textContent = result.rows[0]?.total ?? 0;
    }
    init();
  </script>
</body>
</html>
```

Widget-mode apps appear in the UsefulCRM dashboard view alongside other widgets, arranged in a responsive grid.

## Patterns

### Multi-App Dashboard

Build a dashboard that aggregates data from multiple widget apps:

```javascript
// In the main dashboard app
async function loadWidgetData() {
  const apps = await useful.apps.list();
  const widgets = apps.filter(a => a.manifest.display === "widget");
  
  for (const widget of widgets) {
    // Request data from each widget app
    await useful.apps.send(widget.name, { action: "getData" });
  }
}

useful.apps.on("message", (event) => {
  if (event.message.action === "dataResponse") {
    updateDashboardPanel(event.from, event.message.data);
  }
});
```

### External API Integration

```javascript
// Fetch data from an external API via proxy
async function loadWeather(city) {
  const result = await useful.http.fetch(
    `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=YOUR_KEY`
  );
  if (result.status === 200) {
    const weather = JSON.parse(result.body);
    displayWeather(weather);
  }
}
```

### Automation Workflow

```javascript
// Set up a cron job that processes data and sends results
async function setupAutomation() {
  const { jobId } = await useful.cron.schedule({
    expression: "0 */6 * * *",
    message: "Check the tasks object for overdue items and send a summary to Telegram"
  });
  
  await useful.store.set("automationJobId", jobId);
  useful.ui.toast("Automation scheduled every 6 hours", { type: "success" });
}
```
