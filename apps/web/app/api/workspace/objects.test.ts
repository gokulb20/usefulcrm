import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock node:child_process
vi.mock("node:child_process", () => ({
  execSync: vi.fn(() => ""),
}));

// Mock workspace
vi.mock("@/lib/workspace", () => ({
  duckdbPath: vi.fn(() => null),
  duckdbPathAsync: vi.fn(async () => null),
  duckdbQueryOnFile: vi.fn(() => []),
  duckdbQueryOnFileAsync: vi.fn(async () => []),
  duckdbExecOnFile: vi.fn(() => true),
  duckdbExecOnFileAsync: vi.fn(async () => true),
  findDuckDBForObject: vi.fn(() => null),
  findDuckDBForObjectAsync: vi.fn(async () => null),
  getObjectViews: vi.fn(() => ({ views: [], activeView: null })),
  parseRelationValue: vi.fn((v: string | null) => (v ? [v] : [])),
  resolveDuckdbBin: vi.fn(() => null),
  discoverDuckDBPaths: vi.fn(() => []),
  discoverDuckDBPathsAsync: vi.fn(async () => []),
}));

describe("Workspace Objects API", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mock("node:child_process", () => ({
      execSync: vi.fn(() => ""),
    }));
    vi.mock("@/lib/workspace", () => ({
      duckdbPath: vi.fn(() => null),
      duckdbPathAsync: vi.fn(async () => null),
      duckdbQueryOnFile: vi.fn(() => []),
      duckdbQueryOnFileAsync: vi.fn(async () => []),
      duckdbExecOnFile: vi.fn(() => true),
      duckdbExecOnFileAsync: vi.fn(async () => true),
      findDuckDBForObject: vi.fn(() => null),
      findDuckDBForObjectAsync: vi.fn(async () => null),
      getObjectViews: vi.fn(() => ({ views: [], activeView: null })),
      parseRelationValue: vi.fn((v: string | null) => (v ? [v] : [])),
      resolveDuckdbBin: vi.fn(() => null),
      discoverDuckDBPaths: vi.fn(() => []),
      discoverDuckDBPathsAsync: vi.fn(async () => []),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── GET /api/workspace/objects/[name] ──────────────────────────

  describe("GET /api/workspace/objects/[name]", () => {
    it("returns 503 when DuckDB CLI not installed", async () => {
      const { resolveDuckdbBin } = await import("@/lib/workspace");
      vi.mocked(resolveDuckdbBin).mockReturnValue(null);

      const { GET } = await import("./objects/[name]/route.js");
      const res = await GET(
        new Request("http://localhost/api/workspace/objects/bad-name!"),
        { params: Promise.resolve({ name: "bad-name!" }) },
      );
      expect(res.status).toBe(503);
    });

    it("returns 400 for invalid object name (when duckdb available)", async () => {
      const { resolveDuckdbBin } = await import("@/lib/workspace");
      vi.mocked(resolveDuckdbBin).mockReturnValue("/opt/homebrew/bin/duckdb");

      const { GET } = await import("./objects/[name]/route.js");
      const res = await GET(
        new Request("http://localhost/api/workspace/objects/bad!name"),
        { params: Promise.resolve({ name: "bad!name" }) },
      );
      expect(res.status).toBe(400);
    });

    it("returns 404 when object not found", async () => {
      const { findDuckDBForObjectAsync, resolveDuckdbBin, duckdbPathAsync: mockDuckdbPath } = await import("@/lib/workspace");
      vi.mocked(resolveDuckdbBin).mockReturnValue("/opt/homebrew/bin/duckdb");
      vi.mocked(findDuckDBForObjectAsync).mockResolvedValue(null);
      vi.mocked(mockDuckdbPath).mockResolvedValue(null);

      const { GET } = await import("./objects/[name]/route.js");
      const res = await GET(
        new Request("http://localhost/api/workspace/objects/nonexistent"),
        { params: Promise.resolve({ name: "nonexistent" }) },
      );
      expect(res.status).toBe(404);
    });

    it("returns object schema and entries when found", async () => {
      const { findDuckDBForObjectAsync, duckdbQueryOnFileAsync, resolveDuckdbBin, discoverDuckDBPathsAsync } = await import("@/lib/workspace");
      vi.mocked(findDuckDBForObjectAsync).mockResolvedValue("/ws/workspace.duckdb");
      vi.mocked(resolveDuckdbBin).mockReturnValue("/opt/homebrew/bin/duckdb");
      vi.mocked(discoverDuckDBPathsAsync).mockResolvedValue(["/ws/workspace.duckdb"]);

      // Mock different queries with a call counter
      let queryCall = 0;
      vi.mocked(duckdbQueryOnFileAsync).mockImplementation(async () => {
        queryCall++;
        if (queryCall === 1) {
          // Object row
          return [{ id: "obj1", name: "leads", description: "Leads object", icon: "star" }];
        }
        if (queryCall === 2) {
          // Fields
          return [
            { id: "f1", name: "name", type: "text", sort_order: 0 },
            { id: "f2", name: "status", type: "enum", sort_order: 1, enum_values: '["New","Active"]' },
          ];
        }
        if (queryCall === 3) {
          // Statuses
          return [];
        }
        // Entries and subsequent queries
        return [];
      });

      const { GET } = await import("./objects/[name]/route.js");
      const res = await GET(
        new Request("http://localhost/api/workspace/objects/leads"),
        { params: Promise.resolve({ name: "leads" }) },
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.object).toBeDefined();
      expect(json.fields).toBeDefined();
    });

    it("loads same-db schema queries sequentially (prevents oscillating empty fields during live refresh)", async () => {
      const {
        findDuckDBForObjectAsync,
        duckdbQueryOnFileAsync,
        resolveDuckdbBin,
        discoverDuckDBPathsAsync,
      } = await import("@/lib/workspace");
      vi.mocked(findDuckDBForObjectAsync).mockResolvedValue("/ws/workspace.duckdb");
      vi.mocked(resolveDuckdbBin).mockReturnValue("/opt/homebrew/bin/duckdb");
      vi.mocked(discoverDuckDBPathsAsync).mockResolvedValue(["/ws/workspace.duckdb"]);

      let inFlight = 0;
      vi.mocked(duckdbQueryOnFileAsync).mockImplementation(async (_dbFile, sql) => {
        inFlight += 1;
        const concurrent = inFlight > 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;

        if (sql.includes("SELECT * FROM objects WHERE name")) {
          return [{ id: "obj1", name: "company", description: "Company object" }] as never;
        }
        if (sql.includes("SELECT * FROM fields")) {
          return concurrent
            ? ([] as never)
            : ([{ id: "f1", name: "Company Name", type: "text", sort_order: 0 }] as never);
        }
        if (sql.includes("SELECT * FROM statuses")) {
          return concurrent
            ? ([] as never)
            : ([{ id: "status1", name: "Active", sort_order: 0 }] as never);
        }
        return [] as never;
      });

      const { GET } = await import("./objects/[name]/route.js");
      const res = await GET(
        new Request("http://localhost/api/workspace/objects/company"),
        { params: Promise.resolve({ name: "company" }) },
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.fields).toHaveLength(1);
      expect(json.statuses).toHaveLength(1);
    });

    it("returns saved views and active view from object yaml metadata", async () => {
      const {
        findDuckDBForObjectAsync,
        duckdbQueryOnFileAsync,
        resolveDuckdbBin,
        discoverDuckDBPathsAsync,
        getObjectViews,
      } = await import("@/lib/workspace");

      vi.mocked(findDuckDBForObjectAsync).mockResolvedValue("/ws/workspace.duckdb");
      vi.mocked(resolveDuckdbBin).mockReturnValue("/opt/homebrew/bin/duckdb");
      vi.mocked(discoverDuckDBPathsAsync).mockResolvedValue(["/ws/workspace.duckdb"]);
      vi.mocked(getObjectViews).mockReturnValue({
        views: [
          {
            name: "Important",
            filters: {
              id: "root",
              conjunction: "and",
              rules: [
                { id: "rule-1", field: "Status", operator: "is", value: "Important" },
              ],
            },
            columns: ["Name", "Status"],
          },
        ],
        activeView: "Important",
        viewSettings: undefined,
      });

      let queryCall = 0;
      vi.mocked(duckdbQueryOnFileAsync).mockImplementation(async () => {
        queryCall += 1;
        if (queryCall === 1) {
          return [{ id: "obj1", name: "leads", description: "Leads object", icon: "star" }];
        }
        if (queryCall === 2) {
          return [{ id: "f1", name: "name", type: "text", sort_order: 0 }];
        }
        if (queryCall === 3) {
          return [];
        }
        return [];
      });

      const { GET } = await import("./objects/[name]/route.js");
      const res = await GET(
        new Request("http://localhost/api/workspace/objects/leads"),
        { params: Promise.resolve({ name: "leads" }) },
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.savedViews).toHaveLength(1);
      expect(json.savedViews[0].name).toBe("Important");
      expect(json.activeView).toBe("Important");
    });

    it("accepts underscored names", async () => {
      const { findDuckDBForObjectAsync } = await import("@/lib/workspace");
      vi.mocked(findDuckDBForObjectAsync).mockResolvedValue(null);

      const { GET } = await import("./objects/[name]/route.js");
      const res = await GET(
        new Request("http://localhost/api/workspace/objects/my_object"),
        { params: Promise.resolve({ name: "my_object" }) },
      );
      // 404 because findDuckDBForObject returns null, but name validation passes
      expect(res.status).toBe(404);
    });
  });

  // ─── POST /api/workspace/objects/[name]/entries ─────────────────

  describe("POST /api/workspace/objects/[name]/entries", () => {
    it("returns 400 for invalid object name", async () => {
      const { POST } = await import("./objects/[name]/entries/route.js");
      const req = new Request("http://localhost/api/workspace/objects/bad!/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const res = await POST(req, { params: Promise.resolve({ name: "bad!" }) });
      expect(res.status).toBe(400);
    });

    it("returns 404 when DuckDB not found", async () => {
      const { findDuckDBForObject } = await import("@/lib/workspace");
      vi.mocked(findDuckDBForObject).mockReturnValue(null);

      const { POST } = await import("./objects/[name]/entries/route.js");
      const req = new Request("http://localhost/api/workspace/objects/leads/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const res = await POST(req, { params: Promise.resolve({ name: "leads" }) });
      expect(res.status).toBe(404);
    });

    it("creates entry successfully", async () => {
      const { findDuckDBForObject, duckdbQueryOnFile, duckdbExecOnFile } = await import("@/lib/workspace");
      vi.mocked(findDuckDBForObject).mockReturnValue("/ws/workspace.duckdb");

      let queryCall = 0;
      vi.mocked(duckdbQueryOnFile).mockImplementation(() => {
        queryCall++;
        if (queryCall === 1) {return [{ id: "obj1" }];} // object lookup
        if (queryCall === 2) {return [{ id: "new-entry-uuid" }];} // uuid generation
        return [];
      });
      vi.mocked(duckdbExecOnFile).mockReturnValue(true);

      const { POST } = await import("./objects/[name]/entries/route.js");
      const req = new Request("http://localhost/api/workspace/objects/leads/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { name: "Acme Corp" } }),
      });
      const res = await POST(req, { params: Promise.resolve({ name: "leads" }) });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.entryId).toBeDefined();
    });

    it("returns 404 when object not found in DB", async () => {
      const { findDuckDBForObject, duckdbQueryOnFile } = await import("@/lib/workspace");
      vi.mocked(findDuckDBForObject).mockReturnValue("/ws/workspace.duckdb");
      vi.mocked(duckdbQueryOnFile).mockReturnValue([]); // object not found

      const { POST } = await import("./objects/[name]/entries/route.js");
      const req = new Request("http://localhost/api/workspace/objects/missing/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const res = await POST(req, { params: Promise.resolve({ name: "missing" }) });
      expect(res.status).toBe(404);
    });
  });

  // ─── GET /api/workspace/objects/[name]/entries/[id] ─────────────

  describe("GET /api/workspace/objects/[name]/entries/[id]", () => {
    it("returns 400 for invalid object name", async () => {
      const { GET } = await import("./objects/[name]/entries/[id]/route.js");
      const res = await GET(
        new Request("http://localhost"),
        { params: Promise.resolve({ name: "bad!", id: "123" }) },
      );
      expect(res.status).toBe(400);
    });

    it("returns 404 when DuckDB not found", async () => {
      const { findDuckDBForObject } = await import("@/lib/workspace");
      vi.mocked(findDuckDBForObject).mockReturnValue(null);

      const { GET } = await import("./objects/[name]/entries/[id]/route.js");
      const res = await GET(
        new Request("http://localhost"),
        { params: Promise.resolve({ name: "leads", id: "123" }) },
      );
      expect(res.status).toBe(404);
    });

    it("returns entry details when found", async () => {
      const { findDuckDBForObject, duckdbQueryOnFile } = await import("@/lib/workspace");
      vi.mocked(findDuckDBForObject).mockReturnValue("/ws/workspace.duckdb");

      let queryCall = 0;
      vi.mocked(duckdbQueryOnFile).mockImplementation(() => {
        queryCall++;
        if (queryCall === 1) {return [{ id: "obj1" }];} // object
        if (queryCall === 2) {return [{ id: "f1", name: "name", type: "text" }];} // fields
        if (queryCall === 3) {return [{ entry_id: "e1", field_name: "name", value: "Acme", created_at: "2025-01-01", updated_at: "2025-01-01" }];} // EAV
        return [];
      });

      const { GET } = await import("./objects/[name]/entries/[id]/route.js");
      const res = await GET(
        new Request("http://localhost"),
        { params: Promise.resolve({ name: "leads", id: "e1" }) },
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.entry).toBeDefined();
    });
  });

  // ─── PATCH /api/workspace/objects/[name]/entries/[id] ───────────

  describe("PATCH /api/workspace/objects/[name]/entries/[id]", () => {
    it("returns 400 for invalid object name", async () => {
      const { PATCH } = await import("./objects/[name]/entries/[id]/route.js");
      const req = new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: {} }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ name: "bad!", id: "123" }) });
      expect(res.status).toBe(400);
    });

    it("returns 404 when DuckDB not found", async () => {
      const { findDuckDBForObject } = await import("@/lib/workspace");
      vi.mocked(findDuckDBForObject).mockReturnValue(null);

      const { PATCH } = await import("./objects/[name]/entries/[id]/route.js");
      const req = new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { name: "Updated" } }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ name: "leads", id: "e1" }) });
      expect(res.status).toBe(404);
    });

    it("updates entry fields", async () => {
      const { findDuckDBForObject, duckdbQueryOnFile, duckdbExecOnFile } = await import("@/lib/workspace");
      vi.mocked(findDuckDBForObject).mockReturnValue("/ws/workspace.duckdb");

      let queryCall = 0;
      vi.mocked(duckdbQueryOnFile).mockImplementation(() => {
        queryCall++;
        if (queryCall === 1) {return [{ id: "obj1" }];} // object
        if (queryCall === 2) {return [{ id: "f1", name: "name", type: "text" }];} // fields
        return [];
      });
      vi.mocked(duckdbExecOnFile).mockReturnValue(true);

      const { PATCH } = await import("./objects/[name]/entries/[id]/route.js");
      const req = new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { name: "Updated Corp" } }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ name: "leads", id: "e1" }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });
  });

  // ─── DELETE /api/workspace/objects/[name]/entries/[id] ──────────

  describe("DELETE /api/workspace/objects/[name]/entries/[id]", () => {
    it("returns 400 for invalid object name", async () => {
      const { DELETE } = await import("./objects/[name]/entries/[id]/route.js");
      const res = await DELETE(
        new Request("http://localhost", { method: "DELETE" }),
        { params: Promise.resolve({ name: "bad!", id: "123" }) },
      );
      expect(res.status).toBe(400);
    });

    it("returns 404 when DuckDB not found", async () => {
      const { findDuckDBForObject } = await import("@/lib/workspace");
      vi.mocked(findDuckDBForObject).mockReturnValue(null);

      const { DELETE } = await import("./objects/[name]/entries/[id]/route.js");
      const res = await DELETE(
        new Request("http://localhost", { method: "DELETE" }),
        { params: Promise.resolve({ name: "leads", id: "e1" }) },
      );
      expect(res.status).toBe(404);
    });

    it("deletes entry successfully", async () => {
      const { findDuckDBForObject, duckdbQueryOnFile, duckdbExecOnFile } = await import("@/lib/workspace");
      vi.mocked(findDuckDBForObject).mockReturnValue("/ws/workspace.duckdb");
      vi.mocked(duckdbQueryOnFile).mockReturnValue([{ id: "obj1" }]);
      vi.mocked(duckdbExecOnFile).mockReturnValue(true);

      const { DELETE } = await import("./objects/[name]/entries/[id]/route.js");
      const res = await DELETE(
        new Request("http://localhost", { method: "DELETE" }),
        { params: Promise.resolve({ name: "leads", id: "e1" }) },
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });
  });

  // ─── POST /api/workspace/objects/[name]/entries/bulk-delete ─────

  describe("POST /api/workspace/objects/[name]/entries/bulk-delete", () => {
    it("returns 400 for invalid object name", async () => {
      const { POST } = await import("./objects/[name]/entries/bulk-delete/route.js");
      const req = new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: ["e1"] }),
      });
      const res = await POST(req, { params: Promise.resolve({ name: "bad!" }) });
      expect(res.status).toBe(400);
    });

    it("returns 400 for empty entryIds", async () => {
      const { findDuckDBForObject } = await import("@/lib/workspace");
      vi.mocked(findDuckDBForObject).mockReturnValue("/ws/workspace.duckdb");

      const { POST } = await import("./objects/[name]/entries/bulk-delete/route.js");
      const req = new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryIds: [] }),
      });
      const res = await POST(req, { params: Promise.resolve({ name: "leads" }) });
      expect(res.status).toBe(400);
    });

    it("deletes multiple entries", async () => {
      const { findDuckDBForObject, duckdbQueryOnFile, duckdbExecOnFile } = await import("@/lib/workspace");
      vi.mocked(findDuckDBForObject).mockReturnValue("/ws/workspace.duckdb");
      vi.mocked(duckdbQueryOnFile).mockReturnValue([{ id: "obj1" }]);
      vi.mocked(duckdbExecOnFile).mockReturnValue(true);

      const { POST } = await import("./objects/[name]/entries/bulk-delete/route.js");
      const req = new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryIds: ["e1", "e2", "e3"] }),
      });
      const res = await POST(req, { params: Promise.resolve({ name: "leads" }) });
      expect(res.status).toBe(200);
    });
  });
});
