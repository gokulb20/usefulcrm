"use client";

import { useEffect } from "react";

function isChunkLoadError(error: Error & { name?: string }): boolean {
  if (error.name === "ChunkLoadError") return true;
  if (error.message?.includes("Loading chunk")) return true;
  if (error.message?.includes("Loading CSS chunk")) return true;
  return false;
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (isChunkLoadError(error)) {
      const key = "__chunk_reload";
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, "1");
        window.location.reload();
        return;
      }
      sessionStorage.removeItem(key);
    }
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          fontFamily: "Inter, system-ui, sans-serif",
          background: "#0a0a0a",
          color: "#e5e5e5",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 420, padding: 24 }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
            {isChunkLoadError(error)
              ? "A new version is available"
              : "Something went wrong"}
          </h2>
          <p style={{ fontSize: 14, color: "#a3a3a3", marginBottom: 20 }}>
            {isChunkLoadError(error)
              ? "The app was updated while you had it open. Reload to get the latest version."
              : "An unexpected error occurred. Try reloading the page."}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "8px 20px",
              borderRadius: 6,
              border: "1px solid #333",
              background: "#1a1a1a",
              color: "#e5e5e5",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
