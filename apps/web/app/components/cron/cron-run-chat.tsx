"use client";

import { useEffect, useState, useCallback } from "react";
import type { UIMessage } from "ai";
import type { SessionMessage, CronRunSessionResponse } from "../../types/cron";
import { ChatMessage } from "../chat-message";

/* ─── ChatLine → UIMessage conversion (same format as web chat) ─── */

type ChatLine = {
  id: string;
  role: "user" | "assistant";
  content: string;
  parts?: Array<Record<string, unknown>>;
  timestamp: string;
};

function chatLineToUIMessage(line: ChatLine): UIMessage {
  return {
    id: line.id,
    role: line.role,
    parts: (line.parts ?? [{ type: "text" as const, text: line.content }]) as UIMessage["parts"],
  } as UIMessage;
}

/* ─── Main component ─── */

export function CronRunChat({ sessionId }: { sessionId: string }) {
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSession = useCallback(async () => {
    try {
      // Use web-sessions API which has agent session fallback,
      // returning messages in UIMessage-compatible format
      const res = await fetch(`/api/web-sessions/${encodeURIComponent(sessionId)}`);
      if (!res.ok) {
        // Fallback to cron-specific API for legacy compatibility
        const cronRes = await fetch(`/api/cron/runs/${encodeURIComponent(sessionId)}`);
        if (!cronRes.ok) {
          setError(cronRes.status === 404 ? "Session transcript not found" : "Failed to load session");
          return;
        }
        const cronData: CronRunSessionResponse = await cronRes.json();
        // Convert legacy SessionMessage format to ChatLine format
        const converted: ChatLine[] = (cronData.messages ?? [])
          .filter((m: SessionMessage) => m.role !== "system")
          .map((m: SessionMessage) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.parts
              .filter((p) => p.type === "text")
              .map((p) => (p as { text: string }).text)
              .join("\n"),
            parts: m.parts.map((p) => {
              if (p.type === "text") return { type: "text", text: p.text };
              if (p.type === "thinking") return { type: "reasoning", text: p.thinking };
              if (p.type === "tool-call") {
                const result = p.output != null
                  ? (() => { try { return JSON.parse(p.output); } catch { return { output: p.output }; } })()
                  : undefined;
                const part: Record<string, unknown> = {
                  type: "tool-invocation",
                  toolCallId: p.toolCallId,
                  toolName: p.toolName,
                  args: p.args ?? {},
                };
                if (result != null) part.result = result;
                return part;
              }
              return { type: "text", text: "" };
            }),
            timestamp: m.timestamp,
          }));
        setMessages(converted);
        return;
      }
      const data = await res.json() as { messages?: ChatLine[] };
      setMessages(data.messages ?? []);
    } catch {
      setError("Failed to load session");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void fetchSession();
  }, [fetchSession]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4">
        <div
          className="w-4 h-4 border-[1.5px] rounded-full animate-spin"
          style={{ borderColor: "var(--color-border)", borderTopColor: "var(--color-accent)" }}
        />
        <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Loading session transcript...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="text-xs rounded-lg px-3 py-2"
        style={{ color: "var(--color-text-muted)", background: "var(--color-surface-hover)" }}
      >
        {error}
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="text-xs py-2" style={{ color: "var(--color-text-muted)" }}>
        Empty session transcript.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="text-[11px] uppercase tracking-wider font-medium mb-2" style={{ color: "var(--color-text-muted)" }}>
        Session Transcript
      </div>
      {messages.map((line) => (
        <ChatMessage key={line.id} message={chatLineToUIMessage(line)} />
      ))}
    </div>
  );
}

/* ─── Transcript search fallback (no sessionId) ─── */

export function CronRunTranscriptSearch({
  jobId,
  runAtMs,
  summary,
  fallback,
}: {
  jobId: string;
  runAtMs?: number;
  summary?: string;
  fallback?: React.ReactNode;
}) {
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const fetchTranscript = useCallback(async () => {
    if (!runAtMs || !summary) {
      setLoading(false);
      setNotFound(true);
      return;
    }
    try {
      const params = new URLSearchParams({
        jobId,
        runAtMs: String(runAtMs),
        summary,
      });
      const res = await fetch(`/api/cron/runs/search-transcript?${params}`);
      if (!res.ok) {
        setNotFound(true);
        return;
      }
      const data = await res.json() as { sessionId?: string; messages?: SessionMessage[] };
      // If we got a sessionId back, try to load via web-sessions for better formatting
      if (data.sessionId) {
        const wsRes = await fetch(`/api/web-sessions/${encodeURIComponent(data.sessionId)}`);
        if (wsRes.ok) {
          const wsData = await wsRes.json() as { messages?: ChatLine[] };
          if (wsData.messages && wsData.messages.length > 0) {
            setMessages(wsData.messages);
            return;
          }
        }
      }
      // Fallback to SessionMessage conversion
      if (data.messages && data.messages.length > 0) {
        const converted: ChatLine[] = data.messages
          .filter((m) => m.role !== "system")
          .map((m) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.parts
              .filter((p) => p.type === "text")
              .map((p) => (p as { text: string }).text)
              .join("\n"),
            parts: m.parts.map((p) => {
              if (p.type === "text") return { type: "text", text: p.text };
              if (p.type === "thinking") return { type: "reasoning", text: p.thinking };
              if (p.type === "tool-call") {
                const result = p.output != null
                  ? (() => { try { return JSON.parse(p.output); } catch { return { output: p.output }; } })()
                  : undefined;
                const part: Record<string, unknown> = {
                  type: "tool-invocation",
                  toolCallId: p.toolCallId,
                  toolName: p.toolName,
                  args: p.args ?? {},
                };
                if (result != null) part.result = result;
                return part;
              }
              return { type: "text", text: "" };
            }),
            timestamp: m.timestamp,
          }));
        setMessages(converted);
      } else {
        setNotFound(true);
      }
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [jobId, runAtMs, summary]);

  useEffect(() => {
    void fetchTranscript();
  }, [fetchTranscript]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4">
        <div
          className="w-4 h-4 border-[1.5px] rounded-full animate-spin"
          style={{ borderColor: "var(--color-border)", borderTopColor: "var(--color-accent)" }}
        />
        <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Searching for transcript...</span>
      </div>
    );
  }

  if (notFound || messages.length === 0) {
    return <>{fallback}</>;
  }

  return (
    <div className="space-y-1">
      <div className="text-[11px] uppercase tracking-wider font-medium mb-2" style={{ color: "var(--color-text-muted)" }}>
        Session Transcript
      </div>
      {messages.map((line) => (
        <ChatMessage key={line.id} message={chatLineToUIMessage(line)} />
      ))}
    </div>
  );
}
