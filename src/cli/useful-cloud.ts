export const DEFAULT_DENCH_CLOUD_GATEWAY_URL = "https://gateway.merseoriginals.com";
export const DEFAULT_DENCH_CLOUD_MARGIN_PERCENT = 0.35;

export type UsefulCloudCatalogCost = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  marginPercent?: number;
};

export type UsefulCloudCatalogModel = {
  id: string;
  stableId: string;
  displayName: string;
  provider: string;
  transportProvider: string;
  api: "openai-completions";
  input: Array<"text" | "image">;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  supportsStreaming: boolean;
  supportsImages: boolean;
  supportsResponses: boolean;
  supportsReasoning: boolean;
  cost: UsefulCloudCatalogCost;
};

export type UsefulCloudCatalogSource = "live" | "fallback";

export type UsefulCloudCatalogLoadResult = {
  models: UsefulCloudCatalogModel[];
  source: UsefulCloudCatalogSource;
  detail?: string;
};

type UnknownRecord = Record<string, unknown>;

function roundUsd(value: number): number {
  return Number(value.toFixed(8));
}

function markupCost(value: number): number {
  return roundUsd(value * (1 + DEFAULT_DENCH_CLOUD_MARGIN_PERCENT));
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" ? (value as UnknownRecord) : undefined;
}

function readString(input: UnknownRecord, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function readNumber(input: UnknownRecord, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function readBoolean(input: UnknownRecord, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
}

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeInputKinds(input: unknown, supportsImages: boolean): Array<"text" | "image"> {
  if (!Array.isArray(input)) {
    return supportsImages ? ["text", "image"] : ["text"];
  }

  const kinds = new Set<"text" | "image">();
  for (const value of input) {
    if (value === "text" || value === "image") {
      kinds.add(value);
    }
  }

  if (!kinds.has("text")) {
    kinds.add("text");
  }
  if (supportsImages) {
    kinds.add("image");
  }
  return [...kinds];
}

export function normalizeUsefulGatewayUrl(value: string | undefined): string {
  const raw = (value || DEFAULT_DENCH_CLOUD_GATEWAY_URL).trim();
  const withProtocol = raw.startsWith("http://") || raw.startsWith("https://")
    ? raw
    : `https://${raw}`;
  return withProtocol.replace(/\/+$/, "").replace(/\/v1$/u, "");
}

export function buildUsefulGatewayApiBaseUrl(gatewayUrl: string | undefined): string {
  return `${normalizeUsefulGatewayUrl(gatewayUrl)}/v1`;
}

export function buildUsefulGatewayCatalogUrl(gatewayUrl: string | undefined): string {
  return `${normalizeUsefulGatewayUrl(gatewayUrl)}/v1/public/models`;
}

export const RECOMMENDED_DENCH_CLOUD_MODEL_ID = "claude-opus-4.6";

export const FALLBACK_DENCH_CLOUD_MODELS: UsefulCloudCatalogModel[] = [
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
      input: markupCost(5),
      output: markupCost(25),
      cacheRead: 0,
      cacheWrite: 0,
      marginPercent: DEFAULT_DENCH_CLOUD_MARGIN_PERCENT,
    },
  },
  {
    id: "gpt-5.4",
    stableId: "gpt-5.4",
    displayName: "GPT-5.4",
    provider: "openai",
    transportProvider: "openai",
    api: "openai-completions",
    input: ["text", "image"],
    reasoning: false,
    contextWindow: 128000,
    maxTokens: 128000,
    supportsStreaming: true,
    supportsImages: true,
    supportsResponses: true,
    supportsReasoning: false,
    cost: {
      input: markupCost(2.5),
      output: markupCost(15),
      cacheRead: 0,
      cacheWrite: 0,
      marginPercent: DEFAULT_DENCH_CLOUD_MARGIN_PERCENT,
    },
  },
  {
    id: "claude-sonnet-4.6",
    stableId: "anthropic.claude-sonnet-4-6-v1",
    displayName: "Claude Sonnet 4.6",
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
      input: markupCost(3),
      output: markupCost(15),
      cacheRead: 0,
      cacheWrite: 0,
      marginPercent: DEFAULT_DENCH_CLOUD_MARGIN_PERCENT,
    },
  },
];

export function cloneFallbackUsefulCloudModels(): UsefulCloudCatalogModel[] {
  return FALLBACK_DENCH_CLOUD_MODELS.map((model) => ({
    ...model,
    input: [...model.input],
    cost: { ...model.cost },
  }));
}

export function normalizeUsefulCloudCatalogModel(input: unknown): UsefulCloudCatalogModel | null {
  const record = asRecord(input);
  if (!record) {
    return null;
  }

  const publicId = readString(record, "id", "publicId", "public_id");
  const stableId = readString(record, "stableId", "stable_id") || publicId;
  const displayName = readString(record, "name", "displayName", "display_name");
  const provider = readString(record, "provider");
  const transportProvider = readString(record, "transportProvider", "transport_provider");
  if (!publicId || !stableId || !displayName || !isNonEmptyString(provider) || !isNonEmptyString(transportProvider)) {
    return null;
  }

  const supportsImages = readBoolean(record, "supportsImages", "supports_images") ?? false;
  const supportsStreaming = readBoolean(record, "supportsStreaming", "supports_streaming") ?? true;
  const supportsResponses = readBoolean(record, "supportsResponses", "supports_responses") ?? true;
  const supportsReasoning = readBoolean(record, "supportsReasoning", "supports_reasoning")
    ?? readBoolean(record, "reasoning")
    ?? false;
  const contextWindow = readNumber(record, "contextWindow", "context_window") ?? 200000;
  const maxTokens = readNumber(record, "maxTokens", "max_tokens", "maxOutputTokens", "max_output_tokens") ?? 64000;

  const costRecord = asRecord(record.cost) ?? {};
  const inputCost = readNumber(costRecord, "input") ?? 0;
  const outputCost = readNumber(costRecord, "output") ?? 0;
  const cacheRead = readNumber(costRecord, "cacheRead", "cache_read") ?? 0;
  const cacheWrite = readNumber(costRecord, "cacheWrite", "cache_write") ?? 0;
  const marginPercent = readNumber(costRecord, "marginPercent", "margin_percent");

  return {
    id: publicId,
    stableId,
    displayName,
    provider,
    transportProvider,
    api: "openai-completions",
    input: normalizeInputKinds(record.input, supportsImages),
    reasoning: supportsReasoning,
    contextWindow,
    maxTokens,
    supportsStreaming,
    supportsImages,
    supportsResponses,
    supportsReasoning,
    cost: {
      input: inputCost,
      output: outputCost,
      cacheRead,
      cacheWrite,
      ...(marginPercent !== undefined ? { marginPercent } : {}),
    },
  };
}

export function normalizeUsefulCloudCatalogResponse(payload: unknown): UsefulCloudCatalogModel[] {
  const root = asRecord(payload);
  const data = root?.data;
  if (!Array.isArray(data)) {
    return [];
  }

  const models: UsefulCloudCatalogModel[] = [];
  const seen = new Set<string>();
  for (const entry of data) {
    const normalized = normalizeUsefulCloudCatalogModel(entry);
    if (!normalized || seen.has(normalized.stableId)) {
      continue;
    }
    seen.add(normalized.stableId);
    models.push(normalized);
  }
  return models;
}

export async function fetchUsefulCloudCatalog(
  gatewayUrl: string,
): Promise<UsefulCloudCatalogLoadResult> {
  try {
    const response = await fetch(buildUsefulGatewayCatalogUrl(gatewayUrl));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json().catch(() => null);
    const models = normalizeUsefulCloudCatalogResponse(payload);
    if (!models.length) {
      throw new Error("response did not contain any usable models");
    }

    return {
      models,
      source: "live",
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      models: cloneFallbackUsefulCloudModels(),
      source: "fallback",
      detail,
    };
  }
}

export async function validateUsefulCloudApiKey(
  gatewayUrl: string,
  apiKey: string,
): Promise<void> {
  const response = await fetch(`${buildUsefulGatewayApiBaseUrl(gatewayUrl)}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (response.ok) {
    return;
  }

  const message =
    response.status === 401 || response.status === 403
      ? "Invalid Useful Cloud API key."
      : `Useful Cloud validation failed with HTTP ${response.status}.`;
  throw new Error(`${message} Check your key at useful.com/settings.`);
}

export function buildUsefulCloudProviderModels(models: UsefulCloudCatalogModel[]) {
  return models.map((model) => ({
    id: model.stableId,
    name: `${model.displayName} (Useful Cloud)`,
    reasoning: model.reasoning,
    input: [...model.input],
    cost: {
      input: model.cost.input,
      output: model.cost.output,
      cacheRead: model.cost.cacheRead,
      cacheWrite: model.cost.cacheWrite,
    },
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  }));
}

export function buildUsefulCloudAgentModelEntries(models: UsefulCloudCatalogModel[]) {
  return Object.fromEntries(
    models.map((model) => [
      `useful-cloud/${model.stableId}`,
      { alias: `${model.displayName} (Useful Cloud)` },
    ]),
  );
}

export function buildUsefulCloudProviderConfig(params: {
  gatewayUrl: string;
  apiKey: string;
  models: UsefulCloudCatalogModel[];
}) {
  return {
    baseUrl: buildUsefulGatewayApiBaseUrl(params.gatewayUrl),
    apiKey: params.apiKey,
    api: "openai-completions",
    models: buildUsefulCloudProviderModels(params.models),
  };
}

export function buildUsefulCloudConfigPatch(params: {
  gatewayUrl: string;
  apiKey: string;
  models: UsefulCloudCatalogModel[];
}) {
  return {
    models: {
      mode: "merge",
      providers: {
        "useful-cloud": buildUsefulCloudProviderConfig(params),
      },
    },
    agents: {
      defaults: {
        models: buildUsefulCloudAgentModelEntries(params.models),
      },
    },
  };
}

export function resolveUsefulCloudModel(
  models: UsefulCloudCatalogModel[],
  requestedId: string | undefined,
): UsefulCloudCatalogModel | undefined {
  const normalized = requestedId?.trim();
  if (!normalized) {
    return (
      models.find((model) => model.id === RECOMMENDED_DENCH_CLOUD_MODEL_ID) ||
      models[0]
    );
  }

  return models.find((model) => model.id === normalized || model.stableId === normalized);
}

export function formatUsefulCloudModelHint(model: UsefulCloudCatalogModel): string {
  const parts: string[] = [model.provider];
  if (model.reasoning) parts.push("reasoning");
  if (model.id === RECOMMENDED_DENCH_CLOUD_MODEL_ID) parts.push("recommended");
  return parts.join(" · ");
}

export function readConfiguredUsefulCloudSettings(
  rawConfig: Record<string, unknown> | undefined,
): {
  gatewayUrl?: string;
  apiKey?: string;
  selectedModel?: string;
} {
  const provider = asRecord(
    asRecord(asRecord(rawConfig?.models)?.providers)?.["useful-cloud"],
  );
  const defaults = asRecord(asRecord(rawConfig?.agents)?.defaults);
  const modelValue = defaults?.model;
  const modelSetting = asRecord(modelValue);
  const modelPrimary =
    typeof modelValue === "string"
      ? modelValue
      : typeof modelSetting?.primary === "string"
        ? modelSetting.primary
        : undefined;

  const selectedModel =
    typeof modelPrimary === "string" && modelPrimary.startsWith("useful-cloud/")
      ? modelPrimary.slice("useful-cloud/".length)
      : undefined;

  const baseUrl = readString(provider ?? {}, "baseUrl", "base_url");
  return {
    gatewayUrl: baseUrl ? normalizeUsefulGatewayUrl(baseUrl) : undefined,
    apiKey: readString(provider ?? {}, "apiKey", "api_key"),
    selectedModel,
  };
}
