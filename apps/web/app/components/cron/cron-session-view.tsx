"use client";

import type { CronJob, CronRunLogEntry } from "../../types/cron";
import { ChatPanel } from "../chat-panel";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

export function CronSessionView({
  job,
  run,
  sessionId,
  onBack,
  onBackToJob,
}: {
  job: CronJob;
  run: CronRunLogEntry;
  sessionId: string;
  onBack: () => void;
  onBackToJob: () => void;
}) {
  const statusColor = run.status === "ok"
    ? "var(--color-success, #22c55e)"
    : run.status === "error"
      ? "var(--color-error, #ef4444)"
      : "var(--color-warning, #f59e0b)";

  return (
    <div className="h-full flex flex-col">
      {/* Header bar */}
      <div
        className="px-4 py-3 flex items-center gap-3 flex-shrink-0"
        style={{
          borderBottom: "1px solid var(--color-border)",
          background: "var(--color-bg-glass)",
        }}
      >
        <button
          type="button"
          onClick={onBack}
          className="p-1.5 rounded-lg flex-shrink-0 cursor-pointer"
          style={{ color: "var(--color-text-muted)" }}
          title="Back to Cron"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m12 19-7-7 7-7" />
            <path d="M19 12H5" />
          </svg>
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBackToJob}
              className="text-sm font-semibold truncate cursor-pointer hover:underline"
              style={{ color: "var(--color-text)" }}
              title="Back to job detail"
            >
              {job.name}
            </button>
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0"
              style={{
                background: `color-mix(in srgb, ${statusColor} 12%, transparent)`,
                color: statusColor,
              }}
            >
              {run.status ?? "unknown"}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
            <span>{new Date(run.ts).toLocaleString()}</span>
            {run.durationMs != null && (
              <span>{formatDuration(run.durationMs)}</span>
            )}
            {run.summary && (
              <span className="truncate">{run.summary}</span>
            )}
          </div>
        </div>
      </div>

      {/* ChatPanel loads the session via initialSessionId.
          The web-sessions API falls back to agent sessions, so this
          transparently loads cron run transcripts. */}
      <div className="flex-1 min-h-0">
        <ChatPanel
          initialSessionId={sessionId}
          sessionTitle={`${job.name} - Run ${new Date(run.ts).toLocaleString()}`}
        />
      </div>
    </div>
  );
}
