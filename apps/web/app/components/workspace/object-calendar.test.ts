import { describe, expect, it } from "vitest";
import {
	startOfMonth, endOfMonth, startOfWeek, endOfWeek,
	eachDayOfInterval, format,
	parseISO, addDays,
} from "date-fns";

/**
 * Pure calendar grid computation extracted for testing.
 * These functions mirror the logic inside ObjectCalendar's MonthView.
 */

function buildMonthGrid(date: Date): { days: Date[]; weekCount: number } {
	const monthStart = startOfMonth(date);
	const monthEnd = endOfMonth(date);
	const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
	const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
	const days = eachDayOfInterval({ start: calStart, end: calEnd });
	return { days, weekCount: days.length / 7 };
}

function groupEventsByDay(
	events: { id: string; date: Date; endDate?: Date }[],
): Map<string, string[]> {
	const map = new Map<string, string[]>();
	for (const ev of events) {
		const key = format(ev.date, "yyyy-MM-dd");
		if (!map.has(key)) {map.set(key, []);}
		map.get(key)!.push(ev.id);
		if (ev.endDate && format(ev.date, "yyyy-MM-dd") !== format(ev.endDate, "yyyy-MM-dd")) {
			const spanDays = eachDayOfInterval({ start: addDays(ev.date, 1), end: ev.endDate });
			for (const d of spanDays) {
				const dk = format(d, "yyyy-MM-dd");
				if (!map.has(dk)) {map.set(dk, []);}
				map.get(dk)!.push(ev.id);
			}
		}
	}
	return map;
}

// ---------------------------------------------------------------------------
// Month grid generation
// ---------------------------------------------------------------------------

describe("buildMonthGrid", () => {
	it("always produces a multiple of 7 days (grid must be rectangular)", () => {
		for (let m = 0; m < 12; m++) {
			const { days } = buildMonthGrid(new Date(2026, m, 15));
			expect(days.length % 7).toBe(0);
		}
	});

	it("includes padding days from previous and next months (prevents empty cells)", () => {
		const { days } = buildMonthGrid(new Date(2026, 2, 15)); // March 2026
		const marchStart = startOfMonth(new Date(2026, 2, 15));
		const firstDay = days[0];
		const lastDay = days[days.length - 1];

		expect(firstDay <= marchStart).toBe(true);
		expect(lastDay >= endOfMonth(new Date(2026, 2, 15))).toBe(true);
	});

	it("starts grid on Monday (weekStartsOn: 1)", () => {
		const { days } = buildMonthGrid(new Date(2026, 0, 15)); // January 2026
		expect(format(days[0], "EEEE")).toBe("Monday");
	});

	it("ends grid on Sunday", () => {
		const { days } = buildMonthGrid(new Date(2026, 5, 15)); // June 2026
		expect(format(days[days.length - 1], "EEEE")).toBe("Sunday");
	});

	it("produces 4-6 weeks for any month (standard calendar range)", () => {
		for (let m = 0; m < 12; m++) {
			const { weekCount } = buildMonthGrid(new Date(2026, m, 1));
			expect(weekCount).toBeGreaterThanOrEqual(4);
			expect(weekCount).toBeLessThanOrEqual(6);
		}
	});
});

// ---------------------------------------------------------------------------
// Event grouping by day
// ---------------------------------------------------------------------------

describe("groupEventsByDay", () => {
	it("groups single-day events by their date key", () => {
		const events = [
			{ id: "a", date: parseISO("2026-03-10") },
			{ id: "b", date: parseISO("2026-03-10") },
			{ id: "c", date: parseISO("2026-03-11") },
		];
		const grouped = groupEventsByDay(events);
		expect(grouped.get("2026-03-10")).toEqual(["a", "b"]);
		expect(grouped.get("2026-03-11")).toEqual(["c"]);
	});

	it("spans multi-day events across all covered days (prevents disappearing events)", () => {
		const events = [
			{
				id: "multiday",
				date: parseISO("2026-03-10"),
				endDate: parseISO("2026-03-13"),
			},
		];
		const grouped = groupEventsByDay(events);
		expect(grouped.get("2026-03-10")).toContain("multiday");
		expect(grouped.get("2026-03-11")).toContain("multiday");
		expect(grouped.get("2026-03-12")).toContain("multiday");
		expect(grouped.get("2026-03-13")).toContain("multiday");
	});

	it("does not span same-day events (endDate === date)", () => {
		const events = [
			{
				id: "sameday",
				date: parseISO("2026-03-10"),
				endDate: parseISO("2026-03-10"),
			},
		];
		const grouped = groupEventsByDay(events);
		expect(grouped.get("2026-03-10")).toEqual(["sameday"]);
		expect(grouped.has("2026-03-11")).toBe(false);
	});

	it("returns empty map for no events", () => {
		const grouped = groupEventsByDay([]);
		expect(grouped.size).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Date parsing edge cases
// ---------------------------------------------------------------------------

describe("calendar date parsing", () => {
	it("parseISO handles ISO date strings correctly", () => {
		const d = parseISO("2026-03-15");
		expect(d.getFullYear()).toBe(2026);
		expect(d.getMonth()).toBe(2); // 0-indexed
		expect(d.getDate()).toBe(15);
	});

	it("parseISO handles datetime strings (calendar should use date portion only)", () => {
		const d = parseISO("2026-03-15T14:30:00Z");
		expect(d.getFullYear()).toBe(2026);
		expect(d.getMonth()).toBe(2);
		expect(d.getDate()).toBe(15);
	});

	it("parseISO returns Invalid Date for garbage input (calendar should skip these)", () => {
		const d = parseISO("not-a-date");
		expect(Number.isNaN(d.getTime())).toBe(true);
	});
});
