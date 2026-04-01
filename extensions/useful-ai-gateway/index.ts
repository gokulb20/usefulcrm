import {
  buildUsefulCloudAgentModelEntries,
  buildUsefulCloudProviderModels,
  buildUsefulGatewayApiBaseUrl,
  buildUsefulGatewayCatalogUrl,
  cloneFallbackUsefulCloudModels,
  DEFAULT_DENCH_CLOUD_GATEWAY_URL,
  formatUsefulCloudModelHint,
  normalizeUsefulCloudCatalogResponse,
  normalizeUsefulGatewayUrl,
  resolveUsefulCloudModel,
  type UsefulCloudCatalogModel,
} from "./models.js";

export const id = "useful-ai-gateway";

const PROVIDER_ID = "useful-cloud";
const PROVIDER_LABEL = "Useful Cloud";
const API_KEY_ENV_VARS = ["DENCH_CLOUD_API_KEY", "DENCH_API_KEY"] as const;

type CatalogSource = "live" | "fallback";

type CatalogLoadResult = {
  models: UsefulCloudCatalogModel[];
  source: CatalogSource;
  detail?: string;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" ? (value as UnknownRecord) : undefined;
}

function resolvePluginConfig(api: any): UnknownRecord | undefined {
  const pluginConfig = api?.config?.plugins?.entries?.["useful-ai-gateway"]?.config;
  return asRecord(pluginConfig);
}

function resolveGatewayUrl(api: any): string {
  const pluginConfig = resolvePluginConfig(api);
  const configured = typeof pluginConfig?.gatewayUrl === "string" ? pluginConfig.gatewayUrl : undefined;
  return normalizeUsefulGatewayUrl(
    configured || process.env.DENCH_GATEWAY_URL || DEFAULT_DENCH_CLOUD_GATEWAY_URL,
  );
}

function resolveEnvApiKey(): string | undefined {
  for (const envVar of API_KEY_ENV_VARS) {
    const value = process.env[envVar]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function buildProviderConfig(
  gatewayUrl: string,
  apiKey: string,
  models: UsefulCloudCatalogModel[],
) {
  return {
    baseUrl: buildUsefulGatewayApiBaseUrl(gatewayUrl),
    apiKey,
    api: "openai-completions",
    models: buildUsefulCloudProviderModels(models),
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
        [PROVIDER_ID]: buildProviderConfig(params.gatewayUrl, params.apiKey, params.models),
      },
    },
    agents: {
      defaults: {
        models: buildUsefulCloudAgentModelEntries(params.models),
      },
    },
  };
}

async function promptForApiKey(prompter: any): Promise<string> {
  if (typeof prompter?.secret === "function") {
    return String(
      await prompter.secret(
        "Enter your Useful Cloud API key (sign up at useful.com and get it at useful.com/settings)",
      ),
    ).trim();
  }

  return String(
    await prompter.text({
      message:
        "Enter your Useful Cloud API key (sign up at useful.com and get it at useful.com/settings)",
    }),
  ).trim();
}

export async function fetchUsefulCloudCatalog(gatewayUrl: string): Promise<CatalogLoadResult> {
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

    return { models, source: "live" };
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

async function promptForModelSelection(params: {
  prompter: any;
  models: UsefulCloudCatalogModel[];
  initialStableId?: string;
}): Promise<UsefulCloudCatalogModel> {
  const selectedStableId = String(
    await params.prompter.select({
      message: "Choose your default Useful Cloud model",
      options: params.models.map((model) => ({
        value: model.stableId,
        label: model.displayName,
        hint: formatUsefulCloudModelHint(model),
      })),
      ...(params.initialStableId ? { initialValue: params.initialStableId } : {}),
    }),
  );

  const selected = resolveUsefulCloudModel(params.models, selectedStableId);
  if (!selected) {
    throw new Error(`Unknown Useful Cloud model "${selectedStableId}".`);
  }
  return selected;
}

function buildAuthNotes(params: {
  gatewayUrl: string;
  catalog: CatalogLoadResult;
}): string[] {
  const notes = [
    `Useful Cloud uses ${buildUsefulGatewayApiBaseUrl(params.gatewayUrl)} for model traffic.`,
  ];

  if (params.catalog.source === "fallback") {
    notes.push(
      `Model catalog fell back to UsefulCRM's bundled list (${params.catalog.detail ?? "public catalog unavailable"}).`,
    );
  }

  return notes;
}

function buildProviderAuthResult(params: {
  gatewayUrl: string;
  apiKey: string;
  catalog: CatalogLoadResult;
  selected: UsefulCloudCatalogModel;
}) {
  return {
    profiles: [
      {
        profileId: `${PROVIDER_ID}:default`,
        credential: {
          type: "api_key",
          provider: PROVIDER_ID,
          key: params.apiKey,
        },
      },
    ],
    defaultModel: `${PROVIDER_ID}/${params.selected.stableId}`,
    configPatch: buildUsefulCloudConfigPatch({
      gatewayUrl: params.gatewayUrl,
      apiKey: params.apiKey,
      models: params.catalog.models,
    }),
    notes: buildAuthNotes({
      gatewayUrl: params.gatewayUrl,
      catalog: params.catalog,
    }),
  };
}

async function runInteractiveAuth(ctx: any, gatewayUrl: string) {
  const apiKey = await promptForApiKey(ctx.prompter);
  if (!apiKey) {
    throw new Error("A Useful Cloud API key is required.");
  }

  await validateUsefulCloudApiKey(gatewayUrl, apiKey);
  const catalog = await fetchUsefulCloudCatalog(gatewayUrl);
  const selected = await promptForModelSelection({
    prompter: ctx.prompter,
    models: catalog.models,
  });

  return buildProviderAuthResult({
    gatewayUrl,
    apiKey,
    catalog,
    selected,
  });
}

async function runNonInteractiveAuth(ctx: any, gatewayUrl: string) {
  const apiKey = String(
    ctx?.opts?.usefulCloudApiKey ||
      ctx?.opts?.usefulCloudKey ||
      resolveEnvApiKey() ||
      "",
  ).trim();
  if (!apiKey) {
    throw new Error(
      "Useful Cloud non-interactive auth requires DENCH_CLOUD_API_KEY or --useful-cloud-api-key.",
    );
  }

  await validateUsefulCloudApiKey(gatewayUrl, apiKey);
  const catalog = await fetchUsefulCloudCatalog(gatewayUrl);
  const selected = resolveUsefulCloudModel(
    catalog.models,
    String(ctx?.opts?.usefulCloudModel || process.env.DENCH_CLOUD_MODEL || "").trim(),
  );
  if (!selected) {
    throw new Error("Configured Useful Cloud model is not available.");
  }

  return buildProviderAuthResult({
    gatewayUrl,
    apiKey,
    catalog,
    selected,
  });
}

function buildDiscoveryProvider(api: any, gatewayUrl: string) {
  const configured = api?.config?.models?.providers?.[PROVIDER_ID];
  if (configured && typeof configured === "object") {
    return configured;
  }

  const apiKey = resolveEnvApiKey();
  if (!apiKey) {
    return null;
  }

  const models = cloneFallbackUsefulCloudModels();
  return buildProviderConfig(gatewayUrl, apiKey, models);
}

export default function register(api: any) {
  const pluginConfig = resolvePluginConfig(api);
  if (pluginConfig?.enabled === false) {
    return;
  }

  const gatewayUrl = resolveGatewayUrl(api);

  api.registerProvider({
    id: PROVIDER_ID,
    label: PROVIDER_LABEL,
    docsPath: "/providers/models",
    aliases: ["useful", "useful-cloud", "useful-ai-gateway"],
    envVars: [...API_KEY_ENV_VARS],
    auth: [
      {
        id: "api-key",
        label: "Useful Cloud API Key",
        hint: "Use your Useful Cloud key from useful.com/settings",
        kind: "api_key",
        run: async (ctx: any) => await runInteractiveAuth(ctx, gatewayUrl),
        // Newer Hermes builds can call this hook during headless onboarding.
        runNonInteractive: async (ctx: any) => await runNonInteractiveAuth(ctx, gatewayUrl),
      },
    ],
    // Newer Hermes builds can surface provider-specific wizard entries.
    wizard: {
      onboarding: {
        choiceId: PROVIDER_ID,
        choiceLabel: PROVIDER_LABEL,
        choiceHint: "Use Useful's managed AI gateway",
        groupId: "useful",
        groupLabel: "Useful",
        groupHint: "Managed Useful Cloud models",
        methodId: "api-key",
      },
      modelPicker: {
        label: PROVIDER_LABEL,
        hint: "Connect Useful Cloud with your API key",
        methodId: "api-key",
      },
    },
    // Best-effort discovery so newer Hermes builds can rehydrate provider config.
    discovery: {
      order: "profile",
      run: async () => {
        const provider = buildDiscoveryProvider(api, gatewayUrl);
        return provider ? { provider } : null;
      },
    },
  } as any);

  api.registerService({
    id: "useful-ai-gateway",
    start: () => {
      api.logger?.info?.(`[useful-ai-gateway] active (gateway: ${gatewayUrl})`);
    },
    stop: () => {
      api.logger?.info?.("[useful-ai-gateway] stopped");
    },
  });
}
