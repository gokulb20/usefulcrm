import { access, readFile, stat } from "node:fs/promises";
import { join, extname, resolve, relative } from "node:path";
import { resolveWorkspaceRoot, parseSimpleYaml } from "@/lib/workspace";
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const appPath = url.searchParams.get("app");
  const filePath = url.searchParams.get("file");
  const metaOnly = url.searchParams.get("meta") === "1";

  if (!appPath) {
    return Response.json({ error: "Missing 'app' parameter" }, { status: 400 });
  }

  const workspaceRoot = resolveWorkspaceRoot();
  if (!workspaceRoot) {
    return Response.json({ error: "No workspace configured" }, { status: 404 });
  }

  const appAbsPath = resolve(join(workspaceRoot, appPath));

  // Security: ensure the resolved path is within the workspace
  const relToWorkspace = relative(workspaceRoot, appAbsPath);
  if (relToWorkspace.startsWith("..") || relToWorkspace.startsWith("/")) {
    return Response.json({ error: "Path traversal denied" }, { status: 403 });
  }

  if (!await pathExists(appAbsPath)) {
    return Response.json({ error: "App not found" }, { status: 404 });
  }

  // Meta-only request: return parsed .useful.yaml manifest
  if (metaOnly) {
    const manifestPath = join(appAbsPath, ".useful.yaml");
    if (!await pathExists(manifestPath)) {
      return Response.json({ name: appPath.split("/").pop()?.replace(/\.useful\.app$/, "") || "App" });
    }
    try {
      const content = await readFile(manifestPath, "utf-8");
      const parsed = parseSimpleYaml(content);
      return Response.json({
        name: parsed.name || appPath.split("/").pop()?.replace(/\.useful\.app$/, "") || "App",
        description: parsed.description,
        icon: parsed.icon,
        version: parsed.version,
        author: parsed.author,
        entry: parsed.entry || "index.html",
        runtime: parsed.runtime || "static",
        permissions: parsed.permissions,
      });
    } catch {
      return Response.json({ name: "App" });
    }
  }

  // Serve a specific file from the app directory
  if (!filePath) {
    return Response.json({ error: "Missing 'file' parameter" }, { status: 400 });
  }

  const fileAbsPath = resolve(join(appAbsPath, filePath));

  // Security: ensure file is within the app directory
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

    // For HTML files, inject the UsefulCRM bridge SDK
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
