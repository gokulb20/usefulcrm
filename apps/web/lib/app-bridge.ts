/**
 * UsefulCRM App Bridge SDK.
 *
 * This module generates the client-side SDK script that gets injected into
 * app iframes, providing `window.useful` for app-to-UsefulCRM communication.
 *
 * Protocol:
 *   App -> Parent: { type: "useful:request", id, method, params }
 *   Parent -> App: { type: "useful:response", id, result, error }
 *   Parent -> App: { type: "useful:stream", streamId, event, data }
 *   Parent -> App: { type: "useful:stream-end", streamId, result }
 *   Parent -> App: { type: "useful:event", channel, data }
 *   Parent -> App: { type: "useful:tool-invoke", toolName, args, invokeId }
 */

export function generateBridgeScript(): string {
  return `
(function() {
  if (window.useful) return;

  var _pendingRequests = {};
  var _requestId = 0;
  var _streamCallbacks = {};
  var _streamId = 0;
  var _eventListeners = {};
  var _toolHandlers = {};
  var _appMessageHandler = null;
  var _webhookHandlers = {};

  function sendRequest(method, params) {
    return new Promise(function(resolve, reject) {
      var id = ++_requestId;
      _pendingRequests[id] = { resolve: resolve, reject: reject };
      window.parent.postMessage({
        type: "useful:request",
        id: id,
        method: method,
        params: params
      }, "*");

      setTimeout(function() {
        if (_pendingRequests[id]) {
          _pendingRequests[id].reject(new Error("Request timeout: " + method));
          delete _pendingRequests[id];
        }
      }, 30000);
    });
  }

  function sendStreamRequest(method, params, onEvent) {
    return new Promise(function(resolve, reject) {
      var id = ++_requestId;
      var sid = ++_streamId;
      _streamCallbacks[sid] = onEvent;
      _pendingRequests[id] = {
        resolve: function(result) {
          delete _streamCallbacks[sid];
          resolve(result);
        },
        reject: function(err) {
          delete _streamCallbacks[sid];
          reject(err);
        }
      };
      window.parent.postMessage({
        type: "useful:request",
        id: id,
        method: method,
        params: Object.assign({}, params, { _streamId: sid })
      }, "*");

      setTimeout(function() {
        if (_pendingRequests[id]) {
          delete _streamCallbacks[sid];
          _pendingRequests[id].reject(new Error("Request timeout: " + method));
          delete _pendingRequests[id];
        }
      }, 300000);
    });
  }

  window.addEventListener("message", function(event) {
    if (!event.data) return;
    var d = event.data;

    if (d.type === "useful:response") {
      var pending = _pendingRequests[d.id];
      if (!pending) return;
      delete _pendingRequests[d.id];
      if (d.error) {
        pending.reject(new Error(d.error));
      } else {
        pending.resolve(d.result);
      }
    }

    else if (d.type === "useful:stream") {
      var cb = _streamCallbacks[d.streamId];
      if (cb) cb({ type: d.event, data: d.data, name: d.name, args: d.args, result: d.result });
    }

    else if (d.type === "useful:stream-end") {
      // Stream end is handled via the normal response path
    }

    else if (d.type === "useful:event") {
      var channel = d.channel;
      if (channel === "apps.message" && _appMessageHandler) {
        _appMessageHandler(d.data);
      }
      if (channel && channel.indexOf("webhooks.") === 0) {
        var hookName = channel.substring(9);
        var whCb = _webhookHandlers[hookName];
        if (whCb) whCb(d.data);
      }
      var listeners = _eventListeners[channel];
      if (listeners) {
        for (var i = 0; i < listeners.length; i++) {
          try { listeners[i](d.data); } catch(e) { console.error("Event handler error:", e); }
        }
      }
    }

    else if (d.type === "useful:tool-invoke") {
      var handler = _toolHandlers[d.toolName];
      if (handler) {
        Promise.resolve().then(function() {
          return handler(d.args);
        }).then(function(result) {
          window.parent.postMessage({
            type: "useful:tool-response",
            invokeId: d.invokeId,
            result: result
          }, "*");
        }).catch(function(err) {
          window.parent.postMessage({
            type: "useful:tool-response",
            invokeId: d.invokeId,
            error: err.message || "Tool handler failed"
          }, "*");
        });
      }
    }
  });

  window.useful = {
    db: {
      query: function(sql) { return sendRequest("db.query", { sql: sql }); },
      execute: function(sql) { return sendRequest("db.execute", { sql: sql }); }
    },
    objects: {
      list: function(name, opts) { return sendRequest("objects.list", Object.assign({ name: name }, opts || {})); },
      get: function(name, entryId) { return sendRequest("objects.get", { name: name, entryId: entryId }); },
      create: function(name, fields) { return sendRequest("objects.create", { name: name, fields: fields }); },
      update: function(name, entryId, fields) { return sendRequest("objects.update", { name: name, entryId: entryId, fields: fields }); },
      delete: function(name, entryId) { return sendRequest("objects.delete", { name: name, entryId: entryId }); },
      bulkDelete: function(name, entryIds) { return sendRequest("objects.bulkDelete", { name: name, entryIds: entryIds }); },
      getSchema: function(name) { return sendRequest("objects.getSchema", { name: name }); },
      getOptions: function(name, query) { return sendRequest("objects.getOptions", { name: name, query: query }); }
    },
    files: {
      read: function(path) { return sendRequest("files.read", { path: path }); },
      list: function(dir) { return sendRequest("files.list", { dir: dir }); },
      write: function(path, content) { return sendRequest("files.write", { path: path, content: content }); },
      delete: function(path) { return sendRequest("files.delete", { path: path }); },
      mkdir: function(path) { return sendRequest("files.mkdir", { path: path }); }
    },
    app: {
      getManifest: function() { return sendRequest("app.getManifest"); },
      getTheme: function() { return sendRequest("app.getTheme"); }
    },
    chat: {
      createSession: function(title) { return sendRequest("chat.createSession", { title: title }); },
      send: function(sessionId, message, opts) {
        if (opts && opts.onEvent) {
          return sendStreamRequest("chat.send", { sessionId: sessionId, message: message }, opts.onEvent);
        }
        return sendRequest("chat.send", { sessionId: sessionId, message: message });
      },
      getHistory: function(sessionId) { return sendRequest("chat.getHistory", { sessionId: sessionId }); },
      getSessions: function(opts) { return sendRequest("chat.getSessions", opts || {}); },
      abort: function(sessionId) { return sendRequest("chat.abort", { sessionId: sessionId }); },
      isActive: function(sessionId) { return sendRequest("chat.isActive", { sessionId: sessionId }); }
    },
    agent: {
      send: function(message) { return sendRequest("agent.send", { message: message }); }
    },
    tool: {
      register: function(name, handler) {
        _toolHandlers[name] = handler;
        return sendRequest("tool.register", { name: name });
      }
    },
    memory: {
      get: function() { return sendRequest("memory.get"); }
    },
    ui: {
      toast: function(message, opts) { return sendRequest("ui.toast", Object.assign({ message: message }, opts || {})); },
      navigate: function(path) { return sendRequest("ui.navigate", { path: path }); },
      openEntry: function(objectName, entryId) { return sendRequest("ui.openEntry", { objectName: objectName, entryId: entryId }); },
      setTitle: function(title) { return sendRequest("ui.setTitle", { title: title }); },
      confirm: function(message) { return sendRequest("ui.confirm", { message: message }); },
      prompt: function(message, defaultValue) { return sendRequest("ui.prompt", { message: message, defaultValue: defaultValue }); }
    },
    store: {
      get: function(key) { return sendRequest("store.get", { key: key }); },
      set: function(key, value) { return sendRequest("store.set", { key: key, value: value }); },
      delete: function(key) { return sendRequest("store.delete", { key: key }); },
      list: function() { return sendRequest("store.list"); },
      clear: function() { return sendRequest("store.clear"); }
    },
    http: {
      fetch: function(url, opts) { return sendRequest("http.fetch", Object.assign({ url: url }, opts || {})); }
    },
    events: {
      on: function(channel, callback) {
        if (!_eventListeners[channel]) _eventListeners[channel] = [];
        _eventListeners[channel].push(callback);
        sendRequest("events.subscribe", { channel: channel }).catch(function() {});
      },
      off: function(channel, callback) {
        if (!callback) {
          delete _eventListeners[channel];
        } else if (_eventListeners[channel]) {
          _eventListeners[channel] = _eventListeners[channel].filter(function(cb) { return cb !== callback; });
          if (_eventListeners[channel].length === 0) delete _eventListeners[channel];
        }
        sendRequest("events.unsubscribe", { channel: channel }).catch(function() {});
      }
    },
    context: {
      getWorkspace: function() { return sendRequest("context.getWorkspace"); },
      getAppInfo: function() { return sendRequest("context.getAppInfo"); }
    },
    apps: {
      send: function(targetApp, message) { return sendRequest("apps.send", { targetApp: targetApp, message: message }); },
      on: function(eventType, callback) {
        if (eventType === "message") _appMessageHandler = callback;
      },
      list: function() { return sendRequest("apps.list"); }
    },
    cron: {
      schedule: function(opts) { return sendRequest("cron.schedule", opts); },
      list: function() { return sendRequest("cron.list"); },
      run: function(jobId) { return sendRequest("cron.run", { jobId: jobId }); },
      cancel: function(jobId) { return sendRequest("cron.cancel", { jobId: jobId }); }
    },
    webhooks: {
      register: function(hookName) { return sendRequest("webhooks.register", { hookName: hookName }); },
      on: function(hookName, callback) {
        _webhookHandlers[hookName] = callback;
        sendRequest("webhooks.subscribe", { hookName: hookName }).catch(function() {});
      },
      poll: function(hookName, opts) { return sendRequest("webhooks.poll", Object.assign({ hookName: hookName }, opts || {})); }
    },
    clipboard: {
      read: function() { return sendRequest("clipboard.read"); },
      write: function(text) { return sendRequest("clipboard.write", { text: text }); }
    }
  };
})();
`;
}

/**
 * Wraps raw HTML content with the bridge SDK script tag.
 * Used when serving HTML files to inject the SDK automatically.
 */
export function injectBridgeIntoHtml(html: string): string {
  const script = `<script>${generateBridgeScript()}</script>`;

  // Try to inject before </head>
  if (html.includes("</head>")) {
    return html.replace("</head>", `${script}\n</head>`);
  }

  // Try to inject after <head>
  if (html.includes("<head>")) {
    return html.replace("<head>", `<head>\n${script}`);
  }

  // Fallback: prepend to the HTML
  return `${script}\n${html}`;
}
