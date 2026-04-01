import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockRandomUUID = vi.fn();

vi.mock("node:fs", () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
}));

vi.mock("node:crypto", () => ({
  randomUUID: mockRandomUUID,
}));

vi.mock("../config/paths.js", () => ({
  resolveStateDir: () => "/fake/state-dir",
}));

describe("getOrCreateAnonymousId", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
    mockMkdirSync.mockReset();
    mockRandomUUID.mockReset();
  });

  it("generates an install ID and persists it when telemetry.json has no anonymousId", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ enabled: true, privacyMode: true }));
    mockRandomUUID.mockReturnValue("new-install-id-1234");

    const { getOrCreateAnonymousId } = await import("./config.js");
    const id = getOrCreateAnonymousId();

    expect(id).toBe("new-install-id-1234");
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const written = JSON.parse(mockWriteFileSync.mock.calls[0][1]);
    expect(written.anonymousId).toBe("new-install-id-1234");
  });

  it("reuses the persisted install ID on subsequent reads", async () => {
    const persistedId = "persisted-uuid-5678";
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ enabled: true, anonymousId: persistedId }));

    const { getOrCreateAnonymousId } = await import("./config.js");
    const id = getOrCreateAnonymousId();

    expect(id).toBe(persistedId);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(mockRandomUUID).not.toHaveBeenCalled();
  });

  it("generates and persists an ID when telemetry.json does not exist", async () => {
    mockExistsSync.mockReturnValue(false);
    mockRandomUUID.mockReturnValue("fresh-install-id");

    const { getOrCreateAnonymousId } = await import("./config.js");
    const id = getOrCreateAnonymousId();

    expect(id).toBe("fresh-install-id");
    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining("state-dir"),
      { recursive: true },
    );
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const written = JSON.parse(mockWriteFileSync.mock.calls[0][1]);
    expect(written.anonymousId).toBe("fresh-install-id");
  });

  it("preserves existing enabled/privacyMode flags when adding the ID", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ enabled: false, privacyMode: false, noticeShown: true }),
    );
    mockRandomUUID.mockReturnValue("added-id");

    const { getOrCreateAnonymousId } = await import("./config.js");
    getOrCreateAnonymousId();

    const written = JSON.parse(mockWriteFileSync.mock.calls[0][1]);
    expect(written.enabled).toBe(false);
    expect(written.privacyMode).toBe(false);
    expect(written.noticeShown).toBe(true);
    expect(written.anonymousId).toBe("added-id");
  });

  it("returns a stable ID even when fs write fails", async () => {
    mockExistsSync.mockReturnValue(false);
    mockRandomUUID.mockReturnValue("fallback-id");
    mockMkdirSync.mockImplementation(() => {
      throw new Error("EACCES");
    });

    const { getOrCreateAnonymousId } = await import("./config.js");
    const id1 = getOrCreateAnonymousId();
    const id2 = getOrCreateAnonymousId();

    expect(id1).toBe("fallback-id");
    expect(id1).toBe(id2);
  });
});

describe("readTelemetryConfig", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
  });

  it("includes anonymousId when present in telemetry.json", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ enabled: true, anonymousId: "stored-id" }),
    );

    const { readTelemetryConfig } = await import("./config.js");
    const config = readTelemetryConfig();

    expect(config.anonymousId).toBe("stored-id");
  });

  it("returns undefined anonymousId when not present", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ enabled: true }));

    const { readTelemetryConfig } = await import("./config.js");
    const config = readTelemetryConfig();

    expect(config.anonymousId).toBeUndefined();
  });
});

describe("writeTelemetryConfig preserves anonymousId", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
    mockMkdirSync.mockReset();
  });

  it("does not lose anonymousId when writing unrelated config changes", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ enabled: true, anonymousId: "keep-me", privacyMode: true }),
    );

    const { writeTelemetryConfig } = await import("./config.js");
    writeTelemetryConfig({ enabled: false });

    const written = JSON.parse(mockWriteFileSync.mock.calls[0][1]);
    expect(written.anonymousId).toBe("keep-me");
    expect(written.enabled).toBe(false);
  });
});

describe("readPersonInfo", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
  });

  it("returns null when no identity fields are present", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ enabled: true, anonymousId: "some-id" }),
    );

    const { readPersonInfo } = await import("./config.js");
    expect(readPersonInfo()).toBeNull();
  });

  it("returns null when telemetry.json does not exist", async () => {
    mockExistsSync.mockReturnValue(false);

    const { readPersonInfo } = await import("./config.js");
    expect(readPersonInfo()).toBeNull();
  });

  it("returns person info when name is set", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ enabled: true, name: "Alice" }),
    );

    const { readPersonInfo } = await import("./config.js");
    const info = readPersonInfo();
    expect(info).toEqual({ name: "Alice" });
  });

  it("returns person info when email is set", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ enabled: true, email: "alice@example.com" }),
    );

    const { readPersonInfo } = await import("./config.js");
    const info = readPersonInfo();
    expect(info).toEqual({ email: "alice@example.com" });
  });

  it("returns all identity fields when present", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        enabled: true,
        name: "Alice",
        email: "alice@example.com",
        avatar: "https://example.com/avatar.png",
        usefulOrgId: "org-123",
      }),
    );

    const { readPersonInfo } = await import("./config.js");
    const info = readPersonInfo();
    expect(info).toEqual({
      name: "Alice",
      email: "alice@example.com",
      avatar: "https://example.com/avatar.png",
      usefulOrgId: "org-123",
    });
  });

  it("ignores empty string identity fields", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ enabled: true, name: "", email: "", usefulOrgId: "org-1" }),
    );

    const { readPersonInfo } = await import("./config.js");
    const info = readPersonInfo();
    expect(info).toEqual({ usefulOrgId: "org-1" });
  });

  it("ignores non-string identity fields", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ enabled: true, name: 42, email: true }),
    );

    const { readPersonInfo } = await import("./config.js");
    expect(readPersonInfo()).toBeNull();
  });
});

describe("readTelemetryConfig includes identity fields", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
  });

  it("parses name, email, avatar, and usefulOrgId from config", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        enabled: true,
        name: "Bob",
        email: "bob@test.com",
        avatar: "https://img.test/bob.jpg",
        usefulOrgId: "org-abc",
      }),
    );

    const { readTelemetryConfig } = await import("./config.js");
    const config = readTelemetryConfig();

    expect(config.name).toBe("Bob");
    expect(config.email).toBe("bob@test.com");
    expect(config.avatar).toBe("https://img.test/bob.jpg");
    expect(config.usefulOrgId).toBe("org-abc");
  });

  it("returns undefined for missing identity fields", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ enabled: true }));

    const { readTelemetryConfig } = await import("./config.js");
    const config = readTelemetryConfig();

    expect(config.name).toBeUndefined();
    expect(config.email).toBeUndefined();
    expect(config.avatar).toBeUndefined();
    expect(config.usefulOrgId).toBeUndefined();
  });
});

describe("writeTelemetryConfig preserves identity fields", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
    mockMkdirSync.mockReset();
  });

  it("does not lose identity fields when writing unrelated config changes", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        enabled: true,
        anonymousId: "id-1",
        name: "Alice",
        email: "alice@test.com",
        usefulOrgId: "org-x",
      }),
    );

    const { writeTelemetryConfig } = await import("./config.js");
    writeTelemetryConfig({ privacyMode: false });

    const written = JSON.parse(mockWriteFileSync.mock.calls[0][1]);
    expect(written.name).toBe("Alice");
    expect(written.email).toBe("alice@test.com");
    expect(written.usefulOrgId).toBe("org-x");
    expect(written.privacyMode).toBe(false);
  });
});
