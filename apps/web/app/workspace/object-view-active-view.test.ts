import { describe, expect, it } from "vitest";
import { emptyFilterGroup, type FilterGroup, type SavedView } from "@/lib/object-filters";
import { resolveActiveViewSyncDecision } from "./object-view-active-view";

function statusFilter(value: string): FilterGroup {
  return {
    id: "root",
    conjunction: "and",
    rules: [
      { id: "rule-status", field: "Status", operator: "is", value },
    ],
  };
}

describe("resolveActiveViewSyncDecision", () => {
  const importantView: SavedView = {
    name: "Important",
    filters: statusFilter("Important"),
    columns: ["Name", "Status", "Owner"],
  };

  it("applies active view on initial load even when active view name already matches (prevents visible-but-unapplied bug)", () => {
    const decision = resolveActiveViewSyncDecision({
      savedViews: [importantView],
      activeView: "Important",
      currentActiveViewName: "Important",
      currentFilters: emptyFilterGroup(),
      currentViewColumns: undefined,
      currentColumnWidths: undefined,
    });

    expect(decision).not.toBeNull();
    expect(decision?.shouldApply).toBe(true);
    expect(decision?.nextFilters).toEqual(statusFilter("Important"));
    expect(decision?.nextColumns).toEqual(["Name", "Status", "Owner"]);
  });

  it("does not re-apply when name, filters, and columns are already aligned", () => {
    const decision = resolveActiveViewSyncDecision({
      savedViews: [importantView],
      activeView: "Important",
      currentActiveViewName: "Important",
      currentFilters: statusFilter("Important"),
      currentViewColumns: ["Name", "Status", "Owner"],
      currentColumnWidths: undefined,
    });

    expect(decision).not.toBeNull();
    expect(decision?.shouldApply).toBe(false);
  });

  it("re-applies when active view changes during refresh (keeps label and table state in sync)", () => {
    const backlogView: SavedView = {
      name: "Backlog",
      filters: statusFilter("Backlog"),
      columns: ["Name", "Status"],
    };

    const decision = resolveActiveViewSyncDecision({
      savedViews: [importantView, backlogView],
      activeView: "Backlog",
      currentActiveViewName: "Important",
      currentFilters: statusFilter("Important"),
      currentViewColumns: ["Name", "Status", "Owner"],
      currentColumnWidths: undefined,
    });

    expect(decision).not.toBeNull();
    expect(decision?.shouldApply).toBe(true);
    expect(decision?.nextActiveViewName).toBe("Backlog");
    expect(decision?.nextFilters).toEqual(statusFilter("Backlog"));
    expect(decision?.nextColumns).toEqual(["Name", "Status"]);
  });

  it("returns null when active view is missing or cannot be resolved", () => {
    const missingActive = resolveActiveViewSyncDecision({
      savedViews: [importantView],
      activeView: undefined,
      currentActiveViewName: "Important",
      currentFilters: statusFilter("Important"),
      currentViewColumns: ["Name", "Status", "Owner"],
      currentColumnWidths: undefined,
    });

    const unknownActive = resolveActiveViewSyncDecision({
      savedViews: [importantView],
      activeView: "Unknown",
      currentActiveViewName: "Important",
      currentFilters: statusFilter("Important"),
      currentViewColumns: ["Name", "Status", "Owner"],
      currentColumnWidths: undefined,
    });

    expect(missingActive).toBeNull();
    expect(unknownActive).toBeNull();
  });

  // --- New tests for viewType and settings ---

  it("detects viewType change and triggers re-apply (prevents stale view mode after external edit)", () => {
    const kanbanView: SavedView = {
      name: "Board",
      view_type: "kanban",
      settings: { kanbanField: "Status" },
    };

    const decision = resolveActiveViewSyncDecision({
      savedViews: [kanbanView],
      activeView: "Board",
      currentActiveViewName: "Board",
      currentFilters: emptyFilterGroup(),
      currentViewColumns: undefined,
      currentColumnWidths: undefined,
      currentViewType: "table",
      currentSettings: undefined,
    });

    expect(decision).not.toBeNull();
    expect(decision?.shouldApply).toBe(true);
    expect(decision?.nextViewType).toBe("kanban");
    expect(decision?.nextSettings).toEqual({ kanbanField: "Status" });
  });

  it("detects settings change while name and filters stay the same (calendar mode changed externally)", () => {
    const calView: SavedView = {
      name: "Monthly",
      view_type: "calendar",
      settings: { calendarDateField: "Due Date", calendarMode: "month" },
    };

    const decision = resolveActiveViewSyncDecision({
      savedViews: [calView],
      activeView: "Monthly",
      currentActiveViewName: "Monthly",
      currentFilters: emptyFilterGroup(),
      currentViewColumns: undefined,
      currentColumnWidths: undefined,
      currentViewType: "calendar",
      currentSettings: { calendarDateField: "Due Date", calendarMode: "week" },
    });

    expect(decision?.shouldApply).toBe(true);
    expect(decision?.nextSettings?.calendarMode).toBe("month");
  });

  it("does not re-apply when viewType and settings are already aligned", () => {
    const view: SavedView = {
      name: "Timeline",
      view_type: "timeline",
      settings: { timelineStartField: "Start", timelineEndField: "End" },
    };

    const decision = resolveActiveViewSyncDecision({
      savedViews: [view],
      activeView: "Timeline",
      currentActiveViewName: "Timeline",
      currentFilters: emptyFilterGroup(),
      currentViewColumns: undefined,
      currentColumnWidths: undefined,
      currentViewType: "timeline",
      currentSettings: { timelineStartField: "Start", timelineEndField: "End" },
    });

    expect(decision?.shouldApply).toBe(false);
  });

  it("detects viewType-only change when settings are identical (prevents stuck view mode)", () => {
    const view: SavedView = {
      name: "Gallery",
      view_type: "gallery",
      settings: { galleryTitleField: "Name" },
    };

    const decision = resolveActiveViewSyncDecision({
      savedViews: [view],
      activeView: "Gallery",
      currentActiveViewName: "Gallery",
      currentFilters: emptyFilterGroup(),
      currentViewColumns: undefined,
      currentColumnWidths: undefined,
      currentViewType: "table",
      currentSettings: { galleryTitleField: "Name" },
    });

    expect(decision?.shouldApply).toBe(true);
    expect(decision?.nextViewType).toBe("gallery");
  });

  it("propagates column_widths from saved view (ensures resize state syncs)", () => {
    const viewWithWidths: SavedView = {
      name: "Custom Widths",
      filters: statusFilter("Active"),
      columns: ["Name", "Status"],
      column_widths: { Name: 250, Status: 150 },
    };

    const decision = resolveActiveViewSyncDecision({
      savedViews: [viewWithWidths],
      activeView: "Custom Widths",
      currentActiveViewName: undefined,
      currentFilters: emptyFilterGroup(),
      currentViewColumns: undefined,
      currentColumnWidths: undefined,
    });

    expect(decision).not.toBeNull();
    expect(decision?.shouldApply).toBe(true);
    expect(decision?.nextColumnWidths).toEqual({ Name: 250, Status: 150 });
  });

  it("returns undefined column_widths when view has no widths (backwards compat)", () => {
    const decision = resolveActiveViewSyncDecision({
      savedViews: [importantView],
      activeView: "Important",
      currentActiveViewName: undefined,
      currentFilters: emptyFilterGroup(),
      currentViewColumns: undefined,
      currentColumnWidths: { Name: 200 },
    });

    expect(decision).not.toBeNull();
    expect(decision?.nextColumnWidths).toBeUndefined();
  });

  it("propagates undefined viewType without crashing (backwards compat with old saved views)", () => {
    const legacyView: SavedView = {
      name: "Legacy",
      filters: statusFilter("Active"),
    };

    const decision = resolveActiveViewSyncDecision({
      savedViews: [legacyView],
      activeView: "Legacy",
      currentActiveViewName: undefined,
      currentFilters: emptyFilterGroup(),
      currentViewColumns: undefined,
      currentColumnWidths: undefined,
      currentViewType: "table",
      currentSettings: {},
    });

    expect(decision?.shouldApply).toBe(true);
    expect(decision?.nextViewType).toBeUndefined();
    expect(decision?.nextSettings).toBeUndefined();
  });
});
