/**
 * Useful Action SDK Runtime.
 *
 * Lightweight CommonJS module injected into inline action scripts.
 * Provides useful.* methods that wrap workspace API calls via HTTP.
 * Any language can use the DENCH_* env vars directly; this module
 * is a convenience for inline JS actions.
 */
"use strict";

module.exports = function createUsefulSDK(env) {
  const API = env.DENCH_API_URL || "http://localhost:3000/api";

  async function apiFetch(path, opts) {
    const url = API + path;
    const res = await fetch(url, {
      ...opts,
      headers: { "Content-Type": "application/json", ...(opts && opts.headers) },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error("API " + res.status + ": " + (body || res.statusText));
    }
    return res.json();
  }

  return {
    objects: {
      get: function(name, id) {
        return apiFetch("/workspace/objects/" + encodeURIComponent(name) + "/entries/" + encodeURIComponent(id));
      },
      list: function(name, opts) {
        var qs = opts ? "?" + new URLSearchParams(opts).toString() : "";
        return apiFetch("/workspace/objects/" + encodeURIComponent(name) + qs);
      },
      create: function(name, fields) {
        return apiFetch("/workspace/objects/" + encodeURIComponent(name) + "/entries", {
          method: "POST",
          body: JSON.stringify({ fields: fields }),
        });
      },
      update: function(name, id, fields) {
        return apiFetch("/workspace/objects/" + encodeURIComponent(name) + "/entries/" + encodeURIComponent(id), {
          method: "PATCH",
          body: JSON.stringify({ fields: fields }),
        });
      },
      delete: function(name, id) {
        return apiFetch("/workspace/objects/" + encodeURIComponent(name) + "/entries/" + encodeURIComponent(id), {
          method: "DELETE",
        });
      },
      bulkDelete: function(name, ids) {
        return apiFetch("/workspace/objects/" + encodeURIComponent(name) + "/entries/bulk-delete", {
          method: "POST",
          body: JSON.stringify({ entryIds: ids }),
        });
      },
    },

    db: {
      query: function(sql) {
        return apiFetch("/workspace/query", { method: "POST", body: JSON.stringify({ sql: sql }) });
      },
      execute: function(sql) {
        return apiFetch("/workspace/execute", { method: "POST", body: JSON.stringify({ sql: sql }) });
      },
    },

    files: {
      read: function(path) {
        return apiFetch("/workspace/file?path=" + encodeURIComponent(path));
      },
      write: function(path, content) {
        return apiFetch("/workspace/file", {
          method: "PUT",
          body: JSON.stringify({ path: path, content: content }),
        });
      },
    },

    http: {
      fetch: function(url, opts) {
        return fetch(url, opts);
      },
    },

    exec: function(cmd) {
      return require("child_process").execSync(cmd, { encoding: "utf-8", cwd: env.DENCH_WORKSPACE_PATH });
    },

    progress: function(percent, message) {
      console.log(JSON.stringify({ type: "progress", percent: percent, message: message }));
    },

    log: function(message, level) {
      console.log(JSON.stringify({ type: "log", level: level || "info", message: String(message) }));
    },

    complete: function(data) {
      console.log(JSON.stringify({ type: "result", status: "success", data: data || {} }));
    },

    fail: function(message) {
      console.log(JSON.stringify({ type: "result", status: "error", data: { message: String(message) } }));
      process.exit(1);
    },

    env: {
      entryId: env.DENCH_ENTRY_ID,
      entryData: (function() { try { return JSON.parse(env.DENCH_ENTRY_DATA || "{}"); } catch(e) { return {}; } })(),
      objectName: env.DENCH_OBJECT_NAME,
      objectId: env.DENCH_OBJECT_ID,
      actionId: env.DENCH_ACTION_ID,
      fieldId: env.DENCH_FIELD_ID,
      workspacePath: env.DENCH_WORKSPACE_PATH,
      dbPath: env.DENCH_DB_PATH,
      apiUrl: env.DENCH_API_URL,
    },
  };
};
