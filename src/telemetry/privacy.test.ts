import { describe, it, expect } from "vitest";
import { stripSecrets, redactMessages, sanitizeForCapture, redactMessagesStructured, redactOutputChoicesStructured, sanitizeMessages, sanitizeOutputChoices } from "../../extensions/posthog-analytics/lib/privacy.js";

// ---------------------------------------------------------------------------
// stripSecrets — security-critical: prevents credential leakage
// ---------------------------------------------------------------------------

describe("stripSecrets", () => {
  it("redacts OpenAI API keys embedded in prose (prevents key leakage in tool output)", () => {
    const input = "The key is sk-abcdefghijklmnopqrstuvwxyz1234567890 and it works";
    const result = stripSecrets(input) as string;
    expect(result).not.toContain("sk-");
    expect(result).toContain("[REDACTED]");
    expect(result).toContain("The key is");
  });

  it("redacts GitHub personal access tokens (prevents PAT leakage)", () => {
    const result = stripSecrets("ghp_abcdefghijklmnopqrstuvwxyz1234567890") as string;
    expect(result).toBe("[REDACTED]");
  });

  it("redacts Slack bot tokens (prevents Slack credential leakage)", () => {
    const result = stripSecrets("token: xoxb-123-456-abcdef") as string;
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("xoxb-");
  });

  it("redacts AWS access key IDs (prevents cloud credential leakage)", () => {
    const result = stripSecrets("AKIAIOSFODNN7EXAMPLE") as string;
    expect(result).toBe("[REDACTED]");
  });

  it("redacts JWT-like tokens (prevents session token leakage)", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0";
    const result = stripSecrets(`Bearer ${jwt}`) as string;
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("eyJ");
  });

  it("redacts object properties named key/token/secret/password/credential (prevents structured credential leakage)", () => {
    const input = {
      apiKey: "super-secret-key",
      token: "also-secret",
      secretValue: "hidden",
      password: "pass123",
      credential: "cred-data",
      name: "safe-value",
      count: 42,
    };
    const result = stripSecrets(input) as Record<string, unknown>;
    expect(result.apiKey).toBe("[REDACTED]");
    expect(result.token).toBe("[REDACTED]");
    expect(result.secretValue).toBe("[REDACTED]");
    expect(result.password).toBe("[REDACTED]");
    expect(result.credential).toBe("[REDACTED]");
    expect(result.name).toBe("safe-value");
    expect(result.count).toBe(42);
  });

  it("redacts deeply nested credentials (prevents credential leakage in complex tool params)", () => {
    const input = {
      config: {
        auth: { secretKey: "hidden", endpoint: "https://api.example.com" },
        retries: 3,
      },
    };
    const result = stripSecrets(input) as any;
    expect(result.config.auth.secretKey).toBe("[REDACTED]");
    expect(result.config.auth.endpoint).toBe("https://api.example.com");
    expect(result.config.retries).toBe(3);
  });

  it("handles arrays with mixed content types (prevents partial credential leakage)", () => {
    const input = ["normal-text", "sk-abcdefghijklmnopqrstuvwxyz1234567890", 42, null];
    const result = stripSecrets(input) as unknown[];
    expect(result[0]).toBe("normal-text");
    expect(result[1]).toContain("[REDACTED]");
    expect(result[2]).toBe(42);
    expect(result[3]).toBe(null);
  });

  it("handles case-insensitive property matching for credential keys (prevents evasion via casing)", () => {
    const input = { API_KEY: "secret", Token: "also-secret", SECRET: "hidden" };
    const result = stripSecrets(input) as Record<string, unknown>;
    expect(result.API_KEY).toBe("[REDACTED]");
    expect(result.Token).toBe("[REDACTED]");
    expect(result.SECRET).toBe("[REDACTED]");
  });

  it("does not false-positive on safe strings that happen to contain 'key' (prevents over-redaction in content)", () => {
    const result = stripSecrets("The keyboard key was stuck") as string;
    expect(result).toBe("The keyboard key was stuck");
  });

  it("passes through primitives unchanged (no crash on non-string, non-object inputs)", () => {
    expect(stripSecrets(42)).toBe(42);
    expect(stripSecrets(null)).toBe(null);
    expect(stripSecrets(true)).toBe(true);
    expect(stripSecrets(undefined)).toBe(undefined);
  });

  it("handles empty containers (no crash on edge input shapes)", () => {
    expect(stripSecrets("")).toBe("");
    expect(stripSecrets([])).toEqual([]);
    expect(stripSecrets({})).toEqual({});
  });

  it("handles multiple credentials in a single string (prevents partial redaction)", () => {
    const input = "keys: sk-aaaabbbbccccddddeeeeffffgggg1234 and ghp_abcdefghijklmnopqrstuvwxyz1234567890";
    const result = stripSecrets(input) as string;
    expect(result).not.toContain("sk-");
    expect(result).not.toContain("ghp_");
    expect((result.match(/\[REDACTED\]/g) ?? []).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// redactMessages — privacy control: prevents message content leakage
// ---------------------------------------------------------------------------

describe("redactMessages", () => {
  it("preserves role but replaces content with [REDACTED] (enforces privacy mode for LLM inputs)", () => {
    const messages = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "What is the secret project codenamed?" },
      { role: "assistant", content: "I don't have that information." },
    ];
    const result = redactMessages(messages) as Array<Record<string, unknown>>;
    expect(result).toHaveLength(3);
    for (const msg of result) {
      expect(msg.content).toBe("[REDACTED]");
    }
    expect(result[0].role).toBe("system");
    expect(result[1].role).toBe("user");
    expect(result[2].role).toBe("assistant");
  });

  it("preserves tool metadata fields while redacting content (keeps trace linkage intact)", () => {
    const messages = [
      { role: "tool", name: "web_search", tool_call_id: "call_abc123", content: "search results..." },
    ];
    const result = redactMessages(messages) as Array<Record<string, unknown>>;
    expect(result[0].name).toBe("web_search");
    expect(result[0].tool_call_id).toBe("call_abc123");
    expect(result[0].content).toBe("[REDACTED]");
    expect(Object.keys(result[0])).not.toContain("extra_field");
  });

  it("does not include unrecognized fields from input messages (prevents accidental data leakage)", () => {
    const messages = [
      { role: "user", content: "Hello", customData: "should-not-appear", internal_id: "xyz" },
    ];
    const result = redactMessages(messages) as Array<Record<string, unknown>>;
    expect(result[0]).not.toHaveProperty("customData");
    expect(result[0]).not.toHaveProperty("internal_id");
  });

  it("handles empty message arrays (no crash on empty conversation)", () => {
    expect(redactMessages([])).toEqual([]);
  });

  it("returns non-array input unchanged (defensive: unexpected input shape)", () => {
    expect(redactMessages("hello")).toBe("hello");
    expect(redactMessages(null)).toBe(null);
    expect(redactMessages(42)).toBe(42);
  });

  it("handles messages without content field (defensive: partial message objects)", () => {
    const messages = [{ role: "user" }];
    const result = redactMessages(messages) as Array<Record<string, unknown>>;
    expect(result[0].role).toBe("user");
    expect(result[0].content).toBe("[REDACTED]");
  });
});

// ---------------------------------------------------------------------------
// sanitizeForCapture — decision gate: privacy mode vs. open mode
// ---------------------------------------------------------------------------

describe("sanitizeForCapture", () => {
  it("returns [REDACTED] for any input when privacy mode is on (enforces privacy boundary)", () => {
    expect(sanitizeForCapture("sensitive data", true)).toBe("[REDACTED]");
    expect(sanitizeForCapture({ nested: { deep: "value" } }, true)).toBe("[REDACTED]");
    expect(sanitizeForCapture([1, 2, 3], true)).toBe("[REDACTED]");
    expect(sanitizeForCapture(null, true)).toBe("[REDACTED]");
  });

  it("preserves content when privacy mode is off (allows opt-in full capture)", () => {
    expect(sanitizeForCapture("safe content", false)).toBe("safe content");
    expect(sanitizeForCapture(42, false)).toBe(42);
  });

  it("still strips credential patterns even with privacy off (credentials are never captured regardless of mode)", () => {
    const result = sanitizeForCapture(
      "key: sk-abcdefghijklmnopqrstuvwxyz1234567890",
      false,
    ) as string;
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("sk-");
  });

  it("strips credential property names even with privacy off (structured credentials never leak)", () => {
    const result = sanitizeForCapture(
      { apiKey: "secret", data: "visible" },
      false,
    ) as Record<string, unknown>;
    expect(result.apiKey).toBe("[REDACTED]");
    expect(result.data).toBe("visible");
  });
});

// ---------------------------------------------------------------------------
// redactMessagesStructured — preserves message/tool structure in privacy mode
// ---------------------------------------------------------------------------

describe("redactMessagesStructured", () => {
  it("preserves role and ordering while redacting text content (enables PostHog conversation view)", () => {
    const messages = [
      { role: "user", content: "secret question" },
      { role: "assistant", content: "secret answer" },
      { role: "user", content: "follow-up" },
    ];
    const result = redactMessagesStructured(messages) as Array<Record<string, unknown>>;
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ role: "user", content: "[REDACTED]" });
    expect(result[1]).toEqual({ role: "assistant", content: "[REDACTED]" });
    expect(result[2]).toEqual({ role: "user", content: "[REDACTED]" });
  });

  it("preserves tool_calls[].function.name while redacting arguments (tool type visible in privacy mode)", () => {
    const messages = [
      {
        role: "assistant",
        content: "Let me run that.",
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "exec", arguments: '{"cmd":"ls -la"}' } },
          { id: "call_2", type: "function", function: { name: "read", arguments: '{"path":"/etc/passwd"}' } },
        ],
      },
    ];
    const result = redactMessagesStructured(messages) as Array<Record<string, unknown>>;
    expect(result[0].role).toBe("assistant");
    expect(result[0].content).toBe("[REDACTED]");
    const tc = result[0].tool_calls as Array<Record<string, unknown>>;
    expect(tc).toHaveLength(2);
    expect((tc[0] as any).function.name).toBe("exec");
    expect((tc[0] as any).function.arguments).toBe("[REDACTED]");
    expect((tc[1] as any).function.name).toBe("read");
  });

  it("preserves Anthropic toolCall content blocks with name visible (type visible regardless of privacy)", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Running command..." },
          { type: "toolCall", id: "tc1", name: "exec", arguments: { command: "ls" } },
        ],
      },
    ];
    const result = redactMessagesStructured(messages) as Array<Record<string, unknown>>;
    const blocks = result[0].content as Array<Record<string, unknown>>;
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ type: "text", text: "[REDACTED]" });
    expect(blocks[1].type).toBe("toolCall");
    expect(blocks[1].name).toBe("exec");
    expect(blocks[1].arguments).toBe("[REDACTED]");
  });

  it("preserves tool result metadata (name, tool_call_id) while redacting content", () => {
    const messages = [
      { role: "tool", name: "exec", tool_call_id: "call_1", content: "file1.txt\nfile2.txt" },
    ];
    const result = redactMessagesStructured(messages) as Array<Record<string, unknown>>;
    expect(result[0].role).toBe("tool");
    expect(result[0].name).toBe("exec");
    expect(result[0].tool_call_id).toBe("call_1");
    expect(result[0].content).toBe("[REDACTED]");
  });

  it("preserves model and provider metadata on assistant messages", () => {
    const messages = [
      { role: "assistant", content: "hello", model: "claude-4", provider: "anthropic" },
    ];
    const result = redactMessagesStructured(messages) as Array<Record<string, unknown>>;
    expect(result[0].model).toBe("claude-4");
    expect(result[0].provider).toBe("anthropic");
    expect(result[0].content).toBe("[REDACTED]");
  });

  it("returns non-array input unchanged", () => {
    expect(redactMessagesStructured(null)).toBe(null);
    expect(redactMessagesStructured("string")).toBe("string");
  });
});

describe("redactOutputChoicesStructured", () => {
  it("preserves tool_calls[].function.name while redacting text and arguments", () => {
    const choices = [
      {
        role: "assistant",
        content: "Here you go",
        tool_calls: [{ id: "c1", type: "function", function: { name: "web_search", arguments: '{"q":"test"}' } }],
      },
    ];
    const result = redactOutputChoicesStructured(choices) as Array<Record<string, unknown>>;
    expect(result[0].content).toBe("[REDACTED]");
    const tc = result[0].tool_calls as Array<Record<string, unknown>>;
    expect((tc[0] as any).function.name).toBe("web_search");
    expect((tc[0] as any).function.arguments).toBe("[REDACTED]");
  });

  it("sets content to null when original content is null (no-text tool-only responses)", () => {
    const choices = [
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "exec" } }] },
    ];
    const result = redactOutputChoicesStructured(choices) as Array<Record<string, unknown>>;
    expect(result[0].content).toBe(null);
  });
});

describe("sanitizeMessages", () => {
  it("uses structural redaction when privacy is on (preserves role/tool structure)", () => {
    const messages = [
      { role: "user", content: "secret" },
      { role: "assistant", content: "response", tool_calls: [{ id: "c", type: "function", function: { name: "exec", arguments: "{}" } }] },
    ];
    const result = sanitizeMessages(messages, true) as Array<Record<string, unknown>>;
    expect(result[0].role).toBe("user");
    expect(result[0].content).toBe("[REDACTED]");
    expect(result[1].role).toBe("assistant");
    const tc = result[1].tool_calls as any[];
    expect(tc[0].function.name).toBe("exec");
  });

  it("uses secret stripping when privacy is off (preserves full content)", () => {
    const messages = [{ role: "user", content: "hello" }];
    const result = sanitizeMessages(messages, false) as Array<Record<string, unknown>>;
    expect(result[0].content).toBe("hello");
  });
});
