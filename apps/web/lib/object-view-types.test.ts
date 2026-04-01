import { describe, expect, it } from "vitest";
import {
	resolveViewType,
	resolveViewSettings,
	autoDetectViewField,
	type SavedView,
	type ViewType,
	type ViewTypeSettings,
	type FieldMeta,
	VIEW_TYPES,
} from "./object-filters";

// ---------------------------------------------------------------------------
// resolveViewType
// ---------------------------------------------------------------------------

describe("resolveViewType", () => {
	it("uses saved view's view_type when present (view overrides all defaults)", () => {
		const view: SavedView = { name: "Board", view_type: "kanban" };
		expect(resolveViewType(view, "table", "table")).toBe("kanban");
	});

	it("falls back to currentViewType when saved view has no view_type", () => {
		const view: SavedView = { name: "Filtered" };
		expect(resolveViewType(view, "calendar", "table")).toBe("calendar");
	});

	it("falls back to object default when both saved view and current are undefined", () => {
		expect(resolveViewType(undefined, undefined, "kanban")).toBe("kanban");
	});

	it("falls back to 'table' when nothing is specified", () => {
		expect(resolveViewType(undefined, undefined, undefined)).toBe("table");
	});

	it("rejects invalid view types in saved view and falls through (prevents garbage data from breaking UI)", () => {
		const view = { name: "Bad", view_type: "nonexistent" as ViewType };
		expect(resolveViewType(view, undefined, "kanban")).toBe("kanban");
	});

	it("rejects invalid object default and falls to 'table' (prevents DB corruption from crashing)", () => {
		expect(resolveViewType(undefined, undefined, "invalid_type")).toBe("table");
	});

	it("accepts every valid ViewType without falling through", () => {
		for (const vt of VIEW_TYPES) {
			const view: SavedView = { name: "Test", view_type: vt };
			expect(resolveViewType(view, undefined, undefined)).toBe(vt);
		}
	});
});

// ---------------------------------------------------------------------------
// resolveViewSettings
// ---------------------------------------------------------------------------

describe("resolveViewSettings", () => {
	it("returns saved view settings when no object defaults exist", () => {
		const settings: ViewTypeSettings = { kanbanField: "Priority" };
		expect(resolveViewSettings(settings, undefined)).toEqual({ kanbanField: "Priority" });
	});

	it("returns object defaults when no saved view settings exist", () => {
		const defaults: ViewTypeSettings = { calendarDateField: "Due Date" };
		expect(resolveViewSettings(undefined, defaults)).toEqual({ calendarDateField: "Due Date" });
	});

	it("saved view settings override object defaults (per-view customization works)", () => {
		const defaults: ViewTypeSettings = { kanbanField: "Status", calendarDateField: "Date" };
		const override: ViewTypeSettings = { kanbanField: "Priority" };
		const result = resolveViewSettings(override, defaults);
		expect(result.kanbanField).toBe("Priority");
		expect(result.calendarDateField).toBe("Date");
	});

	it("returns empty object when both inputs are undefined", () => {
		expect(resolveViewSettings(undefined, undefined)).toEqual({});
	});

	it("does not override object defaults with undefined saved view values (partial override is safe)", () => {
		const defaults: ViewTypeSettings = {
			kanbanField: "Status",
			calendarDateField: "Due Date",
			timelineStartField: "Start",
		};
		const partial: ViewTypeSettings = { kanbanField: "Priority" };
		const result = resolveViewSettings(partial, defaults);
		expect(result.kanbanField).toBe("Priority");
		expect(result.calendarDateField).toBe("Due Date");
		expect(result.timelineStartField).toBe("Start");
	});
});

// ---------------------------------------------------------------------------
// autoDetectViewField
// ---------------------------------------------------------------------------

describe("autoDetectViewField", () => {
	const fields: FieldMeta[] = [
		{ name: "Title", type: "text" },
		{ name: "Description", type: "text" },
		{ name: "Status", type: "enum" },
		{ name: "Priority", type: "enum" },
		{ name: "Due Date", type: "date" },
		{ name: "Start Date", type: "date" },
		{ name: "End Date", type: "date" },
		{ name: "Active", type: "boolean" },
	];

	it("detects kanbanField by preferring 'status' in name (correct heuristic for boards)", () => {
		expect(autoDetectViewField("kanban", "kanbanField", fields)).toBe("Status");
	});

	it("falls back to first enum when no field contains 'status'", () => {
		const noStatus: FieldMeta[] = [
			{ name: "Priority", type: "enum" },
			{ name: "Category", type: "enum" },
		];
		expect(autoDetectViewField("kanban", "kanbanField", noStatus)).toBe("Priority");
	});

	it("detects calendarDateField by preferring 'due/start/begin' in name", () => {
		expect(autoDetectViewField("calendar", "calendarDateField", fields)).toBe("Due Date");
	});

	it("detects timelineEndField by preferring 'end/finish/close' in name", () => {
		expect(autoDetectViewField("timeline", "timelineEndField", fields)).toBe("End Date");
	});

	it("detects galleryTitleField by preferring 'name/title' in name", () => {
		expect(autoDetectViewField("gallery", "galleryTitleField", fields)).toBe("Title");
	});

	it("returns undefined for galleryCoverField (no cover detection)", () => {
		expect(autoDetectViewField("gallery", "galleryCoverField", fields)).toBeUndefined();
	});

	it("returns undefined when no matching field type exists (prevents crash on sparse schemas)", () => {
		const noDate: FieldMeta[] = [{ name: "Name", type: "text" }];
		expect(autoDetectViewField("calendar", "calendarDateField", noDate)).toBeUndefined();
	});
});
