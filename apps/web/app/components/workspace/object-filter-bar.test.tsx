// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { emptyFilterGroup, type SavedView } from "@/lib/object-filters";
import { ObjectFilterBar } from "./object-filter-bar";

const fields = [
  { id: "f-name", name: "Name", type: "text" },
  { id: "f-status", name: "Status", type: "enum", enum_values: ["Important", "Backlog"] },
];

const importantView: SavedView = {
  name: "Important",
  filters: {
    id: "root",
    conjunction: "and",
    rules: [{ id: "r-important", field: "Status", operator: "is", value: "Important" }],
  },
  columns: ["Name", "Status"],
};

const backlogView: SavedView = {
  name: "Backlog",
  filters: {
    id: "root",
    conjunction: "and",
    rules: [{ id: "r-backlog", field: "Status", operator: "is", value: "Backlog" }],
  },
  columns: ["Name", "Status"],
};

describe("ObjectFilterBar views interaction", () => {
  it("loads selected view from dropdown (keeps view label and table intent aligned)", async () => {
    const user = userEvent.setup();
    const onLoadView = vi.fn();

    render(
      <ObjectFilterBar
        fields={fields}
        filters={emptyFilterGroup()}
        onFiltersChange={vi.fn()}
        savedViews={[importantView, backlogView]}
        activeViewName="Important"
        onSaveView={vi.fn()}
        onLoadView={onLoadView}
        onDeleteView={vi.fn()}
        onSetActiveView={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /important/i }));
    await user.click(screen.getByRole("button", { name: /backlog/i }));

    expect(onLoadView).toHaveBeenCalledTimes(1);
    expect(onLoadView).toHaveBeenCalledWith(backlogView);
  });

  it("clears active view from dropdown action (prevents sticky active-view state)", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    const onSetActiveView = vi.fn();

    render(
      <ObjectFilterBar
        fields={fields}
        filters={emptyFilterGroup()}
        onFiltersChange={onFiltersChange}
        savedViews={[importantView]}
        activeViewName="Important"
        onSaveView={vi.fn()}
        onLoadView={vi.fn()}
        onDeleteView={vi.fn()}
        onSetActiveView={onSetActiveView}
      />,
    );

    await user.click(screen.getByRole("button", { name: /important/i }));
    await user.click(screen.getByRole("button", { name: /clear active view/i }));

    expect(onSetActiveView).toHaveBeenCalledWith(undefined);
    expect(onFiltersChange).toHaveBeenCalledWith(emptyFilterGroup());
  });
});
