"use client";

import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react";

type ToastType = "success" | "error" | "info";

type Toast = {
	id: number;
	message: string;
	type: ToastType;
	duration: number;
	dismissing?: boolean;
};

type ShowToastFn = (message: string, opts?: { type?: ToastType; duration?: number }) => void;

const ToastContext = createContext<ShowToastFn>(() => {});

export function useToast(): ShowToastFn {
	return useContext(ToastContext);
}

const MAX_VISIBLE = 5;

const TYPE_STYLES: Record<ToastType, { bg: string; border: string; icon: ReactNode; color: string }> = {
	success: {
		bg: "rgba(34, 197, 94, 0.08)",
		border: "1px solid rgba(34, 197, 94, 0.25)",
		color: "#22c55e",
		icon: (
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
				<polyline points="20 6 9 17 4 12" />
			</svg>
		),
	},
	error: {
		bg: "rgba(220, 38, 38, 0.08)",
		border: "1px solid rgba(220, 38, 38, 0.25)",
		color: "#dc2626",
		icon: (
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
				<circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
			</svg>
		),
	},
	info: {
		bg: "rgba(59, 130, 246, 0.08)",
		border: "1px solid rgba(59, 130, 246, 0.2)",
		color: "#3b82f6",
		icon: (
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
				<circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
			</svg>
		),
	},
};

export function ToastProvider({ children }: { children: ReactNode }) {
	const [toasts, setToasts] = useState<Toast[]>([]);
	const idRef = useRef(0);
	const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

	const dismiss = useCallback((id: number) => {
		setToasts((prev) => prev.map((t) => t.id === id ? { ...t, dismissing: true } : t));
		setTimeout(() => {
			setToasts((prev) => prev.filter((t) => t.id !== id));
		}, 200);
		const timer = timersRef.current.get(id);
		if (timer) { clearTimeout(timer); timersRef.current.delete(id); }
	}, []);

	const showToast: ShowToastFn = useCallback((message, opts) => {
		const type = opts?.type ?? "info";
		const duration = opts?.duration ?? (type === "error" ? 6000 : 4000);
		const id = ++idRef.current;

		setToasts((prev) => {
			const next = [...prev, { id, message, type, duration }];
			return next.length > MAX_VISIBLE ? next.slice(-MAX_VISIBLE) : next;
		});

		const timer = setTimeout(() => {
			dismiss(id);
			timersRef.current.delete(id);
		}, duration);
		timersRef.current.set(id, timer);
	}, [dismiss]);

	return (
		<ToastContext.Provider value={showToast}>
			{children}
			{toasts.length > 0 && (
				<div className="fixed bottom-4 right-4 z-[9998] flex flex-col-reverse gap-2 pointer-events-none" style={{ maxWidth: 380 }}>
					{toasts.map((toast) => {
						const style = TYPE_STYLES[toast.type];
						return (
							<div
								key={toast.id}
								className={`pointer-events-auto flex items-start gap-2.5 px-3.5 py-2.5 rounded-lg shadow-lg transition-all duration-200 ${toast.dismissing ? "opacity-0 translate-x-4" : "opacity-100 translate-x-0"}`}
								style={{
									background: "var(--color-surface)",
									border: style.border,
									backdropFilter: "blur(12px)",
								}}
							>
								<span className="flex-shrink-0 mt-0.5">{style.icon}</span>
								<p className="text-xs leading-relaxed flex-1 min-w-0 break-words" style={{ color: "var(--color-text)" }}>
									{toast.message}
								</p>
								<button
									type="button"
									onClick={() => dismiss(toast.id)}
									className="flex-shrink-0 p-0.5 rounded hover:opacity-60 transition-opacity"
									style={{ color: "var(--color-text-muted)" }}
								>
									<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
										<line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
									</svg>
								</button>
							</div>
						);
					})}
				</div>
			)}
		</ToastContext.Provider>
	);
}
