"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "../ui/dropdown-menu";

/* ─── Field Type Constants ─── */

export const FIELD_TYPES = [
	{ value: "text", label: "Text" },
	{ value: "number", label: "Number" },
	{ value: "email", label: "Email" },
	{ value: "phone", label: "Phone" },
	{ value: "date", label: "Date" },
	{ value: "boolean", label: "Checkbox" },
	{ value: "enum", label: "Select" },
	{ value: "tags", label: "Tags" },
	{ value: "url", label: "URL" },
	{ value: "richtext", label: "Rich Text" },
] as const;

export function fieldTypeLabel(type: string): string {
	const found = FIELD_TYPES.find((ft) => ft.value === type);
	return found?.label ?? type.charAt(0).toUpperCase() + type.slice(1);
}

/* ─── Field Type Icon ─── */

export function FieldTypeIcon({ type, size = 14, className }: { type: string; size?: number; className?: string }) {
	const s = {
		width: size, height: size, viewBox: "0 0 24 24", fill: "none",
		stroke: "currentColor", strokeWidth: 2,
		strokeLinecap: "round" as const, strokeLinejoin: "round" as const, className,
	};
	switch (type) {
		case "text":
			return <svg {...s}><path d="M4 7V4h16v3" /><path d="M9 20h6" /><path d="M12 4v16" /></svg>;
		case "number":
			return <svg {...s}><path d="M4 9h16" /><path d="M4 15h16" /><path d="M10 3 8 21" /><path d="M16 3 14 21" /></svg>;
		case "email":
			return <svg {...s}><rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></svg>;
		case "phone":
			return <svg {...s}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>;
		case "date":
			return <svg {...s}><path d="M8 2v4" /><path d="M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" /></svg>;
		case "boolean":
			return <svg {...s}><rect width="18" height="18" x="3" y="3" rx="2" /><path d="m9 12 2 2 4-4" /></svg>;
		case "enum":
			return <svg {...s}><rect width="18" height="18" x="3" y="3" rx="2" /><path d="m8 10 4 4 4-4" /></svg>;
		case "tags":
			return <svg {...s}><path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z" /><path d="M7 7h.01" /></svg>;
		case "url":
			return <svg {...s}><circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" /></svg>;
		case "richtext":
			return <svg {...s}><path d="M17 6H3" /><path d="M21 12H3" /><path d="M15.1 18H3" /></svg>;
		case "relation":
			return <svg {...s}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>;
		case "user":
			return <svg {...s}><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>;
		case "action":
			return <svg {...s}><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" /></svg>;
		case "file":
			return <svg {...s}><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /></svg>;
		default:
			return <svg {...s}><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>;
	}
}

/* ─── Column Header Menu ─── */

export type ColumnHeaderMenuProps = {
	field: { id: string; name: string; type: string };
	sortDirection: "asc" | "desc" | false;
	onSort: (desc: boolean) => void;
	onHide: () => void;
	onRename: () => void;
	onDelete: () => void;
	canMoveLeft: boolean;
	canMoveRight: boolean;
	onMoveLeft: () => void;
	onMoveRight: () => void;
};

export function ColumnHeaderMenu({
	field, sortDirection, onSort, onHide, onRename, onDelete,
	canMoveLeft, canMoveRight, onMoveLeft, onMoveRight,
}: ColumnHeaderMenuProps) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				className="col-header-menu-trigger shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-60 aria-expanded:opacity-100 hover:!opacity-100 transition-opacity ml-auto"
				style={{ color: "var(--color-text-muted)" }}
				onClick={(e: React.MouseEvent) => e.stopPropagation()}
				onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
			>
				<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
					<path d="m6 9 6 6 6-6" />
				</svg>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" sideOffset={6} className="min-w-[180px]">
				<div className="flex items-center gap-2 px-2.5 py-1.5 text-xs normal-case tracking-normal" style={{ color: "var(--color-text-muted)" }}>
					<FieldTypeIcon type={field.type} size={14} className="shrink-0" />
					<span className="font-medium">{fieldTypeLabel(field.type)}</span>
				</div>
				<DropdownMenuSeparator />
				<DropdownMenuItem onSelect={onRename}>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
					Rename
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem onSelect={() => onSort(false)}>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 7-7 7 7" /></svg>
					Sort ascending
					{sortDirection === "asc" && <span className="ml-auto text-[10px] font-medium" style={{ color: "var(--color-accent)" }}>On</span>}
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => onSort(true)}>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m19 12-7 7-7-7" /></svg>
					Sort descending
					{sortDirection === "desc" && <span className="ml-auto text-[10px] font-medium" style={{ color: "var(--color-accent)" }}>On</span>}
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem onSelect={onHide}>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" /><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" /><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" /><path d="m2 2 20 20" /></svg>
					Hide column
				</DropdownMenuItem>
				{(canMoveLeft || canMoveRight) && <DropdownMenuSeparator />}
				{canMoveLeft && (
					<DropdownMenuItem onSelect={onMoveLeft}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></svg>
						Move left
					</DropdownMenuItem>
				)}
				{canMoveRight && (
					<DropdownMenuItem onSelect={onMoveRight}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
						Move right
					</DropdownMenuItem>
				)}
				<DropdownMenuSeparator />
				<DropdownMenuItem variant="destructive" onSelect={onDelete}>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
					Delete column
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/* ─── Inline Rename Input ─── */

export function InlineRenameInput({
	currentName,
	onSave,
	onCancel,
}: {
	currentName: string;
	onSave: (newName: string) => void;
	onCancel: () => void;
}) {
	const [value, setValue] = useState(currentName);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		const el = inputRef.current;
		if (el) { el.focus(); el.select(); }
	}, []);

	const handleSave = useCallback(() => {
		const trimmed = value.trim();
		if (trimmed && trimmed !== currentName) {
			onSave(trimmed);
		} else {
			onCancel();
		}
	}, [value, currentName, onSave, onCancel]);

	return (
		<input
			ref={inputRef}
			type="text"
			value={value}
			onChange={(e) => setValue(e.target.value)}
			onBlur={handleSave}
			onKeyDown={(e) => {
				e.stopPropagation();
				if (e.key === "Enter") { e.preventDefault(); handleSave(); }
				if (e.key === "Escape") { e.preventDefault(); onCancel(); }
			}}
			onClick={(e) => e.stopPropagation()}
			onPointerDown={(e) => e.stopPropagation()}
			className="w-full text-xs font-medium outline-none bg-transparent normal-case tracking-normal rounded px-1.5 py-0.5 -mx-1.5"
			style={{
				color: "var(--color-text)",
				background: "var(--color-bg)",
				boxShadow: "inset 0 0 0 2px var(--color-accent)",
			}}
		/>
	);
}

/* ─── Add Column Popover ─── */

export function AddColumnPopover({
	objectName,
	onCreated,
}: {
	objectName: string;
	onCreated: () => void;
}) {
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [type, setType] = useState("text");
	const [enumInput, setEnumInput] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const [position, setPosition] = useState({ top: 0, left: 0 });

	const handleOpen = useCallback(() => {
		const rect = triggerRef.current?.getBoundingClientRect();
		if (rect) {
			const panelWidth = 280;
			let left = rect.left;
			if (left + panelWidth > window.innerWidth - 16) {
				left = Math.max(16, rect.right - panelWidth);
			}
			setPosition({ top: rect.bottom + 6, left });
		}
		setOpen(true);
		setName("");
		setType("text");
		setEnumInput("");
		setError(null);
	}, []);

	const handleClose = useCallback(() => {
		setOpen(false);
		setError(null);
	}, []);

	useEffect(() => {
		if (open) {
			const timer = setTimeout(() => inputRef.current?.focus(), 50);
			return () => clearTimeout(timer);
		}
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const handleClick = (e: MouseEvent) => {
			if (
				panelRef.current && !panelRef.current.contains(e.target as Node) &&
				triggerRef.current && !triggerRef.current.contains(e.target as Node)
			) {
				handleClose();
			}
		};
		const handleEsc = (e: KeyboardEvent) => {
			if (e.key === "Escape") handleClose();
		};
		document.addEventListener("mousedown", handleClick);
		document.addEventListener("keydown", handleEsc);
		return () => {
			document.removeEventListener("mousedown", handleClick);
			document.removeEventListener("keydown", handleEsc);
		};
	}, [open, handleClose]);

	const handleCreate = useCallback(async () => {
		if (!name.trim()) return;
		const body: Record<string, unknown> = { name: name.trim(), type };
		if (type === "enum") {
			const vals = enumInput.split(",").map((s) => s.trim()).filter(Boolean);
			if (vals.length === 0) { setError("Add at least one option"); return; }
			body.enum_values = vals;
		}
		setSaving(true);
		setError(null);
		try {
			const res = await fetch(`/api/workspace/objects/${encodeURIComponent(objectName)}/fields`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			if (!res.ok) {
				const data = await res.json().catch(() => ({ error: "Failed" }));
				setError(data.error ?? "Failed to create field");
				return;
			}
			handleClose();
			onCreated();
		} catch {
			setError("Network error");
		} finally {
			setSaving(false);
		}
	}, [name, type, enumInput, objectName, handleClose, onCreated]);

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				onClick={(e) => { e.stopPropagation(); if (open) handleClose(); else handleOpen(); }}
				onPointerDown={(e) => e.stopPropagation()}
				className="flex items-center justify-center w-full h-full transition-colors"
				style={{ color: open ? "var(--color-accent)" : "var(--color-text-muted)", opacity: open ? 1 : 0.4 }}
				title="Add column"
			>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
					<path d="M12 5v14" /><path d="M5 12h14" />
				</svg>
			</button>

			{open && typeof document !== "undefined" && createPortal(
				<div
					ref={panelRef}
					className="fixed z-[10000] w-[280px] rounded-2xl overflow-hidden animate-in fade-in-0 zoom-in-95 slide-in-from-top-2"
					style={{
						top: position.top,
						left: position.left,
						background: "var(--color-bg)",
						border: "1px solid var(--color-border)",
						boxShadow: "0 8px 32px rgba(0,0,0,0.16), 0 0 1px rgba(0,0,0,0.1)",
					}}
					onClick={(e) => e.stopPropagation()}
					onPointerDown={(e) => e.stopPropagation()}
				>
					<div className="p-3 pb-2" style={{ borderBottom: "1px solid var(--color-border)" }}>
						<input
							ref={inputRef}
							type="text"
							value={name}
							onChange={(e) => setName(e.target.value)}
							onKeyDown={(e) => {
								e.stopPropagation();
								if (e.key === "Enter" && name.trim()) { void handleCreate(); }
								if (e.key === "Escape") { handleClose(); }
							}}
							placeholder="Column name..."
							className="w-full px-2.5 py-1.5 text-sm rounded-lg outline-none"
							style={{
								background: "var(--color-surface)",
								color: "var(--color-text)",
								border: "1px solid var(--color-border)",
							}}
						/>
					</div>

					<div className="p-2">
						<div className="text-[10px] font-medium uppercase tracking-wider px-1 mb-1.5" style={{ color: "var(--color-text-muted)" }}>
							Type
						</div>
						<div className="grid grid-cols-2 gap-0.5">
							{FIELD_TYPES.map((ft) => (
								<button
									key={ft.value}
									type="button"
									onClick={() => setType(ft.value)}
									className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs transition-all text-left"
									style={{
										color: type === ft.value ? "var(--color-accent)" : "var(--color-text)",
										background: type === ft.value ? "var(--color-accent-light, rgba(99,102,241,0.08))" : "transparent",
										fontWeight: type === ft.value ? 600 : 400,
									}}
								>
									<FieldTypeIcon type={ft.value} size={14} className="shrink-0" />
									{ft.label}
								</button>
							))}
						</div>
					</div>

					{type === "enum" && (
						<div className="px-3 pb-2">
							<input
								type="text"
								value={enumInput}
								onChange={(e) => setEnumInput(e.target.value)}
								onKeyDown={(e) => {
									e.stopPropagation();
									if (e.key === "Enter" && name.trim()) { void handleCreate(); }
								}}
								placeholder="Options (comma-separated)"
								className="w-full px-2.5 py-1.5 text-sm rounded-lg outline-none"
								style={{
									background: "var(--color-surface)",
									color: "var(--color-text)",
									border: "1px solid var(--color-border)",
								}}
							/>
						</div>
					)}

					{error && (
						<div className="px-3 pb-2">
							<p className="text-xs" style={{ color: "var(--color-error)" }}>{error}</p>
						</div>
					)}

					<div className="flex items-center justify-end gap-2 px-3 py-2.5" style={{ borderTop: "1px solid var(--color-border)" }}>
						<button
							type="button"
							onClick={handleClose}
							className="px-3 py-1.5 text-xs rounded-lg transition-colors hover:opacity-70"
							style={{ color: "var(--color-text-muted)" }}
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={() => void handleCreate()}
							disabled={saving || !name.trim()}
							className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-40"
							style={{ background: "var(--color-accent)", color: "white" }}
						>
							{saving ? "Creating..." : "Create"}
						</button>
					</div>
				</div>,
				document.body,
			)}
		</>
	);
}
