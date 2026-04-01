import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildUsefulCloudConfigPatch,
  fetchUsefulCloudCatalog,
  normalizeUsefulCloudCatalogResponse,
  readConfiguredUsefulCloudSettings,
  validateUsefulCloudApiKey,
} from "./useful-cloud.js";

function createJsonResponse(params?: {
  status?: number;
  payload?: unknown;
}): Response {
  const status = params?.status ?? 200;
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => params?.payload ?? {},
  } as unknown as Response;
}

describe("useful-cloud helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes the public gateway catalog into stable model records", () => {
    const models = normalizeUsefulCloudCatalogResponse({
      object: "list",
      data: [
        {
          id: "gpt-5.4",
          stableId: "gpt-5.4",
          name: "GPT-5.4",
          provider: "openai",
          transportProvider: "openai",
          input: ["text", "image"],
          contextWindow: 128000,
          maxTokens: 128000,
          supportsStreaming: true,
          supportsImages: true,
          supportsResponses: true,
          supportsReasoning: false,
          cost: {
            input: 3.375,
            output: 20.25,
            cacheRead: 0,
            cacheWrite: 0,
            marginPercent: 0.35,
          },
        },
      ],
    });

    expect(models).toEqual([
      expect.objectContaining({
        id: "gpt-5.4",
        stableId: "gpt-5.4",
        displayName: "GPT-5.4",
        contextWindow: 128000,
        maxTokens: 128000,
        cost: expect.objectContaining({
          input: 3.375,
          output: 20.25,
          marginPercent: 0.35,
        }),
      }),
    ]);
  });

  it("falls back to the bundled model list when the public catalog is unavailable", async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({ status: 503, payload: {} }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await fetchUsefulCloudCatalog("https://gateway.merseoriginals.com");
    expect(fetchMock).toHaveBeenCalledWith("https://gateway.merseoriginals.com/v1/public/models");
    expect(result.source).toBe("fallback");
    expect(result.models.map((model) => model.stableId)).toEqual([
      "anthropic.claude-opus-4-6-v1",
      "gpt-5.4",
      "anthropic.claude-sonnet-4-6-v1",
    ]);
  });

  it("rejects invalid Useful Cloud API keys with an actionable message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createJsonResponse({ status: 401, payload: {} })) as unknown as typeof fetch,
    );

    await expect(
      validateUsefulCloudApiKey("https://gateway.merseoriginals.com", "bad-key"),
    ).rejects.toThrow("Check your key at useful.com/settings");
  });

  it("builds the Useful Cloud config patch with provider models and agent aliases", () => {
    const patch = buildUsefulCloudConfigPatch({
      gatewayUrl: "https://gateway.merseoriginals.com",
      apiKey: "useful_live_key",
      models: [
        {
          id: "claude-opus-4.6",
          stableId: "anthropic.claude-opus-4-6-v1",
          displayName: "Claude Opus 4.6",
          provider: "anthropic",
          transportProvider: "bedrock",
          api: "openai-completions",
          input: ["text", "image"],
          reasoning: false,
          contextWindow: 200000,
          maxTokens: 64000,
          supportsStreaming: true,
          supportsImages: true,
          supportsResponses: true,
          supportsReasoning: false,
          cost: {
            input: 6.75,
            output: 33.75,
            cacheRead: 0,
            cacheWrite: 0,
            marginPercent: 0.35,
          },
        },
      ],
    });

    expect(patch.models.providers["useful-cloud"]).toEqual(
      expect.objectContaining({
        baseUrl: "https://gateway.merseoriginals.com/v1",
        apiKey: "useful_live_key",
        api: "openai-completions",
        models: [
          expect.objectContaining({
            id: "anthropic.claude-opus-4-6-v1",
            name: "Claude Opus 4.6 (Useful Cloud)",
          }),
        ],
      }),
    );
    expect(patch.agents.defaults.models["useful-cloud/anthropic.claude-opus-4-6-v1"]).toEqual(
      expect.objectContaining({
        alias: "Claude Opus 4.6 (Useful Cloud)",
      }),
    );
  });

  it("reads existing Useful Cloud gateway config from hermes.json", () => {
    const result = readConfiguredUsefulCloudSettings({
      models: {
        providers: {
          "useful-cloud": {
            baseUrl: "https://gateway.merseoriginals.com/v1",
            apiKey: "useful_cfg_key",
          },
        },
      },
      agents: {
        defaults: {
          model: {
            primary: "useful-cloud/anthropic.claude-opus-4-6-v1",
          },
        },
      },
    });

    expect(result).toEqual({
      gatewayUrl: "https://gateway.merseoriginals.com",
      apiKey: "useful_cfg_key",
      selectedModel: "anthropic.claude-opus-4-6-v1",
    });
  });
});
