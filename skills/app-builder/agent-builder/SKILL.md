---
name: agent-builder
description: Build AI-powered UsefulCRM apps that interact with the Hermes agent — create chat sessions, send and receive messages with streaming, expose app tools for agent invocation, and access agent memory.
metadata: { "hermes": { "inject": true, "always": true, "emoji": "🤖" } }
---

# App Agent Builder

This skill covers building apps that interact with the AI agent. For core app structure and manifest basics, see the parent **app-builder** skill (`app-builder/SKILL.md`).

## Chat API (`agent` permission required)

### Creating Sessions

```javascript
// Create a new chat session
const { sessionId } = await useful.chat.createSession("My Analysis Session");

// List existing sessions
const sessions = await useful.chat.getSessions({ limit: 20 });
// Returns array of { id, title, createdAt, ... }
```

### Sending Messages with Streaming

```javascript
const result = await useful.chat.send(sessionId, "Analyze the people table and summarize trends", {
  onEvent(event) {
    switch (event.type) {
      case "text-delta":
        appendToChat(event.data);
        break;
      case "reasoning-delta":
        updateThinking(event.data);
        break;
      case "tool-input-start":
        showToolCall(event.name, event.args);
        break;
      case "tool-output-available":
        showToolResult(event.result);
        break;
    }
  }
});
// result contains the full accumulated response: { text, toolCalls, reasoning }
```

### Chat History & Control

```javascript
// Get message history for a session
const messages = await useful.chat.getHistory(sessionId);
// Returns array of { role, content, toolCalls?, ... }

// Check if a session has an active run
const isActive = await useful.chat.isActive(sessionId);

// Abort an active run
await useful.chat.abort(sessionId);
```

### Simple Agent Message (fire-and-forget)

```javascript
// Send a one-off message to the agent (no streaming, no session management)
await useful.agent.send("Remind me to check the reports tomorrow at 9am");
```

## App-as-Tool (`agent` permission required)

Apps can expose themselves as tools that the agent can invoke. Declare tools in the manifest:

```yaml
name: "Chart Analyzer"
permissions:
  - agent
tools:
  - name: "analyze-chart"
    description: "Generates a visual chart analysis from structured data"
    inputSchema:
      type: object
      properties:
        data:
          type: array
          description: "Array of data points"
        chartType:
          type: string
          enum: ["bar", "line", "pie", "scatter"]
      required: ["data", "chartType"]
```

Register tool handlers in the app:

```javascript
useful.tool.register("analyze-chart", async (input) => {
  const { data, chartType } = input;

  // Process the data and generate the chart
  const chart = renderChart(data, chartType);
  const analysis = analyzeData(data);

  // Return result to the agent
  return {
    analysis: analysis,
    chartImageUrl: chart.toDataURL(),
    summary: `Generated ${chartType} chart with ${data.length} data points`
  };
});
```

When the agent invokes the tool, the app receives the input, processes it, and returns the result. The app must be open (active tab) for tool invocation to work.

## Agent Memory Access (`agent` permission required)

```javascript
// Read the agent's memory (MEMORY.md + daily logs)
const memory = await useful.memory.get();
// Returns { memory: "...", dailyLogs: [...] }
```

## Gateway WebSocket Protocol (Advanced)

For advanced apps that want to build their own chat UI or need direct Gateway access, here's the WebSocket protocol:

### Connection

```javascript
const ws = new WebSocket("ws://127.0.0.1:18789");
// Port is configurable via gateway.port in ~/.hermes-useful/hermes.json
```

### Frame Types

```javascript
// Request (client -> gateway)
{ type: "req", id: "uuid", method: "agent", params: { ... } }

// Response (gateway -> client)
{ type: "res", id: "uuid", ok: true, payload: { ... } }

// Event (gateway -> client)
{ type: "event", event: "agent", seq: 1, payload: { ... } }
```

### Connection Handshake

```javascript
ws.onopen = () => {
  ws.send(JSON.stringify({
    type: "req",
    id: crypto.randomUUID(),
    method: "connect",
    params: {
      minProtocol: 3,
      maxProtocol: 3,
      client: { id: "my-app", version: "1.0", platform: "web", mode: "backend" },
      role: "user",
      scopes: ["agent", "chat"],
      caps: ["tool-events"]
    }
  }));
};
```

### Sending Messages

```javascript
// Start an agent run
ws.send(JSON.stringify({
  type: "req",
  id: crypto.randomUUID(),
  method: "agent",
  params: {
    message: "Hello, analyze this data",
    sessionKey: "agent:main:web:my-session-id",
    channel: "webchat",
    lane: "web"
  }
}));

// Abort a run
ws.send(JSON.stringify({
  type: "req",
  id: crypto.randomUUID(),
  method: "chat.abort",
  params: { sessionKey: "agent:main:web:my-session-id" }
}));
```

### Agent Events

```javascript
ws.onmessage = (e) => {
  const frame = JSON.parse(e.data);
  if (frame.type !== "event" || frame.event !== "agent") return;

  const { stream, data } = frame.payload;

  switch (stream) {
    case "lifecycle":
      // data.phase: "start" | "end" | "error"
      break;
    case "thinking":
      // data.delta: incremental reasoning text
      break;
    case "assistant":
      // data.delta: incremental response text
      // data.text: full text (on completion)
      // data.stopReason: "end_turn" | "tool_use" | etc.
      break;
    case "tool":
      // data.phase: "start" | "update" | "result"
      // data.name, data.args, data.result
      break;
  }
};
```

NOTE: For most apps, the bridge chat API (`useful.chat.*`) is much simpler than direct WebSocket usage. Use the Gateway WS only when you need full control over the connection.

## Patterns

### Chat UI App

```javascript
let currentSessionId = null;
const chatContainer = document.getElementById("chat");

async function startNewChat() {
  const { sessionId } = await useful.chat.createSession("App Chat");
  currentSessionId = sessionId;
  chatContainer.innerHTML = "";
}

async function sendMessage(text) {
  appendMessage("user", text);
  const responseEl = appendMessage("assistant", "");

  await useful.chat.send(currentSessionId, text, {
    onEvent(event) {
      if (event.type === "text-delta") {
        responseEl.textContent += event.data;
      }
    }
  });
}

function appendMessage(role, content) {
  const div = document.createElement("div");
  div.className = `message ${role}`;
  div.textContent = content;
  chatContainer.appendChild(div);
  chatContainer.scrollTop = chatContainer.scrollHeight;
  return div;
}
```

### Agent-Powered Data Analysis

```javascript
async function analyzeData(objectName) {
  const schema = await useful.objects.getSchema(objectName);
  const { sessionId } = await useful.chat.createSession("Data Analysis");

  const result = await useful.chat.send(sessionId,
    `Analyze the ${objectName} object. It has these fields: ${schema.fields.map(f => f.name).join(", ")}. ` +
    `Query the data and provide insights.`,
    {
      onEvent(event) {
        if (event.type === "text-delta") updateAnalysisPanel(event.data);
      }
    }
  );

  showFinalAnalysis(result.text);
}
```
