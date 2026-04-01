"use client";

import { AppViewer, appServeUrl } from "./app-viewer";
import type { UsefulAppManifest } from "../../workspace/workspace-content";

type WidgetApp = {
  appPath: string;
  manifest: UsefulAppManifest & {
    display?: string;
    widget?: { width?: number; height?: number; refreshInterval?: number };
  };
};

type AppWidgetGridProps = {
  apps: WidgetApp[];
  onToast?: (message: string, opts?: { type?: string }) => void;
  onNavigate?: (path: string) => void;
};

const CELL_HEIGHT = 200;

export function AppWidgetGrid({ apps, onToast, onNavigate }: AppWidgetGridProps) {
  if (apps.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-3 h-64"
        style={{ color: "var(--color-text-muted)" }}
      >
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect width="7" height="7" x="3" y="3" rx="1" />
          <rect width="7" height="7" x="14" y="3" rx="1" />
          <rect width="7" height="7" x="3" y="14" rx="1" />
          <rect width="7" height="7" x="14" y="14" rx="1" />
        </svg>
        <p className="text-sm">
          No widget apps found. Create an app with{" "}
          <code
            className="px-1 py-0.5 rounded text-xs"
            style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
          >
            display: &quot;widget&quot;
          </code>{" "}
          in its manifest.
        </p>
      </div>
    );
  }

  return (
    <div
      className="grid gap-4 p-6"
      style={{
        gridTemplateColumns: "repeat(4, 1fr)",
      }}
    >
      {apps.map((app) => {
        const w = app.manifest.widget?.width || 1;
        const h = app.manifest.widget?.height || 1;

        return (
          <div
            key={app.appPath}
            className="rounded-xl overflow-hidden"
            style={{
              gridColumn: `span ${Math.min(w, 4)}`,
              gridRow: `span ${Math.min(h, 4)}`,
              height: `${Math.min(h, 4) * CELL_HEIGHT}px`,
              border: "1px solid var(--color-border)",
              background: "var(--color-surface)",
            }}
          >
            <WidgetFrame
              appPath={app.appPath}
              manifest={app.manifest}
              refreshInterval={app.manifest.widget?.refreshInterval}
              onToast={onToast}
              onNavigate={onNavigate}
            />
          </div>
        );
      })}
    </div>
  );
}

function WidgetFrame({
  appPath,
  manifest,
  refreshInterval,
  onToast,
  onNavigate,
}: {
  appPath: string;
  manifest: UsefulAppManifest;
  refreshInterval?: number;
  onToast?: (message: string, opts?: { type?: string }) => void;
  onNavigate?: (path: string) => void;
}) {
  const entryFile = manifest.entry || "index.html";
  const appUrl = appServeUrl(appPath, entryFile);

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex items-center gap-2 px-3 py-1.5 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--color-border)" }}
      >
        <span
          className="text-xs font-medium truncate"
          style={{ color: "var(--color-text)" }}
        >
          {manifest.name}
        </span>
        {refreshInterval && (
          <span
            className="text-[9px] ml-auto"
            style={{ color: "var(--color-text-muted)" }}
          >
            ⟳ {refreshInterval}s
          </span>
        )}
      </div>
      <div className="flex-1 overflow-hidden">
        <AppViewer
          appPath={appPath}
          manifest={manifest}
          onToast={onToast}
          onNavigate={onNavigate}
        />
      </div>
    </div>
  );
}
