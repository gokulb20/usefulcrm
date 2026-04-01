import { describe, expect, it } from "vitest";
import { resolveRuntime, buildEnv, type ActionContext } from "./action-runner";

describe("resolveRuntime", () => {
	it("selects node for .js files (auto-detect by extension)", () => {
		const result = resolveRuntime("/path/to/script.js");
		expect(result).toEqual({ command: "node", args: ["/path/to/script.js"] });
	});

	it("selects node for .mjs and .cjs modules", () => {
		expect(resolveRuntime("/script.mjs").command).toBe("node");
		expect(resolveRuntime("/script.cjs").command).toBe("node");
	});

	it("selects npx tsx for .ts files (TypeScript needs transpilation)", () => {
		const result = resolveRuntime("/path/to/script.ts");
		expect(result).toEqual({ command: "npx", args: ["tsx", "/path/to/script.ts"] });
	});

	it("selects python3 for .py files", () => {
		const result = resolveRuntime("/path/to/script.py");
		expect(result).toEqual({ command: "python3", args: ["/path/to/script.py"] });
	});

	it("selects bash for .sh files", () => {
		const result = resolveRuntime("/path/to/script.sh");
		expect(result).toEqual({ command: "bash", args: ["/path/to/script.sh"] });
	});

	it("selects ruby for .rb files", () => {
		const result = resolveRuntime("/path/to/script.rb");
		expect(result).toEqual({ command: "ruby", args: ["/path/to/script.rb"] });
	});

	it("treats unknown extensions as direct executables (falls through to exec)", () => {
		const result = resolveRuntime("/path/to/my-binary");
		expect(result).toEqual({ command: "/path/to/my-binary", args: [] });
	});

	it("handles uppercase extensions via case-insensitive matching", () => {
		const result = resolveRuntime("/path/to/script.PY");
		expect(result).toEqual({ command: "python3", args: ["/path/to/script.PY"] });
	});

	it("uses explicit runtime over extension when specified (prevents wrong runtime)", () => {
		const result = resolveRuntime("/path/to/script.js", "python");
		expect(result).toEqual({ command: "python3", args: ["/path/to/script.js"] });
	});

	it("ignores explicit runtime 'auto' and falls back to extension detection", () => {
		const result = resolveRuntime("/path/to/script.py", "auto");
		expect(result).toEqual({ command: "python3", args: ["/path/to/script.py"] });
	});

	it("uses unknown explicit runtime as-is when not in known map", () => {
		const result = resolveRuntime("/script.txt", "deno");
		expect(result).toEqual({ command: "deno", args: ["/script.txt"] });
	});
});

describe("buildEnv", () => {
	const ctx: ActionContext = {
		entryId: "entry-123",
		entryData: { Name: "Test", Status: "Active" },
		objectName: "contacts",
		objectId: "obj-456",
		actionId: "send-email",
		fieldId: "field-789",
		workspacePath: "/workspace",
		dbPath: "/workspace/.useful/data.duckdb",
		apiUrl: "http://localhost:3100",
	};

	it("sets all DENCH_* environment variables from context", () => {
		const env = buildEnv(ctx);
		expect(env.DENCH_ENTRY_ID).toBe("entry-123");
		expect(env.DENCH_OBJECT_NAME).toBe("contacts");
		expect(env.DENCH_OBJECT_ID).toBe("obj-456");
		expect(env.DENCH_ACTION_ID).toBe("send-email");
		expect(env.DENCH_FIELD_ID).toBe("field-789");
		expect(env.DENCH_WORKSPACE_PATH).toBe("/workspace");
		expect(env.DENCH_DB_PATH).toBe("/workspace/.useful/data.duckdb");
		expect(env.DENCH_API_URL).toBe("http://localhost:3100");
	});

	it("serializes entryData as JSON (scripts parse env vars)", () => {
		const env = buildEnv(ctx);
		expect(env.DENCH_ENTRY_DATA).toBe(JSON.stringify({ Name: "Test", Status: "Active" }));
		expect(JSON.parse(env.DENCH_ENTRY_DATA!)).toEqual({ Name: "Test", Status: "Active" });
	});

	it("preserves existing process.env variables (inherits parent environment)", () => {
		const env = buildEnv(ctx);
		expect(env.PATH).toBe(process.env.PATH);
	});

	it("handles empty entryData without crashing", () => {
		const env = buildEnv({ ...ctx, entryData: {} });
		expect(env.DENCH_ENTRY_DATA).toBe("{}");
	});
});
