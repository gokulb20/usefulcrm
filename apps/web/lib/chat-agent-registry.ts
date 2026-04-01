/**
 * Chat-agent registry: assigns web chat sessions to pre-created agent
 * pool slots so concurrent chats each get their own gateway agent.
 *
 * Architecture:
 * - Each workspace has one durable "workspace agent" (e.g. "kumareth").
 * - A pool of chat agent slots (e.g. "chat-slot-kumareth-1" through "-5")
 *   is pre-created in hermes.json at workspace init time.
 * - Each new web chat session is assigned an available slot from the pool.
 * - When a slot is released (chat completes or is deleted), it becomes
 *   available for the next session.
 * - If all slots are occupied, falls back to the workspace agent.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolveHermesStateDir, resolveActiveAgentId, getChatSlotAgentIds } from "./workspace";

const DEFAULT_IDLE_TTL_MS = 30 * 60_000;

export type ChatAgentState = "active" | "idle" | "expired" | "deleted";

export type ChatAgentEntry = {
	chatAgentId: string;
	workspaceAgentId: string;
	sessionId: string;
	workspaceDir: string;
	state: ChatAgentState;
	createdAt: number;
	lastActiveAt: number;
	idleTtlMs: number;
};

type ChatAgentRegistryData = {
	version: number;
	agents: Record<string, ChatAgentEntry>;
};

function registryPath(): string {
	return join(resolveHermesStateDir(), "chat-agents.json");
}

function readRegistry(): ChatAgentRegistryData {
	const fp = registryPath();
	if (!existsSync(fp)) {
		return { version: 1, agents: {} };
	}
	try {
		return JSON.parse(readFileSync(fp, "utf-8")) as ChatAgentRegistryData;
	} catch {
		return { version: 1, agents: {} };
	}
}

function writeRegistry(data: ChatAgentRegistryData): void {
	const fp = registryPath();
	const dir = join(fp, "..");
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	writeFileSync(fp, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/**
 * Assign a web chat session to an available pool slot agent.
 * Does NOT write to hermes.json -- slots are pre-created at workspace init.
 * Falls back to the workspace agent if no slots are available.
 */
export function allocateChatAgent(
	sessionId: string,
	options?: { idleTtlMs?: number },
): ChatAgentEntry {
	const registry = readRegistry();

	const existing = registry.agents[sessionId];
	if (existing && existing.state !== "expired" && existing.state !== "deleted") {
		existing.lastActiveAt = Date.now();
		existing.state = "active";
		writeRegistry(registry);
		return existing;
	}

	const workspaceAgentId = resolveActiveAgentId();
	const now = Date.now();

	// Find available pool slots (not assigned to an active/idle session)
	const allSlots = getChatSlotAgentIds();
	const occupiedSlots = new Set(
		Object.values(registry.agents)
			.filter((e) => e.state === "active" || e.state === "idle")
			.map((e) => e.chatAgentId),
	);
	const availableSlot = allSlots.find((s) => !occupiedSlots.has(s));
	const chatAgentId = availableSlot ?? workspaceAgentId;

	const entry: ChatAgentEntry = {
		chatAgentId,
		workspaceAgentId,
		sessionId,
		workspaceDir: "",
		state: "active",
		createdAt: now,
		lastActiveAt: now,
		idleTtlMs: options?.idleTtlMs ?? DEFAULT_IDLE_TTL_MS,
	};

	registry.agents[sessionId] = entry;
	writeRegistry(registry);

	return entry;
}

/** Look up a chat agent entry by session ID. */
export function getChatAgent(sessionId: string): ChatAgentEntry | undefined {
	const registry = readRegistry();
	return registry.agents[sessionId];
}

/** Touch the lastActiveAt timestamp for a chat agent. */
export function touchChatAgent(sessionId: string): void {
	const registry = readRegistry();
	const entry = registry.agents[sessionId];
	if (!entry) {return;}
	entry.lastActiveAt = Date.now();
	if (entry.state === "idle") {
		entry.state = "active";
	}
	writeRegistry(registry);
}

/** Mark a chat agent as idle. */
export function markChatAgentIdle(sessionId: string): void {
	const registry = readRegistry();
	const entry = registry.agents[sessionId];
	if (!entry || entry.state === "expired" || entry.state === "deleted") {return;}
	entry.state = "idle";
	writeRegistry(registry);
}

/** Release a chat agent slot back to the pool. */
export function deleteChatAgent(sessionId: string): void {
	const registry = readRegistry();
	const entry = registry.agents[sessionId];
	if (!entry) {return;}
	entry.state = "deleted";
	writeRegistry(registry);
}

/**
 * Expire chat agents that have been idle longer than their TTL.
 * Returns the list of expired session IDs.
 */
export function expireIdleChatAgents(): string[] {
	const registry = readRegistry();
	const now = Date.now();
	const expired: string[] = [];

	for (const [sessionId, entry] of Object.entries(registry.agents)) {
		if (entry.state === "expired" || entry.state === "deleted") {continue;}
		const idleSince = now - entry.lastActiveAt;
		if (idleSince > entry.idleTtlMs) {
			entry.state = "expired";
			expired.push(sessionId);
		}
	}

	if (expired.length > 0) {
		writeRegistry(registry);
	}

	return expired;
}

/**
 * Try to resume an expired chat agent by re-allocating it.
 * Returns the new entry, or undefined if the session has no prior agent.
 */
export function resumeExpiredChatAgent(
	sessionId: string,
	options?: { idleTtlMs?: number },
): ChatAgentEntry | undefined {
	const registry = readRegistry();
	const existing = registry.agents[sessionId];
	if (!existing) {return undefined;}
	if (existing.state !== "expired") {return existing;}

	return allocateChatAgent(sessionId, {
		idleTtlMs: options?.idleTtlMs ?? existing.idleTtlMs,
	});
}

/** List all chat agent entries (for diagnostics). */
export function listChatAgents(): ChatAgentEntry[] {
	const registry = readRegistry();
	return Object.values(registry.agents);
}

/** Clean up deleted entries from the registry. */
export function purgeChatAgentRegistry(): number {
	const registry = readRegistry();
	let count = 0;
	for (const [sessionId, entry] of Object.entries(registry.agents)) {
		if (entry.state === "deleted") {
			delete registry.agents[sessionId];
			count++;
		}
	}
	if (count > 0) {
		writeRegistry(registry);
	}
	return count;
}

// ── Periodic GC ──

const GC_INTERVAL_MS = 5 * 60_000;
let gcTimer: ReturnType<typeof setInterval> | null = null;

/** Start the background idle-GC interval (idempotent). */
export function startChatAgentGc(): void {
	if (gcTimer) {return;}
	gcTimer = setInterval(() => {
		try {
			expireIdleChatAgents();
			purgeChatAgentRegistry();
		} catch {
			// Best-effort background cleanup
		}
	}, GC_INTERVAL_MS);
	if (typeof gcTimer === "object" && "unref" in gcTimer) {
		gcTimer.unref();
	}
}

/** Stop the background GC interval. */
export function stopChatAgentGc(): void {
	if (gcTimer) {
		clearInterval(gcTimer);
		gcTimer = null;
	}
}

/**
 * Ensure a chat agent is valid for sending a message.
 * If the agent expired, re-allocate it transparently.
 * Returns the effective agent ID to use.
 */
export function ensureChatAgentForSend(sessionId: string): string | undefined {
	const entry = getChatAgent(sessionId);
	if (!entry) {return undefined;}
	if (entry.state === "deleted") {return undefined;}
	if (entry.state === "expired") {
		const resumed = resumeExpiredChatAgent(sessionId);
		return resumed?.chatAgentId;
	}
	touchChatAgent(sessionId);
	return entry.chatAgentId;
}

export { DEFAULT_IDLE_TTL_MS, GC_INTERVAL_MS };
