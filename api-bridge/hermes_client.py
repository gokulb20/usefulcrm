"""
hermes_client.py — Hermes Agent integration for the UsefulCRM API bridge.

Provides a clean interface to send messages to a running Hermes agent and
stream back SSE events. The bridge supports two transport modes:

  1. subprocess  — Spawn `hermes` CLI as a child process and stream its
                   stdout line-by-line (default, no daemon required).
  2. http        — Talk to an already-running Hermes web server via HTTP.
                   Set HERMES_HTTP_URL env var to enable.

Usage
-----
    from hermes_client import HermesClient, HermesResponse

    client = HermesClient()
    for chunk in client.stream_message("List all contacts in the CRM"):
        print(chunk)
"""

import json
import os
import subprocess
import sys
import time
import uuid
from collections.abc import Generator
from dataclasses import dataclass, field
from typing import Any, Optional


# ── Config ────────────────────────────────────────────────────────────────────

DEFAULT_HERMES_BIN = os.environ.get("HERMES_BIN", "hermes")
DEFAULT_HERMES_HTTP_URL = os.environ.get("HERMES_HTTP_URL", "")
DEFAULT_WORKSPACE_DIR = os.environ.get(
    "USEFUL_WORKSPACE_DIR",
    os.path.expanduser("~/hermes-workspace"),
)
DEFAULT_SESSION_TIMEOUT = int(os.environ.get("HERMES_TIMEOUT", "120"))


# ── Types ─────────────────────────────────────────────────────────────────────

@dataclass
class HermesMessage:
    role: str  # "user" | "assistant"
    content: str
    timestamp: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return {
            "role": self.role,
            "content": self.content,
            "timestamp": self.timestamp,
        }


@dataclass
class HermesChunk:
    """A single SSE chunk from the Hermes agent."""
    type: str            # "text-delta" | "tool-call" | "tool-result" | "done" | "error"
    content: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_sse(self) -> str:
        """Format as SSE wire format for forwarding to the browser."""
        payload = json.dumps({"type": self.type, "content": self.content, **self.metadata})
        return f"data: {payload}\n\n"

    def to_dict(self) -> dict[str, Any]:
        return {"type": self.type, "content": self.content, **self.metadata}


@dataclass
class HermesResponse:
    """Accumulated response from a Hermes agent run."""
    text: str = ""
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    error: Optional[str] = None
    session_id: Optional[str] = None
    duration_ms: Optional[float] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "text": self.text,
            "tool_calls": self.tool_calls,
            "error": self.error,
            "session_id": self.session_id,
            "duration_ms": self.duration_ms,
        }


# ── Client ────────────────────────────────────────────────────────────────────

class HermesClient:
    """
    High-level client for interacting with a Hermes agent.

    Supports two transport modes:
      - subprocess: Spawn the hermes CLI directly.
      - http:       Talk to a running Hermes web server.

    The mode is selected automatically based on env vars.
    """

    def __init__(
        self,
        workspace_dir: str = DEFAULT_WORKSPACE_DIR,
        hermes_bin: str = DEFAULT_HERMES_BIN,
        http_url: str = DEFAULT_HERMES_HTTP_URL,
        timeout: int = DEFAULT_SESSION_TIMEOUT,
    ):
        self.workspace_dir = workspace_dir
        self.hermes_bin = hermes_bin
        self.http_url = http_url.rstrip("/")
        self.timeout = timeout
        self._mode = "http" if self.http_url else "subprocess"

    # ── Public API ────────────────────────────────────────────────────────────

    def send_message(self, message: str, session_id: Optional[str] = None) -> HermesResponse:
        """
        Send a message and collect the full response (blocking).

        Returns a HermesResponse with the accumulated text and tool calls.
        """
        response = HermesResponse(session_id=session_id or str(uuid.uuid4()))
        start = time.time()
        chunks = list(self.stream_message(message, session_id=response.session_id))
        response.duration_ms = (time.time() - start) * 1000

        for chunk in chunks:
            if chunk.type == "text-delta":
                response.text += chunk.content
            elif chunk.type == "tool-call":
                response.tool_calls.append(chunk.metadata)
            elif chunk.type == "error":
                response.error = chunk.content

        return response

    def stream_message(
        self,
        message: str,
        session_id: Optional[str] = None,
    ) -> Generator[HermesChunk, None, None]:
        """
        Send a message and yield HermesChunk objects as they arrive.

        The last chunk will have type="done".
        """
        if self._mode == "http":
            yield from self._stream_via_http(message, session_id)
        else:
            yield from self._stream_via_subprocess(message, session_id)

    def health_check(self) -> dict[str, Any]:
        """
        Check if the Hermes agent is reachable.

        Returns {"ok": True, "mode": ...} or {"ok": False, "error": ...}.
        """
        if self._mode == "http":
            return self._http_health_check()
        else:
            return self._subprocess_health_check()

    # ── Subprocess transport ──────────────────────────────────────────────────

    def _stream_via_subprocess(
        self,
        message: str,
        session_id: Optional[str] = None,
    ) -> Generator[HermesChunk, None, None]:
        """
        Spawn the hermes CLI and stream its output.

        Hermes CLI is invoked in non-interactive (headless) mode.
        We parse its stdout for structured JSON event lines.
        """
        sid = session_id or str(uuid.uuid4())
        cmd = self._build_subprocess_cmd(message, sid)

        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                cwd=self.workspace_dir if os.path.isdir(self.workspace_dir) else None,
                env={**os.environ, "NO_COLOR": "1", "TERM": "dumb"},
            )
        except FileNotFoundError:
            yield HermesChunk(
                type="error",
                content=f"Hermes binary not found at '{self.hermes_bin}'. "
                        "Set HERMES_BIN env var or install hermes globally.",
            )
            return
        except Exception as exc:
            yield HermesChunk(type="error", content=f"Failed to spawn Hermes: {exc}")
            return

        assert proc.stdout is not None
        accumulated_text = ""

        try:
            for line in proc.stdout:
                line = line.rstrip("\n")
                if not line:
                    continue

                chunk = self._parse_subprocess_line(line)
                if chunk:
                    if chunk.type == "text-delta":
                        accumulated_text += chunk.content
                    yield chunk

        except Exception as exc:
            yield HermesChunk(type="error", content=f"Stream read error: {exc}")
        finally:
            proc.wait(timeout=5)

        # Emit a final text chunk if we got plain stdout but no structured events
        if accumulated_text == "" and proc.returncode == 0:
            # Collect any remaining stderr for diagnostics
            stderr_out = ""
            if proc.stderr:
                try:
                    stderr_out = proc.stderr.read()
                except Exception:
                    pass
            if stderr_out:
                yield HermesChunk(type="error", content=stderr_out[:500])

        yield HermesChunk(type="done", content="", metadata={"session_id": sid})

    def _build_subprocess_cmd(self, message: str, session_id: str) -> list[str]:
        """
        Build the hermes CLI command for a headless run.

        Adjust these flags to match the actual Hermes CLI interface.
        """
        return [
            self.hermes_bin,
            "run",
            "--message", message,
            "--session-id", session_id,
            "--output-format", "jsonl",   # structured JSONL output
            "--no-interactive",
        ]

    def _parse_subprocess_line(self, line: str) -> Optional[HermesChunk]:
        """
        Parse a single stdout line from the hermes subprocess.

        Hermes emits either:
          - JSONL structured events: {"type": "text-delta", "content": "..."}
          - Plain text (fallback)
        """
        line = line.strip()
        if not line:
            return None

        # Try structured JSON first
        if line.startswith("{"):
            try:
                event = json.loads(line)
                event_type = event.get("type", "text-delta")
                content = event.get("content", event.get("text", event.get("delta", "")))
                metadata = {k: v for k, v in event.items() if k not in ("type", "content")}
                return HermesChunk(type=event_type, content=str(content), metadata=metadata)
            except json.JSONDecodeError:
                pass

        # SSE-style: "data: {...}"
        if line.startswith("data: "):
            raw = line[6:].strip()
            if raw == "[DONE]":
                return HermesChunk(type="done", content="")
            try:
                event = json.loads(raw)
                event_type = event.get("type", "text-delta")
                content = event.get("content", event.get("text", event.get("delta", "")))
                metadata = {k: v for k, v in event.items() if k not in ("type", "content")}
                return HermesChunk(type=event_type, content=str(content), metadata=metadata)
            except json.JSONDecodeError:
                pass

        # Plain text fallback — treat as incremental text
        return HermesChunk(type="text-delta", content=line + "\n")

    def _subprocess_health_check(self) -> dict[str, Any]:
        """Check if the hermes binary is available."""
        try:
            result = subprocess.run(
                [self.hermes_bin, "--version"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            return {
                "ok": result.returncode == 0,
                "mode": "subprocess",
                "version": result.stdout.strip() or result.stderr.strip(),
            }
        except FileNotFoundError:
            return {
                "ok": False,
                "mode": "subprocess",
                "error": f"Hermes binary not found at '{self.hermes_bin}'",
            }
        except Exception as exc:
            return {"ok": False, "mode": "subprocess", "error": str(exc)}

    # ── HTTP transport ────────────────────────────────────────────────────────

    def _stream_via_http(
        self,
        message: str,
        session_id: Optional[str] = None,
    ) -> Generator[HermesChunk, None, None]:
        """
        Stream from a running Hermes web server via its SSE endpoint.

        Expects the Hermes server to expose POST /api/chat with SSE response.
        """
        try:
            import urllib.request
            import urllib.error
        except ImportError:
            yield HermesChunk(type="error", content="urllib not available")
            return

        sid = session_id or str(uuid.uuid4())
        url = f"{self.http_url}/api/chat"
        payload = json.dumps({
            "message": message,
            "sessionId": sid,
            "stream": True,
        }).encode()

        req = urllib.request.Request(
            url,
            data=payload,
            headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                for raw_line in resp:
                    line = raw_line.decode("utf-8").rstrip("\n")
                    chunk = self._parse_subprocess_line(line)
                    if chunk:
                        yield chunk
        except urllib.error.URLError as exc:
            yield HermesChunk(
                type="error",
                content=f"Cannot reach Hermes at {url}: {exc}",
            )
        except Exception as exc:
            yield HermesChunk(type="error", content=f"HTTP stream error: {exc}")

        yield HermesChunk(type="done", content="", metadata={"session_id": sid})

    def _http_health_check(self) -> dict[str, Any]:
        """Ping the Hermes HTTP server."""
        import urllib.request
        import urllib.error

        url = f"{self.http_url}/health"
        try:
            with urllib.request.urlopen(url, timeout=5) as resp:
                body = resp.read().decode()
                return {"ok": True, "mode": "http", "response": body[:200]}
        except Exception as exc:
            return {"ok": False, "mode": "http", "error": str(exc)}


# ── Convenience singleton ─────────────────────────────────────────────────────

_default_client: Optional[HermesClient] = None


def get_client() -> HermesClient:
    """Return the default singleton HermesClient (lazy-initialized)."""
    global _default_client
    if _default_client is None:
        _default_client = HermesClient()
    return _default_client


# ── CLI smoke test ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    msg = " ".join(sys.argv[1:]) or "Hello! Please introduce yourself briefly."
    client = HermesClient()

    print(f"[hermes_client] mode={client._mode}")
    print(f"[hermes_client] sending: {msg!r}\n")

    for chunk in client.stream_message(msg):
        if chunk.type == "text-delta":
            print(chunk.content, end="", flush=True)
        elif chunk.type == "done":
            print("\n[done]")
        elif chunk.type == "error":
            print(f"\n[error] {chunk.content}", file=sys.stderr)
