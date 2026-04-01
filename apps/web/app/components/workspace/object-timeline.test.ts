import { describe, expect, it } from "vitest";
import {
	parseISO, differenceInDays, addDays, subMonths, addMonths,
	eachDayOfInterval, eachWeekOfInterval, eachMonthOfInterval,
} from "date-fns";

/**
 * Pure timeline computation extracted for testing.
 * Mirrors the logic inside ObjectTimeline.
 */

type TimelineZoom = "day" | "week" | "month" | "quarter";

function getTimelineBounds(
	items: { startDate: Date; endDate: Date }[],
	zoom: TimelineZoom,
): { start: Date; end: Date } {
	if (items.length === 0) {
		const now = new Date();
		return { start: subMonths(now, 1), end: addMonths(now, 2) };
	}
	const earliest = new Date(Math.min(...items.map((i) => i.startDate.getTime())));
	const latest = new Date(Math.max(...items.map((i) => i.endDate.getTime())));
	const paddingDays = zoom === "day" ? 3 : zoom === "week" ? 7 : zoom === "month" ? 14 : 30;
	return {
		start: addDays(earliest, -paddingDays),
		end: addDays(latest, paddingDays),
	};
}

function dateToX(date: Date, timelineStart: Date, dayWidth: number): number {
	return differenceInDays(date, timelineStart) * dayWidth;
}

function getHeaderTicks(
	start: Date,
	end: Date,
	zoom: TimelineZoom,
): Date[] {
	switch (zoom) {
		case "day":
			return eachDayOfInterval({ start, end });
		case "week":
			return eachWeekOfInterval({ start, end }, { weekStartsOn: 1 });
		case "month":
			return eachMonthOfInterval({ start, end });
		case "quarter":
			return eachMonthOfInterval({ start, end }).filter((d) => d.getMonth() % 3 === 0);
	}
}

// ---------------------------------------------------------------------------
// Timeline bounds
// ---------------------------------------------------------------------------

describe("getTimelineBounds", () => {
	it("provides sensible defaults for empty item list (prevents zero-width timeline)", () => {
		const { start, end } = getTimelineBounds([], "week");
		expect(end > start).toBe(true);
		const span = differenceInDays(end, start);
		expect(span).toBeGreaterThan(30);
	});

	it("adds padding around the earliest and latest dates", () => {
		const items = [
			{ startDate: parseISO("2026-03-10"), endDate: parseISO("2026-03-20") },
		];
		const { start, end } = getTimelineBounds(items, "week");
		expect(start < items[0].startDate).toBe(true);
		expect(end > items[0].endDate).toBe(true);
	});

	it("uses zoom-appropriate padding (day zoom = tight, quarter zoom = wide)", () => {
		const items = [
			{ startDate: parseISO("2026-06-01"), endDate: parseISO("2026-06-30") },
		];
		const dayBounds = getTimelineBounds(items, "day");
		const quarterBounds = getTimelineBounds(items, "quarter");
		const dayPadding = differenceInDays(items[0].startDate, dayBounds.start);
		const quarterPadding = differenceInDays(items[0].startDate, quarterBounds.start);
		expect(quarterPadding).toBeGreaterThan(dayPadding);
	});

	it("handles single-day items (start === end causes zero-width bar without padding)", () => {
		const items = [
			{ startDate: parseISO("2026-03-15"), endDate: parseISO("2026-03-15") },
		];
		const { start, end } = getTimelineBounds(items, "week");
		expect(differenceInDays(end, start)).toBeGreaterThan(7);
	});
});

// ---------------------------------------------------------------------------
// Date-to-pixel conversion
// ---------------------------------------------------------------------------

describe("dateToX", () => {
	const start = parseISO("2026-03-01");

	it("returns 0 for the timeline start date", () => {
		expect(dateToX(start, start, 30)).toBe(0);
	});

	it("scales linearly with day count", () => {
		expect(dateToX(addDays(start, 10), start, 30)).toBe(300);
	});

	it("produces different widths at different zoom levels (zoom changes dayWidth)", () => {
		const d = addDays(start, 7);
		expect(dateToX(d, start, 80)).toBe(560);  // day zoom
		expect(dateToX(d, start, 30)).toBe(210);   // week zoom
		expect(dateToX(d, start, 10)).toBe(70);    // month zoom
		expect(dateToX(d, start, 4)).toBe(28);     // quarter zoom
	});

	it("returns negative for dates before timeline start (used for clipping)", () => {
		const before = addDays(start, -5);
		expect(dateToX(before, start, 30)).toBe(-150);
	});
});

// ---------------------------------------------------------------------------
// Header tick generation
// ---------------------------------------------------------------------------

describe("getHeaderTicks", () => {
	const start = parseISO("2026-03-01");
	const end = parseISO("2026-06-30");

	it("'day' zoom produces one tick per day", () => {
		const shortEnd = addDays(start, 6);
		const ticks = getHeaderTicks(start, shortEnd, "day");
		expect(ticks.length).toBe(7);
	});

	it("'week' zoom produces one tick per week", () => {
		const ticks = getHeaderTicks(start, end, "week");
		const expectedWeeks = Math.ceil(differenceInDays(end, start) / 7);
		expect(ticks.length).toBeGreaterThanOrEqual(expectedWeeks - 1);
		expect(ticks.length).toBeLessThanOrEqual(expectedWeeks + 1);
	});

	it("'month' zoom produces one tick per month", () => {
		const ticks = getHeaderTicks(start, end, "month");
		expect(ticks.length).toBe(4); // Mar, Apr, May, Jun
	});

	it("'quarter' zoom only includes quarter-start months (Jan, Apr, Jul, Oct)", () => {
		const yearStart = parseISO("2026-01-01");
		const yearEnd = parseISO("2026-12-31");
		const ticks = getHeaderTicks(yearStart, yearEnd, "quarter");
		expect(ticks.length).toBe(4);
		for (const tick of ticks) {
			expect(tick.getMonth() % 3).toBe(0);
		}
	});
});

// ---------------------------------------------------------------------------
// Bar width computation
// ---------------------------------------------------------------------------

describe("timeline bar positioning", () => {
	const timelineStart = parseISO("2026-03-01");
	const dayWidth = 30;

	it("bar width equals (endDate - startDate) * dayWidth", () => {
		const item = {
			startDate: parseISO("2026-03-10"),
			endDate: parseISO("2026-03-15"),
		};
		const x = dateToX(item.startDate, timelineStart, dayWidth);
		const w = dateToX(item.endDate, timelineStart, dayWidth) - x;
		expect(x).toBe(9 * 30);
		expect(w).toBe(5 * 30);
	});

	it("minimum bar width prevents invisible zero-width bars", () => {
		const item = {
			startDate: parseISO("2026-03-10"),
			endDate: parseISO("2026-03-10"), // same day
		};
		const x = dateToX(item.startDate, timelineStart, dayWidth);
		const rawW = dateToX(item.endDate, timelineStart, dayWidth) - x;
		const minW = dayWidth * 0.5;
		const w = Math.max(rawW, minW);
		expect(w).toBe(minW); // zero-width gets minimum
		expect(w).toBeGreaterThan(0);
	});
});
