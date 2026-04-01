"use client";

import { useState, useCallback, useRef, useEffect } from "react";

export type ActionConfig = {
	id: string;
	label: string;
	icon?: string;
	variant?: "default" | "primary" | "destructive" | "success" | "warning";
	script?: string;
	scriptPath?: string;
	runtime?: string;
	confirmMessage?: string;
	loadingLabel?: string;
	successLabel?: string;
	errorLabel?: string;
	autoResetMs?: number;
	timeout?: number;
};

export type ActionRunState = {
	status: "idle" | "loading" | "success" | "error";
	progress?: { percent: number; message?: string };
	result?: unknown;
	error?: string;
};

type ActionButtonProps = {
	action: ActionConfig;
	entryId: string;
	objectName: string;
	fieldId: string;
	compact?: boolean;
	state?: ActionRunState;
	onExecute?: (action: ActionConfig, entryId: string) => void;
	onRequestConfirm?: (action: ActionConfig, entryId: string, onConfirm: () => void) => void;
	onToast?: (message: string, opts?: { type?: "success" | "error" | "info" }) => void;
	disabled?: boolean;
};

const VARIANT_STYLES: Record<string, { bg: string; border: string; text: string; hoverBg: string }> = {
	default: {
		bg: "rgba(148, 163, 184, 0.08)",
		border: "1px solid rgba(148, 163, 184, 0.2)",
		text: "var(--color-text)",
		hoverBg: "rgba(148, 163, 184, 0.15)",
	},
	primary: {
		bg: "rgba(59, 130, 246, 0.08)",
		border: "1px solid rgba(59, 130, 246, 0.25)",
		text: "#3b82f6",
		hoverBg: "rgba(59, 130, 246, 0.15)",
	},
	destructive: {
		bg: "rgba(220, 38, 38, 0.08)",
		border: "1px solid rgba(220, 38, 38, 0.2)",
		text: "var(--color-error)",
		hoverBg: "rgba(220, 38, 38, 0.15)",
	},
	success: {
		bg: "rgba(34, 197, 94, 0.08)",
		border: "1px solid rgba(34, 197, 94, 0.25)",
		text: "#22c55e",
		hoverBg: "rgba(34, 197, 94, 0.15)",
	},
	warning: {
		bg: "rgba(245, 158, 11, 0.08)",
		border: "1px solid rgba(245, 158, 11, 0.25)",
		text: "#f59e0b",
		hoverBg: "rgba(245, 158, 11, 0.15)",
	},
};

function SpinnerIcon({ size = 12 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin">
			<path d="M21 12a9 9 0 1 1-6.219-8.56" />
		</svg>
	);
}

function CheckIcon({ size = 12 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
			<polyline points="20 6 9 17 4 12" />
		</svg>
	);
}

function XIcon({ size = 12 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
			<line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
		</svg>
	);
}

function PlayIcon({ size = 12 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<polygon points="5 3 19 12 5 21 5 3" />
		</svg>
	);
}

export function ActionButton({
	action,
	entryId,
	objectName,
	fieldId,
	compact = false,
	state,
	onExecute,
	onRequestConfirm,
	onToast,
	disabled = false,
}: ActionButtonProps) {
	const [localState, setLocalState] = useState<ActionRunState>({ status: "idle" });
	const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	const currentState = state ?? localState;
	const { status } = currentState;

	useEffect(() => {
		return () => {
			if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
			if (abortRef.current) abortRef.current.abort();
		};
	}, []);

	const executeAction = useCallback(async () => {
		if (onExecute) {
			onExecute(action, entryId);
			return;
		}

		setLocalState({ status: "loading" });
		const abort = new AbortController();
		abortRef.current = abort;

		try {
			const res = await fetch(`/api/workspace/objects/${encodeURIComponent(objectName)}/actions`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ actionId: action.id, fieldId, entryIds: [entryId] }),
				signal: abort.signal,
			});

			if (!res.ok) {
				const err = await res.json().catch(() => ({ error: "Request failed" }));
				const errMsg = err.error ?? "Request failed";
				setLocalState({ status: "error", error: errMsg });
				onToast?.(errMsg, { type: "error" });
				return;
			}

			const reader = res.body?.getReader();
			if (!reader) {
				setLocalState({ status: "error", error: "No response stream" });
				onToast?.("No response stream", { type: "error" });
				return;
			}

			const decoder = new TextDecoder();
			let buffer = "";

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";

				for (const line of lines) {
					if (line.startsWith("data: ")) {
						try {
							const event = JSON.parse(line.slice(6));
							if (event.type === "progress") {
								setLocalState({ status: "loading", progress: { percent: event.percent, message: event.message } });
							} else if (event.type === "log") {
								onToast?.(event.message ?? "", { type: event.level === "error" ? "error" : "info" });
							} else if (event.type === "completed") {
								if (event.status === "success") {
									setLocalState({ status: "success", result: event.result });
									onToast?.(action.successLabel ?? `${action.label} completed`, { type: "success" });
									resetTimerRef.current = setTimeout(() => {
										setLocalState({ status: "idle" });
									}, action.autoResetMs ?? 3000);
								} else {
									const errMsg = event.error ?? "Action failed";
									setLocalState({ status: "error", error: errMsg });
									onToast?.(errMsg, { type: "error" });
									resetTimerRef.current = setTimeout(() => {
										setLocalState({ status: "idle" });
									}, action.autoResetMs ?? 5000);
								}
							}
						} catch { /* ignore parse errors */ }
					}
				}
			}
		} catch (err) {
			if (abort.signal.aborted) return;
			const errMsg = err instanceof Error ? err.message : "Unknown error";
			setLocalState({ status: "error", error: errMsg });
			onToast?.(errMsg, { type: "error" });
		}
	}, [action, entryId, objectName, fieldId, onExecute, onToast]);

	const handleClick = useCallback((e: React.MouseEvent) => {
		e.stopPropagation();
		if (status === "loading" || disabled) return;
		if (status === "error") {
			setLocalState({ status: "idle" });
			return;
		}

		if (action.confirmMessage && onRequestConfirm) {
			onRequestConfirm(action, entryId, executeAction);
		} else {
			executeAction();
		}
	}, [status, disabled, action, entryId, onRequestConfirm, executeAction]);

	const variant = action.variant ?? "default";
	const styles = VARIANT_STYLES[variant] ?? VARIANT_STYLES.default;

	let label: string;
	let icon: React.ReactNode;
	let buttonBg = styles.bg;
	let buttonBorder = styles.border;
	let textColor = styles.text;

	switch (status) {
		case "loading":
			label = action.loadingLabel ?? "Running...";
			icon = <SpinnerIcon size={compact ? 14 : 12} />;
			break;
		case "success":
			label = action.successLabel ?? "Done!";
			icon = <CheckIcon size={compact ? 14 : 12} />;
			buttonBg = "rgba(34, 197, 94, 0.1)";
			buttonBorder = "1px solid rgba(34, 197, 94, 0.3)";
			textColor = "#22c55e";
			break;
		case "error":
			label = action.errorLabel ?? "Failed";
			icon = <XIcon size={compact ? 14 : 12} />;
			buttonBg = "rgba(220, 38, 38, 0.1)";
			buttonBorder = "1px solid rgba(220, 38, 38, 0.3)";
			textColor = "var(--color-error)";
			break;
		default:
			label = action.label;
			icon = <PlayIcon size={compact ? 14 : 12} />;
	}

	const progressPercent = currentState.progress?.percent;

	return (
		<button
			type="button"
			onClick={handleClick}
			disabled={status === "loading" || disabled}
			className="relative flex items-center gap-1.5 rounded-lg text-xs font-medium transition-all duration-200 overflow-hidden select-none"
			style={{
				padding: compact ? "4px 6px" : "5px 10px",
				background: buttonBg,
				border: buttonBorder,
				color: textColor,
				opacity: disabled ? 0.5 : 1,
				cursor: status === "loading" || disabled ? "not-allowed" : "pointer",
			}}
			title={status === "error" ? currentState.error : action.label}
			onMouseEnter={(e) => {
				if (status !== "loading" && !disabled) {
					(e.currentTarget as HTMLElement).style.background = styles.hoverBg;
				}
			}}
			onMouseLeave={(e) => {
				(e.currentTarget as HTMLElement).style.background = buttonBg;
			}}
		>
			{progressPercent != null && status === "loading" && (
				<div
					className="absolute inset-0 opacity-15 transition-all duration-300"
					style={{ background: textColor, width: `${progressPercent}%` }}
				/>
			)}
			<span className="relative z-10 flex items-center gap-1.5">
				{icon}
				{!compact && <span className="whitespace-nowrap">{label}</span>}
			</span>
		</button>
	);
}

export type BulkRunState = {
	status: "idle" | "running" | "done";
	running: number;
	succeeded: number;
	failed: number;
	total: number;
};

/**
 * Hook to manage action states across multiple entries and actions.
 */
export function useActionStates() {
	const [states, setStates] = useState<Map<string, ActionRunState>>(new Map());
	const [bulkStates, setBulkStates] = useState<Map<string, BulkRunState>>(new Map());

	const getState = useCallback((actionId: string, entryId: string): ActionRunState => {
		return states.get(`${actionId}_${entryId}`) ?? { status: "idle" };
	}, [states]);

	const setState = useCallback((actionId: string, entryId: string, state: ActionRunState) => {
		setStates((prev) => {
			const next = new Map(prev);
			next.set(`${actionId}_${entryId}`, state);
			return next;
		});
	}, []);

	const executeBulkAction = useCallback(async (
		action: ActionConfig,
		fieldId: string,
		objectName: string,
		entryIds: string[],
		opts?: {
			autoResetMs?: number;
			onToast?: (message: string, o?: { type?: "success" | "error" | "info" }) => void;
		},
	) => {
		const total = entryIds.length;
		let succeeded = 0;
		let failed = 0;
		let running = total;

		for (const eid of entryIds) {
			setState(action.id, eid, { status: "loading" });
		}
		setBulkStates((prev) => {
			const next = new Map(prev);
			next.set(action.id, { status: "running", running, succeeded, failed, total });
			return next;
		});

		try {
			const res = await fetch(`/api/workspace/objects/${encodeURIComponent(objectName)}/actions`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ actionId: action.id, fieldId, entryIds }),
			});

			if (!res.ok) {
				setBulkStates((prev) => {
					const next = new Map(prev);
					next.set(action.id, { status: "done", running: 0, succeeded: 0, failed: total, total });
					return next;
				});
				opts?.onToast?.(`${action.label} failed to start`, { type: "error" });
				return;
			}

			const reader = res.body?.getReader();
			if (!reader) return;

			const decoder = new TextDecoder();
			let buffer = "";

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";

				for (const line of lines) {
					if (!line.startsWith("data: ")) continue;
					try {
						const event = JSON.parse(line.slice(6));
						if (event.type === "progress" && event.entryId) {
							setState(action.id, event.entryId, {
								status: "loading",
								progress: { percent: event.percent, message: event.message },
							});
						} else if (event.type === "completed" && event.entryId) {
							running--;
							if (event.status === "success") {
								succeeded++;
								setState(action.id, event.entryId, { status: "success", result: event.result });
							} else {
								failed++;
								setState(action.id, event.entryId, { status: "error", error: event.error });
							}
							setBulkStates((prev) => {
								const next = new Map(prev);
								next.set(action.id, { status: running > 0 ? "running" : "done", running, succeeded, failed, total });
								return next;
							});

							const autoMs = opts?.autoResetMs ?? action.autoResetMs ?? 3000;
							setTimeout(() => {
								setState(action.id, event.entryId, { status: "idle" });
							}, autoMs);
						}
					} catch { /* ignore */ }
				}
			}
		} catch { /* ignore */ }

		setBulkStates((prev) => {
			const next = new Map(prev);
			next.set(action.id, { status: "done", running: 0, succeeded, failed, total });
			return next;
		});

		if (failed > 0) {
			opts?.onToast?.(`${action.label}: ${succeeded} succeeded, ${failed} failed`, { type: "error" });
		} else if (succeeded > 0) {
			opts?.onToast?.(`${action.label}: ${succeeded} entries completed`, { type: "success" });
		}

		setTimeout(() => {
			setBulkStates((prev) => {
				const next = new Map(prev);
				next.delete(action.id);
				return next;
			});
		}, 5000);
	}, [setState]);

	return { getState, setState, executeBulkAction, bulkStates };
}
