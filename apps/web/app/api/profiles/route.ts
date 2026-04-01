import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { discoverWorkspaces, getActiveWorkspaceName } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type GatewayMeta = {
  mode?: string;
  port?: number;
  url?: string;
};

function readGatewayMeta(stateDir: string): GatewayMeta | null {
  for (const filename of ["hermes.json", "config.json"]) {
    const configPath = join(stateDir, filename);
    if (!existsSync(configPath)) {
      continue;
    }
    try {
      const raw = JSON.parse(readFileSync(configPath, "utf-8")) as {
        gateway?: { mode?: unknown; port?: unknown };
      };
      const port = typeof raw.gateway?.port === "number"
        ? raw.gateway.port
        : typeof raw.gateway?.port === "string"
          ? Number.parseInt(raw.gateway.port, 10)
          : undefined;
      const mode = typeof raw.gateway?.mode === "string" ? raw.gateway.mode : undefined;
      return {
        ...(mode ? { mode } : {}),
        ...(Number.isFinite(port) ? { port } : {}),
        ...(Number.isFinite(port) ? { url: `ws://127.0.0.1:${port}` } : {}),
      };
    } catch {
      // Continue to fallback config file candidate.
    }
  }
  return null;
}

export async function GET() {
  const workspaces = discoverWorkspaces().map((workspace) => ({
    ...workspace,
    gateway: readGatewayMeta(workspace.stateDir),
  }));
  const activeWorkspace = getActiveWorkspaceName() ?? workspaces.find((item) => item.isActive)?.name ?? null;

  return Response.json({
    workspaces,
    activeWorkspace,
    // Backward-compat response fields while web callers migrate away from /api/profiles.
    profiles: workspaces,
    activeProfile: activeWorkspace,
  });
}
