"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { UsefulAppManifest } from "../../workspace/workspace-content";
import {
  registerApp,
  unregisterApp,
  sendToApp,
  listActiveApps,
  type AppInstance,
  type ToolDef,
} from "@/lib/app-registry";

/** Build a path-based URL for serving files from a .useful.app folder. */
export function appServeUrl(appPath: string, filePath: string): string {
  return `/api/apps/serve/${appPath}/${filePath}`;
}

type AppViewerProps = {
  appPath: string;
  manifest: UsefulAppManifest;
  onToast?: (message: string, opts?: { type?: string }) => void;
  onNavigate?: (path: string) => void;
};

function hasPermission(
  permissions: string[] | undefined,
  ...required: string[]
): boolean {
  if (!permissions) return false;
  return required.some((r) => permissions.includes(r));
}

export function AppViewer({ appPath, manifest, onToast, onNavigate }: AppViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const appInstanceRef = useRef<AppInstance | null>(null);
  const subscribedChannelsRef = useRef<Set<string>>(new Set());
  const webhookPollersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(
    new Map(),
  );
  const pendingToolInvocationsRef = useRef<
    Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>
  >(new Map());

  const entryFile = manifest.entry || "index.html";
  const appUrl = appServeUrl(appPath, entryFile);
  const permissions = manifest.permissions || [];
  const appFolderName = appPath.split("/").pop() || appPath;

  const handleReload = useCallback(() => {
    setLoading(true);
    setError(null);
    if (iframeRef.current) {
      iframeRef.current.src = `${appUrl}?_t=${Date.now()}`;
    }
  }, [appUrl]);

  const handleIframeLoad = useCallback(() => {
    setLoading(false);
  }, []);

  const handleIframeError = useCallback(() => {
    setLoading(false);
    setError("Failed to load app");
  }, []);

  useEffect(() => {
    const instance: AppInstance = {
      appName: appFolderName,
      iframe: iframeRef.current!,
      tools: new Map(),
    };
    appInstanceRef.current = instance;
    registerApp(instance);

    return () => {
      unregisterApp(instance);
      for (const poller of webhookPollersRef.current.values()) {
        clearInterval(poller);
      }
      webhookPollersRef.current.clear();
    };
  }, [appFolderName]);

  useEffect(() => {
    function sendResponse(
      iframe: HTMLIFrameElement,
      id: number,
      result: unknown,
      error?: string,
    ) {
      iframe.contentWindow?.postMessage(
        error
          ? { type: "useful:response", id, error }
          : { type: "useful:response", id, result },
        "*",
      );
    }

    function emitEvent(
      iframe: HTMLIFrameElement,
      channel: string,
      data: unknown,
    ) {
      iframe.contentWindow?.postMessage(
        { type: "useful:event", channel, data },
        "*",
      );
    }

    function emitStream(
      iframe: HTMLIFrameElement,
      streamId: number,
      event: string,
      data: unknown,
      extra?: Record<string, unknown>,
    ) {
      iframe.contentWindow?.postMessage(
        { type: "useful:stream", streamId, event, data, ...extra },
        "*",
      );
    }

    const handleMessage = async (event: MessageEvent) => {
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow || event.source !== iframe.contentWindow)
        return;

      if (event.data?.type === "useful:tool-response") {
        const { invokeId, result, error: toolError } = event.data;
        const pending = pendingToolInvocationsRef.current.get(invokeId);
        if (pending) {
          pendingToolInvocationsRef.current.delete(invokeId);
          if (toolError) pending.reject(new Error(toolError));
          else pending.resolve(result);
        }
        return;
      }

      if (!event.data || event.data.type !== "useful:request") return;

      const { id, method, params } = event.data;

      try {
        let result: unknown;

        // --- App Utilities (no permission needed) ---
        if (method === "app.getManifest") {
          result = manifest;
        } else if (method === "app.getTheme") {
          result = document.documentElement.classList.contains("dark")
            ? "dark"
            : "light";
        } else if (method === "context.getWorkspace") {
          result = { name: appPath.split("/")[0] || "workspace" };
        } else if (method === "context.getAppInfo") {
          result = {
            appPath,
            folderName: appFolderName,
            permissions,
            manifest,
          };

          // --- Database ---
        } else if (
          method === "db.query" &&
          hasPermission(permissions, "database", "database:write")
        ) {
          const res = await fetch("/api/workspace/query", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sql: params?.sql }),
          });
          result = await res.json();
        } else if (
          method === "db.execute" &&
          hasPermission(permissions, "database:write")
        ) {
          const res = await fetch("/api/workspace/execute", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sql: params?.sql }),
          });
          result = await res.json();

          // --- Objects CRUD ---
        } else if (
          method === "objects.list" &&
          hasPermission(permissions, "objects")
        ) {
          const qs = new URLSearchParams();
          if (params?.filters) qs.set("filters", params.filters);
          if (params?.sort) qs.set("sort", params.sort);
          if (params?.search) qs.set("search", params.search);
          if (params?.page) qs.set("page", String(params.page));
          if (params?.pageSize) qs.set("pageSize", String(params.pageSize));
          const res = await fetch(
            `/api/workspace/objects/${encodeURIComponent(params?.name)}?${qs}`,
          );
          result = await res.json();
        } else if (
          method === "objects.get" &&
          hasPermission(permissions, "objects")
        ) {
          const res = await fetch(
            `/api/workspace/objects/${encodeURIComponent(params?.name)}/entries/${encodeURIComponent(params?.entryId)}`,
          );
          result = await res.json();
        } else if (
          method === "objects.create" &&
          hasPermission(permissions, "objects")
        ) {
          const res = await fetch(
            `/api/workspace/objects/${encodeURIComponent(params?.name)}/entries`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ fields: params?.fields }),
            },
          );
          result = await res.json();
          emitObjectEvent(iframe, "object.entry.created", params?.name, result);
        } else if (
          method === "objects.update" &&
          hasPermission(permissions, "objects")
        ) {
          const res = await fetch(
            `/api/workspace/objects/${encodeURIComponent(params?.name)}/entries/${encodeURIComponent(params?.entryId)}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ fields: params?.fields }),
            },
          );
          result = await res.json();
          emitObjectEvent(iframe, "object.entry.updated", params?.name, {
            entryId: params?.entryId,
          });
        } else if (
          method === "objects.delete" &&
          hasPermission(permissions, "objects")
        ) {
          const res = await fetch(
            `/api/workspace/objects/${encodeURIComponent(params?.name)}/entries/${encodeURIComponent(params?.entryId)}`,
            { method: "DELETE" },
          );
          result = await res.json();
          emitObjectEvent(iframe, "object.entry.deleted", params?.name, {
            entryId: params?.entryId,
          });
        } else if (
          method === "objects.bulkDelete" &&
          hasPermission(permissions, "objects")
        ) {
          const res = await fetch(
            `/api/workspace/objects/${encodeURIComponent(params?.name)}/entries/bulk-delete`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ entryIds: params?.entryIds }),
            },
          );
          result = await res.json();
          emitObjectEvent(iframe, "object.entry.deleted", params?.name, {
            entryIds: params?.entryIds,
          });
        } else if (
          method === "objects.getSchema" &&
          hasPermission(permissions, "objects")
        ) {
          const res = await fetch(
            `/api/workspace/objects/${encodeURIComponent(params?.name)}?schemaOnly=1`,
          );
          result = await res.json();
        } else if (
          method === "objects.getOptions" &&
          hasPermission(permissions, "objects")
        ) {
          const qs = params?.query
            ? `?q=${encodeURIComponent(params.query)}`
            : "";
          const res = await fetch(
            `/api/workspace/objects/${encodeURIComponent(params?.name)}/entries/options${qs}`,
          );
          result = await res.json();

          // --- Files ---
        } else if (
          method === "files.read" &&
          hasPermission(permissions, "files", "files:write")
        ) {
          const res = await fetch(
            `/api/workspace/file?path=${encodeURIComponent(params?.path)}`,
          );
          result = await res.json();
        } else if (
          method === "files.list" &&
          hasPermission(permissions, "files", "files:write")
        ) {
          const qs = params?.dir
            ? `?path=${encodeURIComponent(params.dir)}`
            : "?showHidden=0";
          const res = await fetch(`/api/workspace/browse${qs}`);
          result = await res.json();
        } else if (
          method === "files.write" &&
          hasPermission(permissions, "files:write")
        ) {
          const res = await fetch("/api/workspace/file", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              path: params?.path,
              content: params?.content,
            }),
          });
          result = await res.json();
        } else if (
          method === "files.delete" &&
          hasPermission(permissions, "files:write")
        ) {
          const res = await fetch(
            `/api/workspace/file?path=${encodeURIComponent(params?.path)}`,
            { method: "DELETE" },
          );
          result = await res.json();
        } else if (
          method === "files.mkdir" &&
          hasPermission(permissions, "files:write")
        ) {
          const res = await fetch("/api/workspace/mkdir", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: params?.path }),
          });
          result = await res.json();

          // --- Chat ---
        } else if (
          method === "chat.createSession" &&
          hasPermission(permissions, "agent")
        ) {
          const res = await fetch("/api/web-sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: params?.title }),
          });
          result = await res.json();
        } else if (
          method === "chat.send" &&
          hasPermission(permissions, "agent")
        ) {
          const streamId = params?._streamId as number | undefined;
          const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: [{ role: "user", content: params?.message }],
              sessionId: params?.sessionId,
            }),
          });

          if (streamId && res.body) {
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let accumulated = "";
            let fullText = "";

            // Read SSE stream and relay to app
            // eslint-disable-next-line no-constant-condition
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              accumulated += decoder.decode(value, { stream: true });
              const lines = accumulated.split("\n");
              accumulated = lines.pop() || "";

              for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                try {
                  const sseData = JSON.parse(line.slice(6));
                  emitStream(iframe, streamId, sseData.type, sseData.data, {
                    name: sseData.name,
                    args: sseData.args,
                    result: sseData.result,
                  });
                  if (
                    sseData.type === "text-delta" &&
                    typeof sseData.data === "string"
                  ) {
                    fullText += sseData.data;
                  }
                } catch {
                  // skip malformed SSE lines
                }
              }
            }
            result = { text: fullText };
          } else {
            result = await res.json();
          }
        } else if (
          method === "chat.getHistory" &&
          hasPermission(permissions, "agent")
        ) {
          const res = await fetch(
            `/api/web-sessions/${encodeURIComponent(params?.sessionId)}/messages`,
          );
          result = await res.json();
        } else if (
          method === "chat.getSessions" &&
          hasPermission(permissions, "agent")
        ) {
          const qs = params?.limit ? `?limit=${params.limit}` : "";
          const res = await fetch(`/api/web-sessions${qs}`);
          result = await res.json();
        } else if (
          method === "chat.abort" &&
          hasPermission(permissions, "agent")
        ) {
          const res = await fetch("/api/chat/stop", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: params?.sessionId }),
          });
          result = await res.json();
        } else if (
          method === "chat.isActive" &&
          hasPermission(permissions, "agent")
        ) {
          const res = await fetch("/api/chat/active");
          const data = await res.json();
          result = Array.isArray(data)
            ? data.includes(params?.sessionId)
            : false;

          // --- Agent ---
        } else if (
          method === "agent.send" &&
          hasPermission(permissions, "agent")
        ) {
          const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: [{ role: "user", content: params?.message }],
            }),
          });
          result = { ok: res.ok };

          // --- Tool Registration ---
        } else if (
          method === "tool.register" &&
          hasPermission(permissions, "agent")
        ) {
          const inst = appInstanceRef.current;
          if (inst && params?.name) {
            const toolDef: ToolDef = {
              name: params.name,
              description: params.description || "",
              inputSchema: params.inputSchema,
            };
            inst.tools.set(params.name, toolDef);
          }
          result = { ok: true };

          // --- Memory ---
        } else if (
          method === "memory.get" &&
          hasPermission(permissions, "agent")
        ) {
          const res = await fetch("/api/memories");
          result = await res.json();

          // --- UI ---
        } else if (
          method === "ui.toast" &&
          hasPermission(permissions, "ui")
        ) {
          if (onToast) {
            onToast(params?.message, { type: params?.type });
          }
          result = { ok: true };
        } else if (
          method === "ui.navigate" &&
          hasPermission(permissions, "ui")
        ) {
          if (onNavigate) {
            onNavigate(params?.path);
          }
          result = { ok: true };
        } else if (
          method === "ui.openEntry" &&
          hasPermission(permissions, "ui")
        ) {
          if (onNavigate) {
            onNavigate(`/${params?.objectName}/${params?.entryId}`);
          }
          result = { ok: true };
        } else if (
          method === "ui.setTitle" &&
          hasPermission(permissions, "ui")
        ) {
          // Handled by parent via tab state - emit a custom event
          window.dispatchEvent(
            new CustomEvent("useful:app-title-change", {
              detail: { appPath, title: params?.title },
            }),
          );
          result = { ok: true };
        } else if (
          method === "ui.confirm" &&
          hasPermission(permissions, "ui")
        ) {
          result = window.confirm(params?.message || "");
        } else if (
          method === "ui.prompt" &&
          hasPermission(permissions, "ui")
        ) {
          result = window.prompt(params?.message || "", params?.defaultValue || "");

          // --- Store ---
        } else if (
          method === "store.get" &&
          hasPermission(permissions, "store")
        ) {
          const res = await fetch(
            `/api/apps/store?app=${encodeURIComponent(appFolderName)}&key=${encodeURIComponent(params?.key)}`,
          );
          const data = await res.json();
          result = data.value;
        } else if (
          method === "store.set" &&
          hasPermission(permissions, "store")
        ) {
          const res = await fetch("/api/apps/store", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              app: appFolderName,
              key: params?.key,
              value: params?.value,
            }),
          });
          result = await res.json();
        } else if (
          method === "store.delete" &&
          hasPermission(permissions, "store")
        ) {
          const res = await fetch(
            `/api/apps/store?app=${encodeURIComponent(appFolderName)}&key=${encodeURIComponent(params?.key)}`,
            { method: "DELETE" },
          );
          result = await res.json();
        } else if (
          method === "store.list" &&
          hasPermission(permissions, "store")
        ) {
          const res = await fetch(
            `/api/apps/store?app=${encodeURIComponent(appFolderName)}`,
          );
          const data = await res.json();
          result = data.keys;
        } else if (
          method === "store.clear" &&
          hasPermission(permissions, "store")
        ) {
          const res = await fetch(
            `/api/apps/store?app=${encodeURIComponent(appFolderName)}`,
            { method: "DELETE" },
          );
          result = await res.json();

          // --- HTTP Proxy ---
        } else if (
          method === "http.fetch" &&
          hasPermission(permissions, "http")
        ) {
          const res = await fetch("/api/apps/proxy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url: params?.url,
              method: params?.method,
              headers: params?.headers,
              body: params?.body,
            }),
          });
          result = await res.json();

          // --- Events ---
        } else if (method === "events.subscribe") {
          subscribedChannelsRef.current.add(params?.channel);
          if (params?.channel === "theme.changed") {
            setupThemeObserver(iframe);
          }
          result = { ok: true };
        } else if (method === "events.unsubscribe") {
          subscribedChannelsRef.current.delete(params?.channel);
          result = { ok: true };

          // --- Apps ---
        } else if (
          method === "apps.send" &&
          hasPermission(permissions, "apps")
        ) {
          sendToApp(params?.targetApp, params?.message, appFolderName);
          result = { ok: true };
        } else if (
          method === "apps.list" &&
          hasPermission(permissions, "apps")
        ) {
          result = listActiveApps();

          // --- Cron ---
        } else if (
          method === "cron.schedule" &&
          hasPermission(permissions, "cron")
        ) {
          const res = await fetch("/api/apps/cron", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "add",
              params: {
                expression: params?.expression,
                message: params?.message,
                channel: params?.channel,
              },
            }),
          });
          result = await res.json();
        } else if (
          method === "cron.list" &&
          hasPermission(permissions, "cron")
        ) {
          const res = await fetch("/api/apps/cron");
          result = await res.json();
        } else if (
          method === "cron.run" &&
          hasPermission(permissions, "cron")
        ) {
          const res = await fetch("/api/apps/cron", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "run",
              params: { id: params?.jobId },
            }),
          });
          result = await res.json();
        } else if (
          method === "cron.cancel" &&
          hasPermission(permissions, "cron")
        ) {
          const res = await fetch("/api/apps/cron", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "remove",
              params: { id: params?.jobId },
            }),
          });
          result = await res.json();

          // --- Webhooks ---
        } else if (
          method === "webhooks.register" &&
          hasPermission(permissions, "webhooks")
        ) {
          const hookUrl = `${window.location.origin}/api/apps/webhooks/${encodeURIComponent(appFolderName)}/${encodeURIComponent(params?.hookName)}`;
          result = { url: hookUrl, hookName: params?.hookName };
        } else if (
          method === "webhooks.subscribe" &&
          hasPermission(permissions, "webhooks")
        ) {
          const hookName = params?.hookName;
          if (hookName && !webhookPollersRef.current.has(hookName)) {
            let lastTs = Date.now();
            const poller = setInterval(async () => {
              try {
                const res = await fetch(
                  `/api/apps/webhooks/${encodeURIComponent(appFolderName)}/${encodeURIComponent(hookName)}?poll=1&since=${lastTs}`,
                );
                const data = await res.json();
                if (data.events?.length) {
                  lastTs = Math.max(
                    ...data.events.map(
                      (e: { receivedAt: number }) => e.receivedAt,
                    ),
                  );
                  for (const evt of data.events) {
                    emitEvent(iframe, `webhooks.${hookName}`, evt);
                  }
                }
              } catch {
                /* polling error, will retry */
              }
            }, 5000);
            webhookPollersRef.current.set(hookName, poller);
          }
          result = { ok: true };
        } else if (
          method === "webhooks.poll" &&
          hasPermission(permissions, "webhooks")
        ) {
          const since = params?.since || 0;
          const res = await fetch(
            `/api/apps/webhooks/${encodeURIComponent(appFolderName)}/${encodeURIComponent(params?.hookName)}?poll=1&since=${since}`,
          );
          result = await res.json();

          // --- Clipboard ---
        } else if (
          method === "clipboard.write" &&
          hasPermission(permissions, "clipboard")
        ) {
          try {
            await navigator.clipboard.writeText(params?.text || "");
            result = { ok: true };
          } catch {
            // Fallback for non-secure contexts
            const ta = document.createElement("textarea");
            ta.value = params?.text || "";
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
            result = { ok: true };
          }
        } else if (
          method === "clipboard.read" &&
          hasPermission(permissions, "clipboard")
        ) {
          try {
            result = await navigator.clipboard.readText();
          } catch {
            result = null;
          }
        } else {
          sendResponse(iframe, id, null, `Unknown method or insufficient permissions: ${method}`);
          return;
        }

        sendResponse(iframe, id, result);
      } catch (err) {
        sendResponse(
          iframe,
          id,
          null,
          err instanceof Error ? err.message : "Unknown error",
        );
      }
    };

    let themeObserver: MutationObserver | null = null;
    function setupThemeObserver(iframe: HTMLIFrameElement) {
      if (themeObserver) return;
      themeObserver = new MutationObserver(() => {
        if (subscribedChannelsRef.current.has("theme.changed")) {
          const theme = document.documentElement.classList.contains("dark")
            ? "dark"
            : "light";
          emitEvent(iframe, "theme.changed", { theme });
        }
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });
    }

    function emitObjectEvent(
      _iframe: HTMLIFrameElement,
      channel: string,
      objectName: string,
      data: unknown,
    ) {
      // Emit to all subscribed apps via the registry
      const eventData = { objectName, ...(data as Record<string, unknown>) };
      // Emit locally if subscribed
      if (subscribedChannelsRef.current.has(channel)) {
        _iframe.contentWindow?.postMessage(
          { type: "useful:event", channel, data: eventData },
          "*",
        );
      }
    }

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      if (themeObserver) themeObserver.disconnect();
    };
  }, [manifest, appPath, appFolderName, permissions, onToast, onNavigate]);

  const iconIsImage = manifest.icon && (
    manifest.icon.endsWith(".png") ||
    manifest.icon.endsWith(".svg") ||
    manifest.icon.endsWith(".jpg") ||
    manifest.icon.endsWith(".jpeg") ||
    manifest.icon.endsWith(".webp")
  );

  return (
    <div className="flex flex-col h-full">
      {/* App header bar */}
      <div
        className="flex items-center gap-3 px-5 py-2.5 border-b flex-shrink-0"
        style={{ borderColor: "var(--color-border)" }}
      >
        {iconIsImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={appServeUrl(appPath, manifest.icon!)}
            alt=""
            width={20}
            height={20}
            className="rounded flex-shrink-0"
            style={{ objectFit: "cover" }}
          />
        ) : (
          <DefaultAppIcon />
        )}

        <span className="text-sm font-medium truncate" style={{ color: "var(--color-text)" }}>
          {manifest.name}
        </span>

        {manifest.version && (
          <span
            className="text-[10px] px-2 py-0.5 rounded-full flex-shrink-0"
            style={{
              background: "var(--color-accent-light)",
              color: "var(--color-accent)",
              border: "1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)",
            }}
          >
            v{manifest.version}
          </span>
        )}

        <span
          className="text-[10px] px-2 py-0.5 rounded-full flex-shrink-0"
          style={{
            background: "#6366f118",
            color: "#6366f1",
            border: "1px solid #6366f130",
          }}
        >
          APP
        </span>

        <div className="flex items-center gap-1 ml-auto">
          {/* Reload button */}
          <button
            type="button"
            onClick={handleReload}
            className="p-1.5 rounded-md transition-colors duration-100 cursor-pointer"
            style={{ color: "var(--color-text-muted)" }}
            title="Reload app"
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 16h5v5" />
            </svg>
          </button>

          {/* Open in new tab */}
          <a
            href={appUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-md transition-colors duration-100"
            style={{ color: "var(--color-text-muted)" }}
            title="Open in new tab"
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h6v6" /><path d="M10 14 21 3" />
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            </svg>
          </a>
        </div>
      </div>

      {/* App content */}
      <div className="flex-1 overflow-hidden relative" style={{ background: "white" }}>
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10" style={{ background: "var(--color-bg)" }}>
            {iconIsImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={appServeUrl(appPath, manifest.icon!)}
                alt=""
                width={48}
                height={48}
                className="rounded-xl"
                style={{ objectFit: "cover" }}
              />
            ) : (
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center"
                style={{ background: "var(--color-accent-light)" }}
              >
                <DefaultAppIcon size={24} />
              </div>
            )}
            <div
              className="w-5 h-5 border-2 rounded-full animate-spin"
              style={{
                borderColor: "var(--color-border)",
                borderTopColor: "var(--color-accent)",
              }}
            />
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              Loading {manifest.name}...
            </p>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10" style={{ background: "var(--color-bg)" }}>
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{ background: "color-mix(in srgb, var(--color-error) 10%, transparent)" }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" x2="9" y1="9" y2="15" />
                <line x1="9" x2="15" y1="9" y2="15" />
              </svg>
            </div>
            <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
              {error}
            </p>
            <button
              type="button"
              onClick={handleReload}
              className="text-xs px-3 py-1.5 rounded-md cursor-pointer"
              style={{
                color: "var(--color-accent)",
                background: "var(--color-accent-light)",
              }}
            >
              Try again
            </button>
          </div>
        )}

        <iframe
          ref={iframeRef}
          src={appUrl}
          className="w-full h-full border-0"
          sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
          title={manifest.name}
          onLoad={handleIframeLoad}
          onError={handleIframeError}
          style={{ minHeight: "calc(100vh - 120px)" }}
        />
      </div>
    </div>
  );
}

function DefaultAppIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" />
      <rect width="7" height="7" x="3" y="14" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" />
    </svg>
  );
}
