/**
 * Path-based app file server.
 *
 * Serves files from .useful.app folders via path-based URLs so that relative
 * references (CSS, JS, images) in HTML files resolve correctly.
 *
 * URL format: /api/apps/serve/<appPath>/<filePath>
 * Example:    /api/apps/serve/apps/pacman.useful.app/style.css
 *
 * The app path is everything up to and including ".useful.app".
 * The file path is everything after that.
 */
import { access, readFile, stat } from "node:fs/promises";
import { join, extname, resolve, relative } from "node:path";
import { resolveWorkspaceRoot } from "@/lib/workspace";
import { injectBridgeIntoHtml } from "@/lib/app-bridge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".xml": "application/xml",
  ".yaml": "text/yaml; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
};

function getMimeType(filepath: string): string {
  const ext = extname(filepath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Split a URL path into app path and file path.
 * The app path is everything up to and including ".useful.app".
 * e.g. "apps/pacman.useful.app/style.css" -> ["apps/pacman.useful.app", "style.css"]
 */
function splitAppPath(segments: string[]): { appPath: string; filePath: string } | null {
  const joined = segments.join("/");
  const marker = ".useful.app";
  const idx = joined.indexOf(marker);
  if (idx === -1) return null;

  const appEnd = idx + marker.length;
  const appPath = joined.slice(0, appEnd);
  const filePath = joined.slice(appEnd + 1) || "index.html";
  return { appPath, filePath };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await params;

  const split = splitAppPath(segments);
  if (!split) {
    return Response.json({ error: "Invalid app path — must contain .useful.app" }, { status: 400 });
  }

  const { appPath, filePath } = split;

  const workspaceRoot = resolveWorkspaceRoot();
  if (!workspaceRoot) {
    return Response.json({ error: "No workspace configured" }, { status: 404 });
  }

  const appAbsPath = resolve(join(workspaceRoot, appPath));
  const relToWorkspace = relative(workspaceRoot, appAbsPath);
  if (relToWorkspace.startsWith("..") || relToWorkspace.startsWith("/")) {
    return Response.json({ error: "Path traversal denied" }, { status: 403 });
  }

  const fileAbsPath = resolve(join(appAbsPath, filePath));
  const relToApp = relative(appAbsPath, fileAbsPath);
  if (relToApp.startsWith("..") || relToApp.startsWith("/")) {
    return Response.json({ error: "Path traversal denied" }, { status: 403 });
  }

  if (!await pathExists(fileAbsPath)) {
    return Response.json({ error: "File not found" }, { status: 404 });
  }

  try {
    const fileStat = await stat(fileAbsPath);
    if (!fileStat.isFile()) {
      return Response.json({ error: "Not a file" }, { status: 400 });
    }

    const mimeType = getMimeType(filePath);
    const ext = extname(filePath).toLowerCase();

    if (ext === ".html" || ext === ".htm") {
      const htmlContent = await readFile(fileAbsPath, "utf-8");
      const injected = injectBridgeIntoHtml(htmlContent);
      return new Response(injected, {
        status: 200,
        headers: {
          "Content-Type": mimeType,
          "Cache-Control": "no-cache",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    const content = await readFile(fileAbsPath);
    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(content.length),
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "Failed to read file" }, { status: 500 });
  }
}
