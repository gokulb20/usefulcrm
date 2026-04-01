import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const STATE_DIR = "/home/testuser/.hermes-useful";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ""),
  readdirSync: vi.fn(() => []),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  copyFileSync: vi.fn(),
  cpSync: vi.fn(),
}));

vi.mock("@/lib/workspace", () => ({
  discoverWorkspaces: vi.fn(() => []),
  setUIActiveWorkspace: vi.fn(),
  getActiveWorkspaceName: vi.fn(() => "work"),
  resolveHermesStateDir: vi.fn(() => "/home/testuser/.hermes-useful"),
  resolveWorkspaceDirForName: vi.fn((name: string) =>
    join("/home/testuser/.hermes-useful", `workspace-${name}`),
  ),
  isValidWorkspaceName: vi.fn(() => true),
  resolveWorkspaceRoot: vi.fn(() => null),
  ensureAgentInConfig: vi.fn(),
}));

describe("POST /api/workspace/init", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    delete process.env.OPENCLAW_HOME;
    delete process.env.OPENCLAW_WORKSPACE;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  async function callInit(body: Record<string, unknown>) {
    const { POST } = await import("./route.js");
    const req = new Request("http://localhost/api/workspace/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return POST(req);
  }

  it("rejects missing workspace name (400)", async () => {
    const response = await callInit({});
    expect(response.status).toBe(400);
  });

  it("rejects custom path parameter (prevents custom workspace locations)", async () => {
    const response = await callInit({ workspace: "work", path: "/tmp/custom" });
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(String(json.error)).toContain("Custom workspace paths");
  });

  it("rejects invalid workspace names (400)", async () => {
    const response = await callInit({ workspace: "../bad" });
    expect(response.status).toBe(400);
  });

  it("rejects reserved workspace names like main", async () => {
    const workspace = await import("@/lib/workspace");
    vi.mocked(workspace.isValidWorkspaceName).mockImplementation(
      (name: string) => name !== "main",
    );

    const response = await callInit({ workspace: "main" });
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(String(json.error)).toContain("reserved");
  });

  it("returns 409 when workspace already exists", async () => {
    const workspace = await import("@/lib/workspace");
    vi.mocked(workspace.discoverWorkspaces).mockReturnValue([
      {
        name: "work",
        stateDir: STATE_DIR,
        workspaceDir: join(STATE_DIR, "workspace-work"),
        isActive: true,
        hasConfig: true,
      },
    ]);

    const response = await callInit({ workspace: "work" });
    expect(response.status).toBe(409);
  });

  it("creates workspace directory at ~/.hermes-useful/workspace-<name> (enforces fixed layout)", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const workspace = await import("@/lib/workspace");
    vi.mocked(workspace.discoverWorkspaces).mockReturnValue([]);

    const response = await callInit({ workspace: "work" });
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.workspace).toBe("work");
    expect(json.workspaceDir).toBe(join(STATE_DIR, "workspace-work"));
    expect(json.activeWorkspace).toBe("work");
    expect(json.profile).toBe("work");

    expect(mkdirSync).toHaveBeenCalledWith(STATE_DIR, { recursive: true });
    expect(mkdirSync).toHaveBeenCalledWith(join(STATE_DIR, "workspace-work"), { recursive: false });
    expect(workspace.setUIActiveWorkspace).toHaveBeenCalledWith("work");
    expect(writeFileSync).toHaveBeenCalled();
  });

  it("seeds CRM skill into workspace/skills/crm/SKILL.md (not state dir)", async () => {
    const { existsSync, cpSync, mkdirSync } = await import("node:fs");
    const workspace = await import("@/lib/workspace");
    vi.mocked(workspace.discoverWorkspaces).mockReturnValue([]);

    const workspaceDir = join(STATE_DIR, "workspace-work");
    vi.mocked(existsSync).mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith("package.json")) {return true;}
      if (s.endsWith("assets/seed/workspace.duckdb")) {return true;}
      if (s.endsWith("skills/crm/SKILL.md")) {return true;}
      return false;
    });

    const response = await callInit({ workspace: "work" });
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.crmSynced).toBe(true);

    const cpSyncCalls = vi.mocked(cpSync).mock.calls;
    const crmCopy = cpSyncCalls.find(
      (call) => String(call[1]).includes(join(workspaceDir, "skills", "crm")),
    );
    expect(crmCopy).toBeTruthy();

    const mkdirCalls = vi.mocked(mkdirSync).mock.calls;
    const skillsMkdir = mkdirCalls.find(
      (call) => String(call[0]).includes(join(workspaceDir, "skills")),
    );
    expect(skillsMkdir).toBeTruthy();
  });

  it("seeds IDENTITY.md as bootstrap placeholder (full identity is injected at runtime by useful-identity plugin)", async () => {
    const { existsSync, writeFileSync } = await import("node:fs");
    const workspace = await import("@/lib/workspace");
    vi.mocked(workspace.discoverWorkspaces).mockReturnValue([]);

    vi.mocked(existsSync).mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith("package.json")) {return true;}
      if (s.endsWith("assets/seed/workspace.duckdb")) {return true;}
      return false;
    });

    const response = await callInit({ workspace: "work" });
    expect(response.status).toBe(200);

    const workspaceDir = join(STATE_DIR, "workspace-work");
    const identityWrites = vi.mocked(writeFileSync).mock.calls.filter(
      (call) => String(call[0]).endsWith("IDENTITY.md"),
    );
    expect(identityWrites.length).toBeGreaterThan(0);
    expect(String(identityWrites[0][0])).toBe(join(workspaceDir, "IDENTITY.md"));
  });
});
