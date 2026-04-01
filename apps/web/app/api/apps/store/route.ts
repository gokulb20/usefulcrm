import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { resolveFilesystemPath } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function storePath(appName: string): string | null {
  const wsRoot = resolveFilesystemPath("");
  if (!wsRoot) return null;
  return join(wsRoot.absolutePath, ".useful-app-data", appName, "store.json");
}

function readStore(appName: string): Record<string, unknown> {
  const p = storePath(appName);
  if (!p || !existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

function writeStore(appName: string, data: Record<string, unknown>): boolean {
  const p = storePath(appName);
  if (!p) return false;
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
  return true;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const app = url.searchParams.get("app");
  const key = url.searchParams.get("key");

  if (!app) {
    return Response.json({ error: "Missing 'app' param" }, { status: 400 });
  }

  const store = readStore(app);

  if (key) {
    return Response.json({ value: store[key] ?? null });
  }
  return Response.json({ keys: Object.keys(store) });
}

export async function POST(req: Request) {
  let body: { app?: string; key?: string; value?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { app, key, value } = body;
  if (!app || !key) {
    return Response.json(
      { error: "Missing 'app' or 'key'" },
      { status: 400 },
    );
  }

  const store = readStore(app);
  store[key] = value;
  writeStore(app, store);
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const app = url.searchParams.get("app");
  const key = url.searchParams.get("key");

  if (!app) {
    return Response.json({ error: "Missing 'app' param" }, { status: 400 });
  }

  const store = readStore(app);

  if (key) {
    delete store[key];
  } else {
    for (const k of Object.keys(store)) delete store[k];
  }

  writeStore(app, store);
  return Response.json({ ok: true });
}
