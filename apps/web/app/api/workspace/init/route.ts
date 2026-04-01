import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  discoverWorkspaces,
  setUIActiveWorkspace,
  getActiveWorkspaceName,
  resolveHermesStateDir,
  resolveWorkspaceDirForName,
  isValidWorkspaceName,
  resolveWorkspaceRoot,
  ensureAgentInConfig,
} from "@/lib/workspace";
import {
  BOOTSTRAP_TEMPLATE_CONTENT,
  type BootstrapTemplateName,
} from "@/lib/workspace-bootstrap-templates";
import {
  seedWorkspaceFromAssets,
} from "@/lib/workspace-seed";
import { trackServer } from "@/lib/telemetry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Bootstrap file names (must match src/agents/workspace.ts)
// ---------------------------------------------------------------------------

const BOOTSTRAP_FILENAMES = [
  "AGENTS.md",
  "SOUL.md",
  "TOOLS.md",
  "IDENTITY.md",
  "USER.md",
  "HEARTBEAT.md",
  "BOOTSTRAP.md",
] as const;

const ROOT_MARKER = join("assets", "seed", "workspace.duckdb");
const TEMPLATE_DIR = join("assets", "seed", "templates");

const WORKSPACE_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripFrontMatter(content: string): string {
  if (!content.startsWith("---")) {return content;}
  const endIndex = content.indexOf("\n---", 3);
  if (endIndex === -1) {return content;}
  return content.slice(endIndex + "\n---".length).replace(/^\s+/, "");
}

/** Try multiple candidate paths to find the monorepo root. */
function resolveProjectRoot(): string | null {
  let dir = process.cwd();
  for (let index = 0; index < 10; index += 1) {
    if (existsSync(join(dir, "package.json")) && existsSync(join(dir, ROOT_MARKER))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  return null;
}

function loadTemplateContent(filename: string, projectRoot: string | null): string {
  if (projectRoot) {
    const templatePath = join(projectRoot, TEMPLATE_DIR, filename);
    try {
      const raw = readFileSync(templatePath, "utf-8");
      return stripFrontMatter(raw);
    } catch {
      // fall through to fallback
    }
  }
  return BOOTSTRAP_TEMPLATE_CONTENT[filename as BootstrapTemplateName] ?? "";
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    workspace?: string;
    profile?: string;
    path?: string;
    seedBootstrap?: boolean;
  };
  const workspaceName = (body.workspace ?? body.profile)?.trim() || "";
  if (!workspaceName) {
    return Response.json(
      { error: "Workspace name is required." },
      { status: 400 },
    );
  }
  if (body.path?.trim()) {
    return Response.json(
      { error: "Custom workspace paths are currently disabled. Workspaces are created in ~/.hermes-useful." },
      { status: 400 },
    );
  }
  if (!WORKSPACE_NAME_RE.test(workspaceName) || !isValidWorkspaceName(workspaceName)) {
    return Response.json(
      {
        error:
          "Invalid or reserved workspace name. Use letters, numbers, hyphens, or underscores. Reserved names include 'main', 'default', and 'chat-slot-*'.",
      },
      { status: 400 },
    );
  }

  const existingWorkspaces = discoverWorkspaces();
  if (existingWorkspaces.some((workspace) => workspace.name.toLowerCase() === workspaceName.toLowerCase())) {
    return Response.json(
      { error: `Workspace '${workspaceName}' already exists.` },
      { status: 409 },
    );
  }

  const stateDir = resolveHermesStateDir();
  const workspaceDir = resolveWorkspaceDirForName(workspaceName);
  const seedBootstrap = body.seedBootstrap !== false;
  const seeded: string[] = [];
  const copiedFiles: string[] = [];

  const projectRoot = resolveProjectRoot();

  try {
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(workspaceDir, { recursive: false });
  } catch (err) {
    return Response.json(
      { error: `Failed to prepare workspace directory: ${(err as Error).message}` },
      { status: 500 },
    );
  }

  if (seedBootstrap) {
    for (const filename of BOOTSTRAP_FILENAMES) {
      const filePath = join(workspaceDir, filename);
      if (!existsSync(filePath)) {
        const content = loadTemplateContent(filename, projectRoot);
        try {
          writeFileSync(filePath, content, { encoding: "utf-8", flag: "wx" });
          seeded.push(filename);
        } catch {
          // race / already exists
        }
      }
    }
  }

  // Seed managed skills, DuckDB, and CRM object projections.
  // UsefulCRM identity is injected at runtime via the useful-identity plugin.
  if (projectRoot) {
    const seedResult = seedWorkspaceFromAssets({ workspaceDir, packageRoot: projectRoot });
    seeded.push(...seedResult.projectionFiles);
    if (seedResult.seeded) {
      seeded.push("workspace.duckdb");
    }
  }

  if (seedBootstrap) {
    // Write workspace state so the gateway knows seeding was done.
    const wsStateDir = join(workspaceDir, ".hermes");
    const statePath = join(wsStateDir, "workspace-state.json");
    if (!existsSync(statePath)) {
      try {
        mkdirSync(wsStateDir, { recursive: true });
        const state = {
          version: 1,
          bootstrapSeededAt: new Date().toISOString(),
          duckdbSeededAt: existsSync(join(workspaceDir, "workspace.duckdb"))
            ? new Date().toISOString()
            : undefined,
        };
        writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", "utf-8");
      } catch {
        // Best-effort state tracking
      }
    }
  }

  // Register a per-workspace agent in hermes.json and make it the default.
  ensureAgentInConfig(workspaceName, workspaceDir);

  // Switch the UI to the new workspace.
  setUIActiveWorkspace(workspaceName);
  const activeWorkspace = getActiveWorkspaceName();

  trackServer("workspace_created", { has_seed: seedBootstrap });

  return Response.json({
    workspace: workspaceName,
    activeWorkspace,
    workspaceDir,
    stateDir,
    copiedFiles,
    seededFiles: seeded,
    crmSynced: !!projectRoot,
    workspaceRoot: resolveWorkspaceRoot(),
    // Backward-compat response fields while callers migrate.
    profile: workspaceName,
    activeProfile: activeWorkspace,
  });
}
