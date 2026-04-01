import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/workspace", () => ({
  discoverWorkspaces: vi.fn(() => []),
  getActiveWorkspaceName: vi.fn(() => null),
  resolveHermesStateDir: vi.fn(() => "/home/testuser/.hermes-useful"),
  resolveWorkspaceDirForName: vi.fn((name: string) =>
    name === "default"
      ? "/home/testuser/.hermes-useful/workspace"
      : `/home/testuser/.hermes-useful/workspace-${name}`,
  ),
  resolveWorkspaceRoot: vi.fn(() => null),
  setUIActiveWorkspace: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ""),
  readdirSync: vi.fn(() => []),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

describe("profiles API", () => {
  const originalEnv = { ...process.env };
  const STATE_DIR = "/home/testuser/.hermes-useful";

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

  it("lists discovered workspaces with gateway metadata", async () => {
    const workspace = await import("@/lib/workspace");
    const { existsSync, readFileSync } = await import("node:fs");
    const mockExists = vi.mocked(existsSync);
    const mockReadFile = vi.mocked(readFileSync);

    vi.mocked(workspace.discoverWorkspaces).mockReturnValue([
      {
        name: "main",
        stateDir: STATE_DIR,
        workspaceDir: `${STATE_DIR}/workspace-main`,
        isActive: false,
        hasConfig: true,
      },
      {
        name: "work",
        stateDir: STATE_DIR,
        workspaceDir: `${STATE_DIR}/workspace-work`,
        isActive: true,
        hasConfig: true,
      },
    ]);
    vi.mocked(workspace.getActiveWorkspaceName).mockReturnValue("work");

    mockExists.mockImplementation((p) => {
      const s = String(p);
      return s.endsWith("hermes.json");
    });
    mockReadFile.mockImplementation((p) => {
      const s = String(p);
      if (s.includes("hermes.json")) {
        return JSON.stringify({ gateway: { mode: "local", port: 19001 } }) as never;
      }
      return "" as never;
    });

    const { GET } = await import("./route.js");
    const response = await GET();
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.activeWorkspace).toBe("work");
    expect(json.activeProfile).toBe("work");
    expect(json.workspaces).toHaveLength(2);
    expect(json.profiles).toHaveLength(2);

    const work = json.workspaces.find((w: { name: string }) => w.name === "work");
    expect(work).toMatchObject({
      name: "work",
      stateDir: STATE_DIR,
      isActive: true,
      gateway: { mode: "local", port: 19001, url: "ws://127.0.0.1:19001" },
    });
  });

  it("includes bootstrap-root workspace as default", async () => {
    const workspace = await import("@/lib/workspace");
    const { existsSync, readFileSync } = await import("node:fs");
    const mockExists = vi.mocked(existsSync);
    const mockReadFile = vi.mocked(readFileSync);

    vi.mocked(workspace.discoverWorkspaces).mockReturnValue([
      {
        name: "default",
        stateDir: STATE_DIR,
        workspaceDir: `${STATE_DIR}/workspace`,
        isActive: true,
        hasConfig: true,
      },
    ]);
    vi.mocked(workspace.getActiveWorkspaceName).mockReturnValue("default");

    mockExists.mockImplementation((p) => String(p).endsWith("hermes.json"));
    mockReadFile.mockImplementation((p) => {
      if (String(p).includes("hermes.json")) {
        return JSON.stringify({ gateway: { mode: "local", port: 19001 } }) as never;
      }
      return "" as never;
    });

    const { GET } = await import("./route.js");
    const response = await GET();
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.activeWorkspace).toBe("default");
    expect(json.activeProfile).toBe("default");
    expect(json.workspaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "default",
          workspaceDir: `${STATE_DIR}/workspace`,
          gateway: { mode: "local", port: 19001, url: "ws://127.0.0.1:19001" },
        }),
      ]),
    );
  });

  it("switches to an existing workspace", async () => {
    const workspace = await import("@/lib/workspace");
    vi.mocked(workspace.discoverWorkspaces)
      .mockReturnValueOnce([
        {
          name: "work",
          stateDir: STATE_DIR,
          workspaceDir: `${STATE_DIR}/workspace-work`,
          isActive: false,
          hasConfig: true,
        },
      ])
      .mockReturnValueOnce([
        {
          name: "work",
          stateDir: STATE_DIR,
          workspaceDir: `${STATE_DIR}/workspace-work`,
          isActive: true,
          hasConfig: true,
        },
      ]);
    vi.mocked(workspace.getActiveWorkspaceName).mockReturnValue("work");
    vi.mocked(workspace.resolveHermesStateDir).mockReturnValue(STATE_DIR);
    vi.mocked(workspace.resolveWorkspaceRoot).mockReturnValue(`${STATE_DIR}/workspace-work`);

    const { POST } = await import("./switch/route.js");
    const req = new Request("http://localhost/api/profiles/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace: "work" }),
    });

    const response = await POST(req);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.activeWorkspace).toBe("work");
    expect(json.activeProfile).toBe("work");
    expect(json.stateDir).toBe(STATE_DIR);
    expect(json.workspaceRoot).toBe(`${STATE_DIR}/workspace-work`);
    expect(json.workspace.name).toBe("work");
    expect(workspace.setUIActiveWorkspace).toHaveBeenCalledWith("work");
  });

  it("rejects invalid names", async () => {
    const { POST } = await import("./switch/route.js");
    const req = new Request("http://localhost/api/profiles/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace: "../bad" }),
    });
    const response = await POST(req);
    expect(response.status).toBe(400);
  });

  it("returns 404 for unknown workspace", async () => {
    const workspace = await import("@/lib/workspace");
    vi.mocked(workspace.discoverWorkspaces).mockReturnValue([]);

    const { POST } = await import("./switch/route.js");
    const req = new Request("http://localhost/api/profiles/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace: "nonexistent" }),
    });
    const response = await POST(req);
    expect(response.status).toBe(404);
  });
});
