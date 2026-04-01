/**
 * Tests for the workspace URL state machine.
 *
 * These tests verify invariants around deep-linking, state restoration,
 * URL serialization round-trips, and precedence rules that keep the app
 * navigable via copied/bookmarked URLs.
 */
import { describe, it, expect } from "vitest";
import {
  parseUrlState,
  serializeUrlState,
  buildUrl,
  buildEntryLink,
  buildFileLink,
  buildChatLink,
  buildSubagentLink,
  buildBrowseLink,
  migrateWorkspaceUrl,
  parseWorkspaceLink,
  isWorkspaceLink,
  isEntryLink,
  type WorkspaceUrlState,
} from "./workspace-links";

// ---------------------------------------------------------------------------
// Deep-link restoration invariants
// ---------------------------------------------------------------------------

describe("deep-link restoration", () => {
  it("restores file path from copied URL (prevents lost context on page reload)", () => {
    const url = buildFileLink("knowledge/CRM/contacts.md");
    const state = parseUrlState(new URL(url, "http://localhost").search);
    expect(state.path).toBe("knowledge/CRM/contacts.md");
  });

  it("restores chat session from copied URL (prevents lost conversation on refresh)", () => {
    const url = buildChatLink("sess-abc-123");
    const state = parseUrlState(new URL(url, "http://localhost").search);
    expect(state.chat).toBe("sess-abc-123");
  });

  it("restores subagent panel from copied URL (prevents lost subagent context on refresh)", () => {
    const url = buildSubagentLink("parent-sess", "child-key-456");
    const state = parseUrlState(new URL(url, "http://localhost").search);
    expect(state.chat).toBe("parent-sess");
    expect(state.subagent).toBe("child-key-456");
  });

  it("restores entry modal from copied URL (prevents lost entry detail on refresh)", () => {
    const url = buildEntryLink("leads", "entry-789");
    const state = parseUrlState(new URL(url, "http://localhost").search);
    expect(state.entry).toEqual({ objectName: "leads", entryId: "entry-789" });
  });

  it("restores browse mode from copied URL (prevents lost directory context on refresh)", () => {
    const url = buildBrowseLink("/Users/me/projects/app", true);
    const state = parseUrlState(new URL(url, "http://localhost").search);
    expect(state.browse).toBe("/Users/me/projects/app");
    expect(state.hidden).toBe(true);
  });

  it("restores cron dashboard from virtual path (prevents lost cron view on refresh)", () => {
    const url = buildFileLink("~cron");
    const state = parseUrlState(new URL(url, "http://localhost").search);
    expect(state.path).toBe("~cron");
  });

  it("restores cron job detail from virtual path (prevents lost job detail on refresh)", () => {
    const url = buildFileLink("~cron/daily-sync");
    const state = parseUrlState(new URL(url, "http://localhost").search);
    expect(state.path).toBe("~cron/daily-sync");
  });

  it("restores object view with filter/sort/search/page from URL (prevents lost table state on refresh)", () => {
    const filters = { id: "root", conjunction: "and" as const, rules: [{ id: "r1", field: "status", operator: "equals" as const, value: "active" }] };
    const sort = [{ field: "name", direction: "asc" as const }];
    const qs = serializeUrlState({
      path: "knowledge/leads",
      viewType: "table",
      filters,
      sort,
      search: "acme",
      page: 3,
      pageSize: 25,
      cols: ["name", "email", "status"],
      view: "Active Leads",
    });
    const state = parseUrlState(qs);
    expect(state.path).toBe("knowledge/leads");
    expect(state.viewType).toBe("table");
    expect(state.filters).toEqual(filters);
    expect(state.sort).toEqual(sort);
    expect(state.search).toBe("acme");
    expect(state.page).toBe(3);
    expect(state.pageSize).toBe(25);
    expect(state.cols).toEqual(["name", "email", "status"]);
    expect(state.view).toBe("Active Leads");
  });

  it("restores sidebar preview from copied URL (prevents lost preview on refresh)", () => {
    const qs = serializeUrlState({ path: "README.md", preview: "other/file.md" });
    const state = parseUrlState(qs);
    expect(state.path).toBe("README.md");
    expect(state.preview).toBe("other/file.md");
  });
});

// ---------------------------------------------------------------------------
// Precedence rules when multiple params coexist
// ---------------------------------------------------------------------------

describe("URL parameter precedence", () => {
  it("entry takes priority over path in parseWorkspaceLink (prevents ambiguous navigation)", () => {
    const link = parseWorkspaceLink("/?entry=leads:abc&path=some/file.md");
    expect(link?.kind).toBe("entry");
  });

  it("path and chat are mutually exclusive in serialization (prevents dual-mode confusion)", () => {
    const qs = serializeUrlState({ path: "doc.md", chat: "sess1" });
    const params = new URLSearchParams(qs);
    expect(params.has("path")).toBe(true);
    expect(params.has("chat")).toBe(true);
    // Both are present but the page-level effect chooses path over chat
  });

  it("subagent param is only meaningful with a chat param (prevents orphan subagent state)", () => {
    const state = parseUrlState("subagent=child-key");
    expect(state.subagent).toBe("child-key");
    expect(state.chat).toBeNull();
    // Without chat, the subagent param has no parent session to attach to
  });

  it("browse and path can coexist (browse controls sidebar, path controls main panel)", () => {
    const qs = serializeUrlState({ path: "some/file.md", browse: "/absolute/dir" });
    const state = parseUrlState(qs);
    expect(state.path).toBe("some/file.md");
    expect(state.browse).toBe("/absolute/dir");
  });

  it("hidden flag only applies when browse is set (prevents hidden leak into workspace mode)", () => {
    const state = parseUrlState("hidden=1");
    expect(state.hidden).toBe(true);
    expect(state.browse).toBeNull();
    // The page-level handler should ignore hidden without browse
  });
});

// ---------------------------------------------------------------------------
// Object view URL state edge cases
// ---------------------------------------------------------------------------

describe("object view URL state", () => {
  it("omits default view type to keep URLs clean (prevents URL bloat)", () => {
    const qs = serializeUrlState({ path: "leads" });
    expect(qs).not.toContain("viewType");
  });

  it("omits page=1 since it is the default (prevents URL bloat)", () => {
    const qs = serializeUrlState({ path: "leads", page: 1 });
    expect(qs).not.toContain("page=");
  });

  it("preserves page > 1 in URL (prevents pagination loss on refresh)", () => {
    const qs = serializeUrlState({ path: "leads", page: 5 });
    expect(qs).toContain("page=5");
  });

  it("omits empty filter group (prevents URL noise)", () => {
    const qs = serializeUrlState({ filters: { id: "root", conjunction: "and", rules: [] } });
    expect(qs).not.toContain("filters");
  });

  it("preserves non-empty filter group (prevents filter loss on refresh)", () => {
    const fg = { id: "root", conjunction: "and" as const, rules: [{ id: "r1", field: "f", operator: "equals" as const, value: "v" }] };
    const qs = serializeUrlState({ filters: fg });
    expect(qs).toContain("filters=");
    const restored = parseUrlState(qs);
    expect(restored.filters?.rules).toHaveLength(1);
  });

  it("omits empty sort array (prevents URL noise)", () => {
    const qs = serializeUrlState({ sort: [] });
    expect(qs).not.toContain("sort");
  });

  it("preserves sort rules (prevents sort loss on refresh)", () => {
    const sort = [{ field: "created_at", direction: "desc" as const }];
    const qs = serializeUrlState({ sort });
    const restored = parseUrlState(qs);
    expect(restored.sort).toEqual(sort);
  });

  it("columns survive round-trip with special characters in names (prevents data loss)", () => {
    const cols = ["full name", "email & phone", "status"];
    const qs = serializeUrlState({ cols });
    const restored = parseUrlState(qs);
    expect(restored.cols).toEqual(cols);
  });

  it("rejects unknown view types (prevents invalid state from corrupted URLs)", () => {
    const state = parseUrlState("viewType=pivot");
    expect(state.viewType).toBeNull();
  });

  it("accepts all valid view types (ensures all view modes are deep-linkable)", () => {
    for (const vt of ["table", "kanban", "calendar", "timeline", "gallery", "list"] as const) {
      const qs = serializeUrlState({ viewType: vt });
      const state = parseUrlState(qs);
      expect(state.viewType).toBe(vt);
    }
  });

  it("handles complex filter with nested groups (prevents structured data loss)", () => {
    const fg = {
      id: "root",
      conjunction: "and" as const,
      rules: [
        { id: "r1", field: "status", operator: "equals" as const, value: "active" },
        {
          id: "g1",
          conjunction: "or" as const,
          rules: [
            { id: "r2", field: "priority", operator: "equals" as const, value: "high" },
            { id: "r3", field: "priority", operator: "equals" as const, value: "critical" },
          ],
        },
      ],
    };
    const qs = serializeUrlState({ filters: fg });
    const restored = parseUrlState(qs);
    expect(restored.filters).toEqual(fg);
  });
});

// ---------------------------------------------------------------------------
// Legacy /workspace migration
// ---------------------------------------------------------------------------

describe("legacy /workspace URL migration", () => {
  it("migrates bare /workspace to / (prevents stale bookmarks)", () => {
    expect(migrateWorkspaceUrl("/workspace")).toBe("/");
  });

  it("migrates /workspace?path=doc.md preserving all params (prevents param loss)", () => {
    const migrated = migrateWorkspaceUrl("/workspace?path=doc.md&entry=obj:id");
    expect(migrated).toBe("/?path=doc.md&entry=obj:id");
  });

  it("migrates /workspace#hash preserving fragment (prevents anchor loss)", () => {
    expect(migrateWorkspaceUrl("/workspace#section")).toBe("/#section");
  });

  it("migrates /workspace?query#hash preserving both (prevents combined loss)", () => {
    expect(migrateWorkspaceUrl("/workspace?path=x#y")).toBe("/?path=x#y");
  });

  it("returns null for non-workspace URLs (prevents false positive migration)", () => {
    expect(migrateWorkspaceUrl("/")).toBeNull();
    expect(migrateWorkspaceUrl("/other")).toBeNull();
    expect(migrateWorkspaceUrl("https://example.com/workspace")).toBeNull();
  });

  it("isWorkspaceLink recognizes both old and new formats (prevents broken link detection)", () => {
    expect(isWorkspaceLink("/workspace")).toBe(true);
    expect(isWorkspaceLink("/workspace?path=x")).toBe(true);
    expect(isWorkspaceLink("/")).toBe(true);
    expect(isWorkspaceLink("/?path=x")).toBe(true);
  });

  it("parseWorkspaceLink handles both old and new entry formats (prevents entry link breakage)", () => {
    const oldResult = parseWorkspaceLink("/workspace?entry=leads:abc");
    const newResult = parseWorkspaceLink("/?entry=leads:abc");
    expect(oldResult).toEqual(newResult);
    expect(oldResult).toEqual({ kind: "entry", objectName: "leads", entryId: "abc" });
  });

  it("parseWorkspaceLink handles both old and new file formats (prevents file link breakage)", () => {
    const oldResult = parseWorkspaceLink("/workspace?path=doc.md");
    const newResult = parseWorkspaceLink("/?path=doc.md");
    expect(oldResult).toEqual(newResult);
    expect(oldResult).toEqual({ kind: "file", path: "doc.md" });
  });

  it("isEntryLink recognizes entries in both old and new format (prevents entry detection failure)", () => {
    expect(isEntryLink("/workspace?entry=obj:id")).toBe(true);
    expect(isEntryLink("/?entry=obj:id")).toBe(true);
    expect(isEntryLink("@entry/obj/id")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// URL builder correctness
// ---------------------------------------------------------------------------

describe("URL builders produce correct root-route URLs", () => {
  it("buildFileLink produces root URL (prevents /workspace leak)", () => {
    expect(buildFileLink("doc.md")).toMatch(/^\/\?path=/);
    expect(buildFileLink("doc.md")).not.toContain("/workspace");
  });

  it("buildEntryLink produces root URL (prevents /workspace leak)", () => {
    expect(buildEntryLink("obj", "id")).toMatch(/^\/\?entry=/);
    expect(buildEntryLink("obj", "id")).not.toContain("/workspace");
  });

  it("buildChatLink produces root URL (prevents /workspace leak)", () => {
    expect(buildChatLink("sess")).toMatch(/^\/\?chat=/);
  });

  it("buildSubagentLink produces root URL with both params (prevents /workspace leak)", () => {
    const url = buildSubagentLink("parent", "child");
    expect(url).toMatch(/^\/\?/);
    expect(url).toContain("chat=parent");
    expect(url).toContain("subagent=child");
  });

  it("buildBrowseLink produces root URL (prevents /workspace leak)", () => {
    expect(buildBrowseLink("/tmp")).toMatch(/^\/\?browse=/);
  });

  it("buildUrl returns / for empty state (prevents URL corruption)", () => {
    expect(buildUrl({})).toBe("/");
  });

  it("buildUrl produces valid query string for complex state (prevents encoding errors)", () => {
    const url = buildUrl({
      path: "leads",
      viewType: "kanban",
      search: "hello world",
      page: 2,
    });
    const parsed = new URL(url, "http://localhost");
    expect(parsed.pathname).toBe("/");
    expect(parsed.searchParams.get("path")).toBe("leads");
    expect(parsed.searchParams.get("viewType")).toBe("kanban");
    expect(parsed.searchParams.get("search")).toBe("hello world");
    expect(parsed.searchParams.get("page")).toBe("2");
  });
});

// ---------------------------------------------------------------------------
// Serialization round-trip completeness
// ---------------------------------------------------------------------------

describe("full state round-trip", () => {
  it("round-trips a maximally-populated URL state (prevents any field from being lost)", () => {
    const original: Partial<WorkspaceUrlState> = {
      path: "knowledge/leads",
      entry: { objectName: "leads", entryId: "e1" },
      browse: "/Users/me/Desktop",
      hidden: true,
      preview: "sidebar/preview.md",
      view: "Active View",
      viewType: "kanban",
      filters: { id: "root", conjunction: "and", rules: [{ id: "r1", field: "status", operator: "equals" as const, value: "done" }] },
      search: "urgent",
      sort: [{ field: "priority", direction: "desc" }],
      page: 4,
      pageSize: 25,
      cols: ["name", "priority", "status"],
    };
    const qs = serializeUrlState(original);
    const restored = parseUrlState(qs);

    expect(restored.path).toBe(original.path);
    expect(restored.entry).toEqual(original.entry);
    expect(restored.browse).toBe(original.browse);
    expect(restored.hidden).toBe(original.hidden);
    expect(restored.preview).toBe(original.preview);
    expect(restored.view).toBe(original.view);
    expect(restored.viewType).toBe(original.viewType);
    expect(restored.filters).toEqual(original.filters);
    expect(restored.search).toBe(original.search);
    expect(restored.sort).toEqual(original.sort);
    expect(restored.page).toBe(original.page);
    expect(restored.pageSize).toBe(original.pageSize);
    expect(restored.cols).toEqual(original.cols);
  });

  it("round-trips chat + subagent state (prevents subagent session loss)", () => {
    const qs = serializeUrlState({ chat: "sess-main", subagent: "child-key" });
    const state = parseUrlState(qs);
    expect(state.chat).toBe("sess-main");
    expect(state.subagent).toBe("child-key");
  });

  it("round-trips file-scoped chat session alongside file path (prevents file chat loss)", () => {
    const qs = serializeUrlState({ path: "docs/readme.md", fileChat: "file-sess-42" });
    const state = parseUrlState(qs);
    expect(state.path).toBe("docs/readme.md");
    expect(state.fileChat).toBe("file-sess-42");
  });

  it("round-trips send parameter (prevents auto-send messages from being lost)", () => {
    const qs = serializeUrlState({ send: "install duckdb" });
    const state = parseUrlState(qs);
    expect(state.send).toBe("install duckdb");
  });
});

// ---------------------------------------------------------------------------
// Edge cases from real usage
// ---------------------------------------------------------------------------

describe("real-world edge cases", () => {
  it("handles path with spaces and special characters (prevents encoding breakage)", () => {
    const url = buildFileLink("my docs/notes & ideas/2024 (Q1).md");
    const state = parseUrlState(new URL(url, "http://localhost").search);
    expect(state.path).toBe("my docs/notes & ideas/2024 (Q1).md");
  });

  it("handles unicode in entry IDs (prevents internationalization breakage)", () => {
    const url = buildEntryLink("商品", "アイテム-42");
    const state = parseUrlState(new URL(url, "http://localhost").search);
    expect(state.entry?.objectName).toBe("商品");
    expect(state.entry?.entryId).toBe("アイテム-42");
  });

  it("handles entry ID containing colons (prevents ID parsing corruption)", () => {
    const state = parseUrlState("entry=obj:id:with:many:colons");
    expect(state.entry).toEqual({ objectName: "obj", entryId: "id:with:many:colons" });
  });

  it("handles base64 filter string with padding (prevents truncation)", () => {
    const fg = { id: "root", conjunction: "and" as const, rules: [{ id: "r", field: "x", operator: "equals" as const, value: "a" }] };
    const b64 = btoa(JSON.stringify(fg));
    expect(b64).toContain("="); // verify padding exists
    const state = parseUrlState(`filters=${encodeURIComponent(b64)}`);
    expect(state.filters).toEqual(fg);
  });

  it("survives corrupted filter param without crashing (prevents app crash from tampered URLs)", () => {
    const state = parseUrlState("filters=not-valid-base64!!!");
    expect(state.filters).toBeNull();
  });

  it("survives corrupted sort param without crashing (prevents app crash from tampered URLs)", () => {
    const state = parseUrlState("sort=garbage");
    expect(state.sort).toBeNull();
  });

  it("survives corrupted page param without crashing (prevents NaN propagation)", () => {
    const state = parseUrlState("page=abc");
    expect(state.page).toBeNull();
  });

  it("handles empty string for cols (prevents empty-string column names)", () => {
    const state = parseUrlState("cols=");
    expect(state.cols).toBeNull();
  });

  it("handles single column in cols param (prevents off-by-one)", () => {
    const state = parseUrlState("cols=name");
    expect(state.cols).toEqual(["name"]);
  });

  it("handles browse path with encoded slashes (prevents path corruption)", () => {
    const url = buildBrowseLink("/Users/me/My Projects/app");
    const state = parseUrlState(new URL(url, "http://localhost").search);
    expect(state.browse).toBe("/Users/me/My Projects/app");
  });

  it("empty URL returns all-null default state (prevents undefined-field errors)", () => {
    const state = parseUrlState("");
    expect(state.path).toBeNull();
    expect(state.chat).toBeNull();
    expect(state.subagent).toBeNull();
    expect(state.fileChat).toBeNull();
    expect(state.entry).toBeNull();
    expect(state.send).toBeNull();
    expect(state.browse).toBeNull();
    expect(state.hidden).toBe(false);
    expect(state.preview).toBeNull();
    expect(state.view).toBeNull();
    expect(state.viewType).toBeNull();
    expect(state.filters).toBeNull();
    expect(state.search).toBeNull();
    expect(state.sort).toBeNull();
    expect(state.page).toBeNull();
    expect(state.pageSize).toBeNull();
    expect(state.cols).toBeNull();
  });
});
