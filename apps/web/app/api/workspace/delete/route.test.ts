import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => ({
  rmSync: vi.fn(),
}));

vi.mock("@/lib/workspace", () => ({
  discoverWorkspaces: vi.fn(() => []),
  getActiveWorkspaceName: vi.fn(() => null),
  resolveWorkspaceRoot: vi.fn(() => null),
  setUIActiveWorkspace: vi.fn(),
}));

describe("POST /api/workspace/delete", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  async function callDelete(body: Record<string, unknown>) {
    const { POST } = await import("./route.js");
    const req = new Request("http://localhost/api/workspace/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return POST(req);
  }

  it("returns 400 for invalid workspace names (prevents traversal)", async () => {
    const res1 = await callDelete({ workspace: "../bad" });
    expect(res1.status).toBe(400);

    const res2 = await callDelete({ profile: "../../etc" });
    expect(res2.status).toBe(400);

    const res3 = await callDelete({});
    expect(res3.status).toBe(400);
  });

  it("returns 404 when workspace does not exist", async () => {
    const workspace = await import("@/lib/workspace");
    vi.mocked(workspace.discoverWorkspaces).mockReturnValue([]);

    const response = await callDelete({ workspace: "work" });
    expect(response.status).toBe(404);
  });

  it("returns 409 when workspace has no directory to delete", async () => {
    const workspace = await import("@/lib/workspace");
    vi.mocked(workspace.discoverWorkspaces).mockReturnValue([
      {
        name: "work",
        stateDir: "/home/testuser/.hermes-useful",
        workspaceDir: null,
        isActive: false,
        hasConfig: true,
      },
    ]);

    const response = await callDelete({ workspace: "work" });
    expect(response.status).toBe(409);
  });

  it("deletes workspace directory directly via rmSync", async () => {
    const workspace = await import("@/lib/workspace");
    const { rmSync } = await import("node:fs");
    const workspaceDir = "/home/testuser/.hermes-useful/workspace-work";

    vi.mocked(workspace.discoverWorkspaces)
      .mockReturnValueOnce([
        {
          name: "work",
          stateDir: "/home/testuser/.hermes-useful",
          workspaceDir,
          isActive: true,
          hasConfig: true,
        },
      ])
      .mockReturnValueOnce([]);
    vi.mocked(workspace.getActiveWorkspaceName)
      .mockReturnValueOnce("work")
      .mockReturnValueOnce(null);
    vi.mocked(workspace.resolveWorkspaceRoot).mockReturnValue(null);

    const response = await callDelete({ workspace: "work" });
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.deleted).toBe(true);
    expect(json.workspace).toBe("work");
    expect(json.profile).toBe("work");

    expect(rmSync).toHaveBeenCalledWith(workspaceDir, { recursive: true, force: false });
    expect(workspace.setUIActiveWorkspace).toHaveBeenCalledWith(null);
  });

  it("returns 500 when rmSync fails", async () => {
    const workspace = await import("@/lib/workspace");
    const { rmSync } = await import("node:fs");
    const workspaceDir = "/home/testuser/.hermes-useful/workspace-work";

    vi.mocked(workspace.discoverWorkspaces).mockReturnValue([
      {
        name: "work",
        stateDir: "/home/testuser/.hermes-useful",
        workspaceDir,
        isActive: false,
        hasConfig: true,
      },
    ]);
    vi.mocked(rmSync).mockImplementation(() => {
      throw new Error("EPERM: operation not permitted");
    });

    const response = await callDelete({ workspace: "work" });
    expect(response.status).toBe(500);
    const json = await response.json();
    expect(String(json.error)).toContain("EPERM");
  });
});
