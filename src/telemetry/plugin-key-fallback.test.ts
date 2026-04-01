import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCapture = vi.fn();
const mockCreatePostHogClient = vi.fn(() => ({
  capture: mockCapture,
  shutdown: vi.fn(),
}));
const mockShutdownPostHogClient = vi.fn();

vi.mock("../../extensions/posthog-analytics/lib/posthog-client.js", () => ({
  createPostHogClient: mockCreatePostHogClient,
  shutdownPostHogClient: mockShutdownPostHogClient,
}));

vi.mock("../../extensions/posthog-analytics/lib/privacy.js", () => ({
  readPrivacyMode: () => true,
  readOrCreateAnonymousId: () => "test-anon-id",
  sanitizeMessages: (v: unknown) => v,
  sanitizeOutputChoices: (v: unknown) => v,
  stripSecrets: (v: unknown) => v,
}));

function createMockApi(pluginConfig?: Record<string, unknown>) {
  const handlers: Record<string, Function> = {};
  return {
    config: pluginConfig
      ? { plugins: { entries: { "posthog-analytics": { config: pluginConfig } } } }
      : {},
    on: vi.fn((event: string, handler: Function) => {
      handlers[event] = handler;
    }),
    registerService: vi.fn(),
    logger: { info: vi.fn() },
  };
}

describe("posthog-analytics plugin key fallback", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreatePostHogClient.mockClear();
    mockCapture.mockClear();
  });

  it("uses api.config.apiKey when provided", async () => {
    vi.doMock("../../extensions/posthog-analytics/lib/build-env.js", () => ({
      POSTHOG_KEY: "built-in-key",
      DENCHCLAW_VERSION: "",
      OPENCLAW_VERSION: "",
    }));

    const { default: register } = await import(
      "../../extensions/posthog-analytics/index.js"
    );
    const api = createMockApi({ apiKey: "config-key", enabled: true });
    register(api);

    expect(mockCreatePostHogClient).toHaveBeenCalledWith(
      "config-key",
      undefined,
      expect.any(Object),
    );
  });

  it("falls back to built-in key when api.config has no apiKey", async () => {
    vi.doMock("../../extensions/posthog-analytics/lib/build-env.js", () => ({
      POSTHOG_KEY: "built-in-key",
      DENCHCLAW_VERSION: "",
      OPENCLAW_VERSION: "",
    }));

    const { default: register } = await import(
      "../../extensions/posthog-analytics/index.js"
    );
    const api = createMockApi();
    register(api);

    expect(mockCreatePostHogClient).toHaveBeenCalledWith(
      "built-in-key",
      undefined,
      expect.any(Object),
    );
  });

  it("does not initialize when neither config nor built-in key is available", async () => {
    vi.doMock("../../extensions/posthog-analytics/lib/build-env.js", () => ({
      POSTHOG_KEY: "",
      DENCHCLAW_VERSION: "",
      OPENCLAW_VERSION: "",
    }));

    const { default: register } = await import(
      "../../extensions/posthog-analytics/index.js"
    );
    const api = createMockApi();
    register(api);

    expect(mockCreatePostHogClient).not.toHaveBeenCalled();
    expect(api.registerService).not.toHaveBeenCalled();
  });

  it("registers lifecycle hooks when built-in key is used", async () => {
    vi.doMock("../../extensions/posthog-analytics/lib/build-env.js", () => ({
      POSTHOG_KEY: "built-in-key",
      DENCHCLAW_VERSION: "",
      OPENCLAW_VERSION: "",
    }));

    const { default: register } = await import(
      "../../extensions/posthog-analytics/index.js"
    );
    const api = createMockApi();
    register(api);

    expect(api.on).toHaveBeenCalled();
    expect(api.registerService).toHaveBeenCalledWith(
      expect.objectContaining({ id: "posthog-analytics" }),
    );
  });
});
