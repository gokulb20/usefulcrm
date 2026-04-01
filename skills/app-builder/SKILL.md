---
name: app-builder
description: Build and manage UsefulCRM apps — self-contained web applications that run inside the workspace with access to DuckDB data, workspace objects, AI chat, and the full UsefulCRM platform API.
metadata: { "hermes": { "inject": true, "always": true, "emoji": "🔨" } }
---

# App Builder

You can build **Useful Apps** — self-contained web applications that run inside UsefulCRM's workspace. Apps appear in the sidebar with their own icon and name, and open as tabs in the main content area. They run in a sandboxed iframe with `allow-same-origin allow-scripts allow-popups allow-forms`.

---

## Table of Contents

1. [App Structure](#app-structure)
2. [Manifest Reference](#manifest-reference)
3. [Bridge API Overview](#bridge-api-overview)
4. [Theme & Styling System](#theme--styling-system)
5. [Loading External Libraries via CDN](#loading-external-libraries-via-cdn)
6. [Multi-File App Organization](#multi-file-app-organization)
7. [Asset Management](#asset-management)
8. [Performance & Best Practices](#performance--best-practices)
9. [Error Handling Patterns](#error-handling-patterns)
10. [Creating an App — Step by Step Checklist](#creating-an-app--step-by-step-checklist)
11. [Child Skills](#child-skills)

---

## App Structure

Every app is a folder ending in `.useful.app/`. The default location is `{{WORKSPACE_PATH}}/apps/`, but apps can live anywhere in the workspace.

```
apps/
  my-app.useful.app/
    .useful.yaml          # Required manifest
    index.html           # Entry point
    style.css            # Styles (optional, can inline)
    app.js               # Logic (optional, can inline)
    assets/              # Images, sounds, models, etc.
      sprite.png
      bg-music.mp3
    lib/                 # Vendored libraries (optional)
      p5.min.js
```

### Critical Rules

- The folder name MUST end with `.useful.app`
- The `.useful.yaml` manifest is REQUIRED inside every `.useful.app` folder
- The entry HTML file gets the bridge SDK (`window.useful`) auto-injected before `</head>`
- All file paths within the app are relative to the `.useful.app` folder root
- The app is served at `/api/apps/serve/<appPath>/<filePath>` — relative references (CSS, JS, images) resolve correctly
- Apps run in an iframe sandbox: `allow-same-origin allow-scripts allow-popups allow-forms`

---

## Manifest Reference

Every `.useful.app` folder MUST contain a `.useful.yaml` manifest.

### Full Schema

```yaml
name: "My App"                    # Required. Display name shown in sidebar and tab bar
description: "What this app does" # Optional. Shown in tooltips and app info
icon: "gamepad-2"                 # Optional. Lucide icon name OR relative path to image
version: "1.0.0"                  # Optional. Shown as badge in app header
author: "agent"                   # Optional. Creator attribution
entry: "index.html"               # Optional. Main entry point (default: index.html)
runtime: "static"                 # Optional. static | esbuild | build (default: static)

display: "full"                   # Optional. "full" (default) | "widget"
widget:                           # Only used when display: "widget"
  width: 2                        # Grid columns (1-4)
  height: 1                       # Grid rows (1-4)
  refreshInterval: 60             # Auto-refresh seconds (optional)

permissions:                      # Optional. List of bridge API permissions
  - database                      # db.query (SELECT only)
  - database:write                # db.execute (INSERT/UPDATE/DELETE/CREATE)
  - objects                       # objects.* CRUD on workspace tables
  - files                         # files.read, files.list
  - files:write                   # files.write, files.delete, files.mkdir
  - agent                         # chat.*, agent.send, tool.register, memory.get
  - ui                            # ui.toast, ui.navigate, ui.openEntry, etc.
  - store                         # store.* per-app KV storage
  - http                          # http.fetch CORS proxy
  - events                        # events.on/off real-time subscriptions
  - apps                          # apps.send/on inter-app messaging
  - cron                          # cron.schedule/list/cancel
  - webhooks                      # webhooks.register/on
  - clipboard                     # clipboard.read/write

tools:                            # Optional. Expose app functions as agent-invokable tools
  - name: "my-tool"
    description: "What this tool does"
    inputSchema:
      type: object
      properties:
        input: { type: string }
      required: ["input"]
```

### Runtime Modes

| Mode | When to Use | How It Works |
|------|-------------|--------------|
| `static` | Vanilla HTML/CSS/JS apps, CDN-loaded libraries, games, dashboards | Serves files directly. **Use this by default for everything.** |
| `esbuild` | React/TSX apps without npm dependencies | Server-side esbuild transpiles JSX/TSX on load. Requires `esbuild.entry` and `esbuild.jsx` fields. |
| `build` | Complex apps with npm dependencies (rare) | Runs `build.install` then `build.command`. Serves from `build.output` directory. |

**Always default to `static` runtime.** It handles p5.js, Three.js, D3.js, Chart.js, and any CDN-loaded library perfectly. Only use `esbuild` or `build` when the user explicitly asks for React/TSX or npm-based tooling.

### Icon Support

The `icon` field accepts:

1. **A Lucide icon name** (string): `"gamepad-2"`, `"bar-chart-3"`, `"users"`, `"rocket"`, `"calculator"`, `"box"`, `"palette"`
2. **A relative path** to a square image file: `"icon.png"`, `"assets/logo.svg"`

Supported image formats: PNG, SVG, JPG, JPEG, WebP. Use square aspect ratio (128x128px or larger).

### Choosing Permissions

| Permission | Grants | Use When |
|------------|--------|----------|
| `database` | `useful.db.query()` | App reads workspace DuckDB data (SELECT) |
| `database:write` | `useful.db.execute()` | App writes to DuckDB (INSERT/UPDATE/DELETE/CREATE) |
| `objects` | `useful.objects.*` | App does CRUD on workspace objects (people, tasks, etc.) |
| `files` | `useful.files.read()`, `useful.files.list()` | App reads workspace files |
| `files:write` | `useful.files.write()`, `useful.files.delete()`, `useful.files.mkdir()` | App writes/deletes workspace files |
| `agent` | `useful.chat.*`, `useful.agent.send()`, `useful.tool.*`, `useful.memory.*` | App interacts with the AI agent |
| `ui` | `useful.ui.*` | App shows toasts, navigates, opens entries |
| `store` | `useful.store.*` | App needs persistent key-value storage |
| `http` | `useful.http.fetch()` | App fetches external URLs (CORS-free) |
| `events` | `useful.events.*` | App subscribes to real-time workspace events |
| `apps` | `useful.apps.*` | App communicates with other open apps |
| `cron` | `useful.cron.*` | App schedules recurring agent tasks |
| `webhooks` | `useful.webhooks.*` | App receives external webhooks |
| `clipboard` | `useful.clipboard.*` | App reads/writes the clipboard |

Only request what you need. A game with no data access needs no permissions at all.

---

## Bridge API Overview

The bridge SDK is auto-injected into every app's HTML. It provides `window.useful` with the following namespaces. All methods return Promises with a 30-second timeout.

| Namespace | Permission | Methods | Details In |
|-----------|------------|---------|------------|
| `useful.db` | `database` / `database:write` | `query(sql)`, `execute(sql)` | **data-builder** |
| `useful.objects` | `objects` | `list()`, `get()`, `create()`, `update()`, `delete()`, `bulkDelete()`, `getSchema()`, `getOptions()` | **data-builder** |
| `useful.files` | `files` / `files:write` | `read()`, `list()`, `write()`, `delete()`, `mkdir()` | below |
| `useful.app` | *(none)* | `getManifest()`, `getTheme()` | below |
| `useful.chat` | `agent` | `createSession()`, `send()`, `getHistory()`, `getSessions()`, `abort()`, `isActive()` | **agent-builder** |
| `useful.agent` | `agent` | `send(message)` | **agent-builder** |
| `useful.tool` | `agent` | `register(name, handler)` | **agent-builder** |
| `useful.memory` | `agent` | `get()` | **agent-builder** |
| `useful.ui` | `ui` | `toast()`, `navigate()`, `openEntry()`, `setTitle()`, `confirm()`, `prompt()` | **platform-api** |
| `useful.store` | `store` | `get()`, `set()`, `delete()`, `list()`, `clear()` | **platform-api** |
| `useful.http` | `http` | `fetch(url, opts)` | **platform-api** |
| `useful.events` | `events` | `on(channel, cb)`, `off(channel)` | **platform-api** |
| `useful.context` | *(none)* | `getWorkspace()`, `getAppInfo()` | **platform-api** |
| `useful.apps` | `apps` | `send()`, `on()`, `list()` | **platform-api** |
| `useful.cron` | `cron` | `schedule()`, `list()`, `run()`, `cancel()` | **platform-api** |
| `useful.webhooks` | `webhooks` | `register()`, `on()`, `poll()` | **platform-api** |
| `useful.clipboard` | `clipboard` | `read()`, `write()` | **platform-api** |

### Core APIs (no child skill needed)

```javascript
// Get the app's own parsed manifest
const manifest = await useful.app.getManifest();

// Get current UsefulCRM UI theme
const theme = await useful.app.getTheme();
// Returns: "dark" or "light"
```

### File Access (`files` / `files:write` permission)

```javascript
// Read a workspace file
const content = await useful.files.read("path/to/file.md");

// List workspace directory tree (optionally scoped to a directory)
const tree = await useful.files.list();
const subTree = await useful.files.list("documents/");

// Write a file (files:write permission)
await useful.files.write("path/to/file.md", "# Hello\n\nFile content here.");

// Delete a file (files:write permission)
await useful.files.delete("path/to/old-file.md");

// Create a directory (files:write permission)
await useful.files.mkdir("path/to/new-dir");
```

### Waiting for Bridge Readiness

The bridge script is injected into `<head>`, so it's available by the time your scripts run. However, if you use `defer` or `type="module"` scripts, you can safely access `window.useful` immediately since module scripts run after the document is parsed.

```javascript
function whenUsefulReady(fn) {
  if (window.useful) return fn();
  const check = setInterval(() => {
    if (window.useful) { clearInterval(check); fn(); }
  }, 50);
}

whenUsefulReady(async () => {
  const theme = await useful.app.getTheme();
  document.body.className = theme;
});
```

---

## Theme & Styling System

Apps should respect the UsefulCRM theme. The bridge provides the current theme ("dark" or "light"). Build your CSS to support both.

### Recommended Base Styles

```css
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
    'Helvetica Neue', Arial, sans-serif;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  transition: background-color 0.2s, color 0.2s;
}

body.dark {
  --app-bg: #0f0f1a;
  --app-surface: #1a1a2e;
  --app-surface-hover: #252540;
  --app-border: #2a2a45;
  --app-text: #e8e8f0;
  --app-text-muted: #8888a8;
  --app-accent: #6366f1;
  --app-accent-hover: #818cf8;
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
  --app-accent-hover: #4f46e5;
  --app-success: #16a34a;
  --app-warning: #d97706;
  --app-error: #dc2626;
  background: var(--app-bg);
  color: var(--app-text);
}
```

### Theme Initialization

Always apply the theme as the first action in your app:

```javascript
async function initTheme() {
  try {
    const theme = await useful.app.getTheme();
    document.body.className = theme;
  } catch {
    document.body.className = 'dark';
  }
}
initTheme();
```

### Canvas-Based Apps (Games)

For p5.js, Three.js, or any canvas-based app, set the canvas background based on theme and make sure the body has no scrollbars:

```css
body {
  margin: 0;
  padding: 0;
  overflow: hidden;
  width: 100vw;
  height: 100vh;
}

canvas {
  display: block;
}
```

---

## Loading External Libraries via CDN

Since apps use `runtime: "static"`, load libraries via CDN `<script>` tags. The app iframe allows external script loading.

### Recommended CDNs

Use **unpkg** or **cdnjs** for reliability:

```html
<!-- p5.js -->
<script src="https://unpkg.com/p5@1/lib/p5.min.js"></script>

<!-- Three.js -->
<script type="importmap">
{
  "imports": {
    "three": "https://unpkg.com/three@0.170/build/three.module.js",
    "three/addons/": "https://unpkg.com/three@0.170/examples/jsm/"
  }
}
</script>

<!-- D3.js -->
<script src="https://unpkg.com/d3@7/dist/d3.min.js"></script>

<!-- Chart.js -->
<script src="https://unpkg.com/chart.js@4/dist/chart.umd.min.js"></script>

<!-- Tone.js (audio) -->
<script src="https://unpkg.com/tone@15/build/Tone.js"></script>

<!-- Matter.js (2D physics) -->
<script src="https://unpkg.com/matter-js@0.20/build/matter.min.js"></script>

<!-- cannon-es (3D physics) -->
<script type="module">
import * as CANNON from 'https://unpkg.com/cannon-es@0.20/dist/cannon-es.js';
</script>

<!-- GSAP (animation) -->
<script src="https://unpkg.com/gsap@3/dist/gsap.min.js"></script>

<!-- Howler.js (audio) -->
<script src="https://unpkg.com/howler@2/dist/howler.min.js"></script>
```

### Import Maps for ES Modules

For Three.js and other module-based libraries, use import maps:

```html
<script type="importmap">
{
  "imports": {
    "three": "https://unpkg.com/three@0.170/build/three.module.js",
    "three/addons/": "https://unpkg.com/three@0.170/examples/jsm/"
  }
}
</script>
<script type="module" src="app.js"></script>
```

---

## Multi-File App Organization

For complex apps, split code across multiple files:

```
apps/complex-app.useful.app/
  .useful.yaml
  index.html
  css/
    main.css
    components.css
  js/
    app.js           # Entry point
    game.js          # Game logic
    renderer.js      # Rendering
    ui.js            # UI overlays
    utils.js         # Helpers
  assets/
    sprites/
    sounds/
    models/
```

### Using ES Modules for Multi-File JS

```html
<script type="module" src="js/app.js"></script>
```

```javascript
// js/app.js
import { Game } from './game.js';
import { Renderer } from './renderer.js';
import { UI } from './ui.js';

const game = new Game();
const renderer = new Renderer(game);
const ui = new UI(game);

async function init() {
  if (window.useful) {
    const theme = await useful.app.getTheme();
    renderer.setTheme(theme);
  }
  game.start();
}

init();
```

```javascript
// js/game.js
export class Game {
  constructor() {
    this.state = 'menu';
    this.score = 0;
    this.entities = [];
  }

  start() { this.state = 'playing'; this.loop(); }
  loop() {
    this.update();
    requestAnimationFrame(() => this.loop());
  }
  update() { /* game logic */ }
}
```

Relative imports (`./game.js`) work because all files are served from the same `/api/apps/serve/` base path.

---

## Asset Management

### Referencing Assets

All asset paths are relative to the `.useful.app` folder root:

```javascript
// In p5.js
let img;
function preload() {
  img = loadImage('assets/player.png');
}

// In Three.js (module)
const texture = new THREE.TextureLoader().load('assets/texture.jpg');

// In HTML
// <img src="assets/logo.png" />
// <audio src="assets/music.mp3"></audio>
```

### Supported MIME Types

The file server recognizes these extensions automatically:

| Extension | MIME Type |
|-----------|-----------|
| `.html`, `.htm` | `text/html` |
| `.css` | `text/css` |
| `.js`, `.mjs` | `application/javascript` |
| `.json` | `application/json` |
| `.png` | `image/png` |
| `.jpg`, `.jpeg` | `image/jpeg` |
| `.gif` | `image/gif` |
| `.svg` | `image/svg+xml` |
| `.webp` | `image/webp` |
| `.woff`, `.woff2` | `font/woff`, `font/woff2` |
| `.ttf`, `.otf` | `font/ttf`, `font/otf` |
| `.wasm` | `application/wasm` |
| `.mp3`, `.wav`, `.ogg` | Served as `application/octet-stream` (works fine for `<audio>` and Howler) |

### Generating Assets Inline

For games without pre-made art, generate sprites and textures programmatically:

```javascript
// p5.js: Create a sprite at runtime
function createPlayerSprite(size) {
  const g = createGraphics(size, size);
  g.noStroke();
  g.fill('#6366f1');
  g.ellipse(size / 2, size / 2, size * 0.8);
  g.fill('#818cf8');
  g.ellipse(size / 2, size / 3, size * 0.3);
  return g;
}

// Three.js: Create a texture from canvas
function createCheckerTexture(size = 256, divisions = 8) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cellSize = size / divisions;
  for (let y = 0; y < divisions; y++) {
    for (let x = 0; x < divisions; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#ffffff' : '#cccccc';
      ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}
```

---

## Performance & Best Practices

### General

- **Always use `runtime: "static"`** unless explicitly asked for React/TSX/npm
- **Request only needed permissions** — no permissions needed for pure games/tools
- **Keep apps self-contained** — all resources within the `.useful.app` folder
- **Use semantic HTML** and responsive design
- **Handle errors** for all bridge API calls
- **Apply the theme** as the very first thing on load
- **Use `requestAnimationFrame`** for all animation loops (p5.js does this automatically)
- **Clean up resources** in games: remove event listeners, cancel animations, dispose Three.js objects

### p5.js Performance

- Use `pixelDensity(1)` for pixel-art or retro-style games to avoid unnecessary high-DPI rendering
- Use `noSmooth()` for pixel-art aesthetics
- Minimize `createGraphics()` calls — create off-screen buffers once and reuse
- Object pool frequently-created entities (bullets, particles) instead of creating new objects each frame
- Use `p.frameRate(60)` explicitly to cap FPS
- For large worlds, only render entities visible on screen (frustum culling)
- Use `p.millis()` or `p.deltaTime` for time-based movement instead of frame-based

### Three.js Performance

- **Limit pixel ratio**: `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))`
- **Reuse geometries and materials** — don't create new ones per object if the shape/material is the same
- **Dispose resources** when no longer needed: `geometry.dispose()`, `material.dispose()`, `texture.dispose()`
- **Use `BufferGeometry`** (the default in modern Three.js)
- **Merge static meshes** with `BufferGeometryUtils.mergeGeometries()` for large scenes
- **Use instanced rendering** (`InstancedMesh`) for many identical objects (trees, particles)
- **Limit shadow map resolution** on mobile
- **Use LOD** (Level of Detail) for complex models: `THREE.LOD`
- **Throttle physics** to a fixed timestep (e.g., 60Hz) separate from render framerate

### Memory

- For Three.js, always clean up in a dispose function:
  ```javascript
  function dispose() {
    renderer.dispose();
    scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });
  }
  ```

---

## Error Handling Patterns

### Bridge API Error Handling

Always wrap bridge calls in try/catch:

```javascript
async function loadData() {
  try {
    const result = await useful.db.query("SELECT * FROM objects");
    return result.rows || [];
  } catch (err) {
    console.error('Failed to load data:', err.message);
    showError('Could not load workspace data. Check permissions.');
    return [];
  }
}
```

### Loading State Pattern

```javascript
function showLoading(message = 'Loading...') {
  const el = document.getElementById('loading');
  if (el) { el.textContent = message; el.style.display = 'flex'; }
}

function hideLoading() {
  const el = document.getElementById('loading');
  if (el) el.style.display = 'none';
}

function showError(message) {
  const el = document.getElementById('error');
  if (el) { el.textContent = message; el.style.display = 'block'; }
}
```

### Graceful Degradation

```javascript
async function init() {
  try {
    const theme = await useful.app.getTheme();
    document.body.className = theme;
  } catch {
    document.body.className = 'dark';
  }

  try {
    const data = await useful.db.query("SELECT * FROM objects");
    renderDashboard(data.rows);
  } catch {
    renderEmptyState('No data available. Make sure the app has database permission.');
  }
}
```

---

## Creating an App — Step by Step Checklist

When asked to build an app, follow these steps:

1. **Determine the app type** — game (2D/3D), dashboard, tool, visualization, AI chat, widget, etc.
2. **Choose the right library**:
   - 2D game / simulation / generative art → **p5.js** (always) — see **game-builder** child skill
   - 3D game / scene / visualization → **Three.js** (always) — see **game-builder** child skill
   - Data dashboard / CRUD app → **Chart.js** or **plain HTML/CSS** — see **data-builder** child skill
   - AI-powered app / chat UI → use `useful.chat.*` API — see **agent-builder** child skill
   - Interactive tool / form → **plain HTML/CSS/JS**
3. **Create the app folder**: `apps/<name>.useful.app/`
4. **Create `.useful.yaml`** with manifest (always include `name`, `entry`, `runtime`, and needed `permissions`)
5. **Create `index.html`** as the entry point with CDN script tags
6. **Create separate JS file(s)** for app logic — avoid massive inline scripts
7. **Apply theme** via `useful.app.getTheme()` on init
8. **Handle window resizing** (canvas-based apps must call `resizeCanvas` / update renderer)
9. **Add error handling** for all bridge API calls
10. **Test the app** opens correctly as a tab in UsefulCRM

---

## Child Skills

This skill covers app fundamentals. For specialized APIs, see these child skills (all inside the `app-builder/` skill folder):

| Skill | Path | Covers |
|-------|------|--------|
| **Game Builder** | `app-builder/game-builder/SKILL.md` | 2D games with p5.js, 3D games with Three.js, physics (Matter.js), audio, sprites, particles, tilemaps, game state machines, complete game examples |
| **Data Builder** | `app-builder/data-builder/SKILL.md` | Workspace objects CRUD (`useful.objects.*`), DuckDB queries and mutations (`useful.db.*`), Chart.js and D3.js dashboards, stat cards, interactive tools, CRUD form patterns |
| **Agent Builder** | `app-builder/agent-builder/SKILL.md` | AI chat API (`useful.chat.*`), streaming responses, app-as-tool (`useful.tool.*`), agent memory access, Gateway WebSocket protocol, chat UI patterns |
| **Platform API** | `app-builder/platform-api/SKILL.md` | UI integration (`useful.ui.*`), per-app KV store (`useful.store.*`), HTTP proxy (`useful.http.*`), real-time events (`useful.events.*`), inter-app messaging (`useful.apps.*`), cron scheduling (`useful.cron.*`), webhooks (`useful.webhooks.*`), clipboard (`useful.clipboard.*`), widget mode, context |

All child skills are seeded into the workspace alongside this parent skill and can be read at `{{WORKSPACE_PATH}}/skills/app-builder/<child>/SKILL.md`.
