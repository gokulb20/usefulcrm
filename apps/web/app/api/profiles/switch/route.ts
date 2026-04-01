import {
  discoverWorkspaces,
  getActiveWorkspaceName,
  resolveHermesStateDir,
  resolveWorkspaceRoot,
  setUIActiveWorkspace,
} from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WORKSPACE_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

function normalizeSwitchWorkspace(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  if (!WORKSPACE_NAME_RE.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { workspace?: unknown; profile?: unknown };
  const requestedWorkspace = normalizeSwitchWorkspace(body.workspace ?? body.profile);
  if (!requestedWorkspace) {
    return Response.json(
      { error: "Invalid workspace name. Use letters, numbers, hyphens, or underscores." },
      { status: 400 },
    );
  }

  const discovered = discoverWorkspaces();
  const availableNames = new Set(discovered.map((workspace) => workspace.name));
  if (!availableNames.has(requestedWorkspace)) {
    return Response.json(
      { error: `Workspace '${requestedWorkspace}' was not found.` },
      { status: 404 },
    );
  }

  setUIActiveWorkspace(requestedWorkspace);
  const activeWorkspace = getActiveWorkspaceName();
  const selected = discoverWorkspaces().find((workspace) => workspace.name === activeWorkspace) ?? null;
  return Response.json({
    activeWorkspace,
    stateDir: resolveHermesStateDir(),
    workspaceRoot: resolveWorkspaceRoot(),
    workspace: selected,
    // Backward-compat response fields while clients migrate.
    activeProfile: activeWorkspace,
    profile: selected,
  });
}
