"use client";

// --- Types ---

export type ContextMenuAction =
  | "open"
  | "newFile"
  | "newFolder"
  | "rename"
  | "duplicate"
  | "copy"
  | "paste"
  | "moveTo"
  | "getInfo"
  | "delete";

export type ContextMenuItem = {
  action: ContextMenuAction;
  label: string;
  shortcut?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  danger?: boolean;
  separator?: false;
} | {
  separator: true;
};

export type ContextMenuTarget =
  | { kind: "file"; path: string; name: string; isSystem: boolean }
  | { kind: "folder"; path: string; name: string; isSystem: boolean }
  | { kind: "empty" };

// --- Menu item definitions per target kind ---

export function getMenuItems(target: ContextMenuTarget): ContextMenuItem[] {
  const isSystem = target.kind !== "empty" && target.isSystem;

  if (target.kind === "file") {
    return [
      { action: "open", label: "Open" },
      { separator: true },
      { action: "rename", label: "Rename", shortcut: "Enter", disabled: isSystem },
      { action: "duplicate", label: "Duplicate", shortcut: "\u2318D", disabled: isSystem },
      { action: "copy", label: "Copy Path", shortcut: "\u2318C" },
      { separator: true },
      { action: "getInfo", label: "Get Info", shortcut: "\u2318I" },
      { separator: true },
      { action: "delete", label: "Move to Trash", shortcut: "\u2318\u232B", disabled: isSystem, danger: true },
    ];
  }

  if (target.kind === "folder") {
    return [
      { action: "open", label: "Open" },
      { separator: true },
      { action: "newFile", label: "New File", shortcut: "\u2318N", disabled: isSystem },
      { action: "newFolder", label: "New Folder", shortcut: "\u21E7\u2318N", disabled: isSystem },
      { separator: true },
      { action: "rename", label: "Rename", shortcut: "Enter", disabled: isSystem },
      { action: "duplicate", label: "Duplicate", shortcut: "\u2318D", disabled: isSystem },
      { action: "copy", label: "Copy Path", shortcut: "\u2318C" },
      { separator: true },
      { action: "getInfo", label: "Get Info", shortcut: "\u2318I" },
      { separator: true },
      { action: "delete", label: "Move to Trash", shortcut: "\u2318\u232B", disabled: isSystem, danger: true },
    ];
  }

  // Empty area
  return [
    { action: "newFile", label: "New File", shortcut: "\u2318N" },
    { action: "newFolder", label: "New Folder", shortcut: "\u21E7\u2318N" },
    { separator: true },
    { action: "paste", label: "Paste", shortcut: "\u2318V", disabled: true },
  ];
}

// --- Lock icon for system files ---

export function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
