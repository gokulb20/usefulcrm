/**
 * Server-side action script runner.
 *
 * Spawns child processes for action scripts in any language (JS, Python, bash, etc.).
 * Scripts receive entry context via DENCH_* environment variables and communicate
 * results via NDJSON on stdout.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { join, extname } from "node:path";
import { existsSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline";

export type ActionConfig = {
	id: string;
	label: string;
	icon?: string;
	variant?: "default" | "primary" | "destructive" | "success" | "warning";
	script?: string;
	scriptPath?: string;
	runtime?: "auto" | "inline" | "node" | "python" | "bash" | "ruby";
	confirmMessage?: string;
	loadingLabel?: string;
	successLabel?: string;
	errorLabel?: string;
	autoResetMs?: number;
	timeout?: number;
};

export type ActionEvent =
	| { type: "started"; entryId: string; runId: string }
	| { type: "progress"; entryId: string; percent: number; message?: string }
	| { type: "log"; entryId: string; level: string; message: string }
	| { type: "completed"; entryId: string; status: "success" | "error"; result?: unknown; error?: string; exitCode?: number }
	| { type: "done" };

export type ActionContext = {
	entryId: string;
	entryData: Record<string, unknown>;
	objectName: string;
	objectId: string;
	actionId: string;
	fieldId: string;
	workspacePath: string;
	dbPath: string;
	apiUrl: string;
};

const RUNTIME_MAP: Record<string, { command: string; args: (file: string) => string[] }> = {
	".js": { command: "node", args: (f) => [f] },
	".mjs": { command: "node", args: (f) => [f] },
	".cjs": { command: "node", args: (f) => [f] },
	".ts": { command: "npx", args: (f) => ["tsx", f] },
	".py": { command: "python3", args: (f) => [f] },
	".sh": { command: "bash", args: (f) => [f] },
	".rb": { command: "ruby", args: (f) => [f] },
	".php": { command: "php", args: (f) => [f] },
};

export function resolveRuntime(
	scriptPath: string,
	explicitRuntime?: string,
): { command: string; args: string[] } {
	if (explicitRuntime && explicitRuntime !== "auto") {
		const runtimeCommands: Record<string, string> = {
			node: "node", python: "python3", bash: "bash", ruby: "ruby",
		};
		const cmd = runtimeCommands[explicitRuntime] ?? explicitRuntime;
		return { command: cmd, args: [scriptPath] };
	}

	const ext = extname(scriptPath).toLowerCase();
	const runtime = RUNTIME_MAP[ext];
	if (runtime) return { command: runtime.command, args: runtime.args(scriptPath) };

	return { command: scriptPath, args: [] };
}

export function buildEnv(ctx: ActionContext): NodeJS.ProcessEnv {
	return {
		...process.env,
		DENCH_ENTRY_ID: ctx.entryId,
		DENCH_ENTRY_DATA: JSON.stringify(ctx.entryData),
		DENCH_OBJECT_NAME: ctx.objectName,
		DENCH_OBJECT_ID: ctx.objectId,
		DENCH_ACTION_ID: ctx.actionId,
		DENCH_FIELD_ID: ctx.fieldId,
		DENCH_WORKSPACE_PATH: ctx.workspacePath,
		DENCH_DB_PATH: ctx.dbPath,
		DENCH_API_URL: ctx.apiUrl,
	};
}

function generateInlineWrapper(script: string, sdkRuntimePath: string): string {
	return `const useful = require(${JSON.stringify(sdkRuntimePath)})(process.env);
const context = {
  entryId: process.env.DENCH_ENTRY_ID,
  entryData: JSON.parse(process.env.DENCH_ENTRY_DATA || '{}'),
  objectName: process.env.DENCH_OBJECT_NAME,
  objectId: process.env.DENCH_OBJECT_ID,
  actionId: process.env.DENCH_ACTION_ID,
  fieldId: process.env.DENCH_FIELD_ID,
  workspacePath: process.env.DENCH_WORKSPACE_PATH,
  dbPath: process.env.DENCH_DB_PATH,
  apiUrl: process.env.DENCH_API_URL,
};
(async () => {
${script}
})().then(r => {
  if (r !== undefined) console.log(JSON.stringify({type:"result",status:"success",data:r}));
  else console.log(JSON.stringify({type:"result",status:"success",data:{}}));
}).catch(e => {
  console.log(JSON.stringify({type:"result",status:"error",data:{message:e.message||String(e)}}));
  process.exit(1);
});
`;
}

/**
 * Run an action script for a single entry. Yields ActionEvents as they arrive.
 */
export async function* runActionScript(
	action: ActionConfig,
	ctx: ActionContext,
	runId: string,
): AsyncGenerator<ActionEvent> {
	yield { type: "started", entryId: ctx.entryId, runId };

	const timeout = action.timeout ?? 60_000;
	const env = buildEnv(ctx);
	let child: ChildProcess;
	let tmpFile: string | null = null;

	try {
		if (action.script && (!action.scriptPath || action.runtime === "inline")) {
			const tmpDir = join(ctx.workspacePath, ".actions", ".tmp");
			if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
			tmpFile = join(tmpDir, `${runId}.js`);
			const sdkPath = join(__dirname, "action-sdk-runtime.js");
			writeFileSync(tmpFile, generateInlineWrapper(action.script, sdkPath));
			child = spawn("node", [tmpFile], { env, cwd: ctx.workspacePath, stdio: ["ignore", "pipe", "pipe"] });
		} else if (action.scriptPath) {
			const objectDir = join(ctx.workspacePath, ctx.objectName);
			const fullPath = join(objectDir, action.scriptPath);

			if (!existsSync(fullPath)) {
				yield { type: "completed", entryId: ctx.entryId, status: "error", error: `Script not found: ${action.scriptPath}` };
				return;
			}

			const { command, args } = resolveRuntime(fullPath, action.runtime);
			child = spawn(command, args, { env, cwd: objectDir, stdio: ["ignore", "pipe", "pipe"] });
		} else {
			yield { type: "completed", entryId: ctx.entryId, status: "error", error: "No script or scriptPath defined" };
			return;
		}
	} catch (err) {
		yield { type: "completed", entryId: ctx.entryId, status: "error", error: `Failed to spawn: ${err instanceof Error ? err.message : String(err)}` };
		if (tmpFile) try { unlinkSync(tmpFile); } catch { /* ignore */ }
		return;
	}

	const stdoutLines: string[] = [];
	const stderrChunks: string[] = [];
	let gotResult = false;

	const killTimer = setTimeout(() => {
		try { child.kill("SIGTERM"); } catch { /* ignore */ }
		setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* ignore */ } }, 5_000);
	}, timeout);

	const rl = createInterface({ input: child.stdout! });

	const eventQueue: ActionEvent[] = [];
	let resolveWait: (() => void) | null = null;
	let done = false;

	function pushEvent(ev: ActionEvent) {
		eventQueue.push(ev);
		if (resolveWait) { resolveWait(); resolveWait = null; }
	}

	rl.on("line", (line: string) => {
		stdoutLines.push(line);
		if (!line.trim()) return;
		try {
			const parsed = JSON.parse(line);
			if (parsed && typeof parsed === "object" && parsed.type) {
				if (parsed.type === "progress") {
					pushEvent({ type: "progress", entryId: ctx.entryId, percent: parsed.percent ?? 0, message: parsed.message });
				} else if (parsed.type === "log") {
					pushEvent({ type: "log", entryId: ctx.entryId, level: parsed.level ?? "info", message: parsed.message ?? "" });
				} else if (parsed.type === "result") {
					gotResult = true;
					pushEvent({
						type: "completed",
						entryId: ctx.entryId,
						status: parsed.status === "error" ? "error" : "success",
						result: parsed.data,
						error: parsed.status === "error" ? (parsed.data?.message ?? "Script error") : undefined,
					});
				}
				return;
			}
		} catch { /* not JSON, treat as log */ }
		pushEvent({ type: "log", entryId: ctx.entryId, level: "info", message: line });
	});

	child.stderr?.on("data", (chunk: Buffer) => {
		stderrChunks.push(chunk.toString());
	});

	child.on("close", (code) => {
		clearTimeout(killTimer);
		if (!gotResult) {
			const stderr = stderrChunks.join("").trim();
			pushEvent({
				type: "completed",
				entryId: ctx.entryId,
				status: code === 0 ? "success" : "error",
				result: code === 0 ? {} : undefined,
				error: code !== 0 ? (stderr || `Process exited with code ${code}`) : undefined,
				exitCode: code ?? undefined,
			});
		}
		done = true;
		if (resolveWait) { resolveWait(); resolveWait = null; }
	});

	child.on("error", (err) => {
		clearTimeout(killTimer);
		if (!gotResult) {
			pushEvent({
				type: "completed",
				entryId: ctx.entryId,
				status: "error",
				error: `Process error: ${err.message}`,
			});
		}
		done = true;
		if (resolveWait) { resolveWait(); resolveWait = null; }
	});

	try {
		while (!done || eventQueue.length > 0) {
			if (eventQueue.length === 0) {
				await new Promise<void>((resolve) => { resolveWait = resolve; });
			}
			while (eventQueue.length > 0) {
				yield eventQueue.shift()!;
			}
		}
	} finally {
		if (tmpFile) try { unlinkSync(tmpFile); } catch { /* ignore */ }
	}
}

const MAX_CONCURRENT = 8;

/**
 * Run an action on multiple entries in parallel (up to MAX_CONCURRENT).
 * Yields ActionEvents for each entry as they complete.
 */
export async function* runBulkAction(
	action: ActionConfig,
	contexts: ActionContext[],
	runIdPrefix: string,
): AsyncGenerator<ActionEvent> {
	let running = 0;
	let nextIdx = 0;
	const pendingGenerators: Array<{ gen: AsyncGenerator<ActionEvent>; promise: Promise<IteratorResult<ActionEvent>> | null }> = [];

	function startNext() {
		if (nextIdx >= contexts.length) return;
		const ctx = contexts[nextIdx];
		const runId = `${runIdPrefix}_${nextIdx}`;
		nextIdx++;
		running++;
		const gen = runActionScript(action, ctx, runId);
		const entry = { gen, promise: gen.next() };
		pendingGenerators.push(entry);
	}

	while (running < MAX_CONCURRENT && nextIdx < contexts.length) {
		startNext();
	}

	while (pendingGenerators.length > 0) {
		const results = await Promise.race(
			pendingGenerators.map(async (entry, idx) => {
				const result = await entry.promise!;
				return { idx, result };
			}),
		);

		const { idx, result } = results;
		const entry = pendingGenerators[idx];

		if (result.done) {
			pendingGenerators.splice(idx, 1);
			running--;
			startNext();
		} else {
			yield result.value;
			if (result.value.type === "completed") {
				pendingGenerators.splice(idx, 1);
				running--;
				startNext();
			} else {
				entry.promise = entry.gen.next();
			}
		}
	}

	yield { type: "done" };
}
