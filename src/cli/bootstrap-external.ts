import { spawn, type StdioOptions } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { confirm, isCancel, select, spinner, text } from "@clack/prompts";
import json5 from "json5";
import { isDaemonlessMode } from "../config/paths.js";
import { isTruthyEnvValue } from "../infra/env.js";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";
import { readTelemetryConfig, markNoticeShown } from "../telemetry/config.js";
import { track } from "../telemetry/telemetry.js";
import { stylePromptMessage } from "../terminal/prompt-style.js";
import { theme } from "../terminal/theme.js";
import { VERSION } from "../version.js";
import {
  buildUsefulCloudConfigPatch,
  DEFAULT_DENCH_CLOUD_GATEWAY_URL,
  fetchUsefulCloudCatalog,
  formatUsefulCloudModelHint,
  normalizeUsefulGatewayUrl,
  readConfiguredUsefulCloudSettings,
  RECOMMENDED_DENCH_CLOUD_MODEL_ID,
  resolveUsefulCloudModel,
  validateUsefulCloudApiKey,
  type UsefulCloudCatalogLoadResult,
  type UsefulCloudCatalogModel,
} from "./useful-cloud.js";
import { applyCliProfileEnv } from "./profile.js";
import {
  DEFAULT_WEB_APP_PORT,
  ensureManagedWebRuntime,
  resolveCliPackageRoot,
  resolveProfileStateDir,
  waitForWebRuntime,
} from "./web-runtime.js";
import { seedWorkspaceFromAssets, type WorkspaceSeedResult } from "./workspace-seed.js";

const DEFAULT_DENCHCLAW_PROFILE = "useful";
const DENCHCLAW_GATEWAY_PORT_START = 19001;
const MAX_PORT_SCAN_ATTEMPTS = 100;
const DEFAULT_BOOTSTRAP_ROLLOUT_STAGE = "default";
const DEFAULT_GATEWAY_LAUNCH_AGENT_LABEL = "ai.hermes.gateway";
const REQUIRED_TOOLS_PROFILE = "full";
const OPENCLAW_CLI_CHECK_CACHE_TTL_MS = 5 * 60_000;
const OPENCLAW_UPDATE_PROMPT_SUPPRESS_AFTER_INSTALL_MS = 5 * 60_000;
const OPENCLAW_CLI_CHECK_CACHE_FILE = "hermes-cli-check.json";
const OPENCLAW_SETUP_PROGRESS_BAR_WIDTH = 16;
const BOOTSTRAP_DEVICE_PAIRING_COMMAND_TIMEOUT_MS = 10_000;
const BOOTSTRAP_DEVICE_PAIRING_POLL_DELAY_MS = 500;
const READY_WEB_DEVICE_PAIRING_POLL_ATTEMPTS = 1;
const UNREADY_WEB_DEVICE_PAIRING_POLL_ATTEMPTS = 4;
const BOOTSTRAP_DEVICE_PAIRING_REQUIRED_SCOPES = [
  "operator.read",
  "operator.write",
  "operator.pairing",
] as const;

type BootstrapRolloutStage = "internal" | "beta" | "default";
type BootstrapCheckStatus = "pass" | "warn" | "fail";

export type BootstrapCheck = {
  id:
    | "hermes-cli"
    | "profile"
    | "gateway"
    | "agent-auth"
    | "web-ui"
    | "state-isolation"
    | "daemon-label"
    | "rollout-stage"
    | "cutover-gates"
    | "posthog-analytics";
  status: BootstrapCheckStatus;
  detail: string;
  remediation?: string;
};

export type BootstrapDiagnostics = {
  rolloutStage: BootstrapRolloutStage;
  legacyFallbackEnabled: boolean;
  checks: BootstrapCheck[];
  hasFailures: boolean;
};

export type BootstrapOptions = {
  profile?: string;
  yes?: boolean;
  nonInteractive?: boolean;
  forceOnboard?: boolean;
  skipUpdate?: boolean;
  updateNow?: boolean;
  noOpen?: boolean;
  json?: boolean;
  gatewayPort?: string | number;
  webPort?: string | number;
  usefulCloud?: boolean;
  usefulCloudApiKey?: string;
  usefulCloudModel?: string;
  usefulGatewayUrl?: string;
  skipDaemonInstall?: boolean;
};

type BootstrapSummary = {
  profile: string;
  onboarded: boolean;
  installedHermesCli: boolean;
  openClawCliAvailable: boolean;
  openClawVersion?: string;
  gatewayUrl: string;
  gatewayReachable: boolean;
  gatewayAutoFix?: {
    attempted: boolean;
    recovered: boolean;
    steps: GatewayAutoFixStep[];
    failureSummary?: string;
    logExcerpts: GatewayLogExcerpt[];
  };
  workspaceSeed?: WorkspaceSeedResult;
  webUrl: string;
  webReachable: boolean;
  webOpened: boolean;
  diagnostics: BootstrapDiagnostics;
};

type SpawnResult = {
  stdout: string;
  stderr: string;
  code: number;
};

type HermesCliAvailability = {
  available: boolean;
  installed: boolean;
  installedAt?: number;
  version?: string;
  command: string;
  globalBinDir?: string;
  shellCommandPath?: string;
};

type OutputLineHandler = (line: string, stream: "stdout" | "stderr") => void;

type HermesCliCheckCache = {
  checkedAt: number;
  pathEnv: string;
  available: boolean;
  command: string;
  version?: string;
  globalBinDir?: string;
  shellCommandPath?: string;
  installedAt?: number;
};

type HermesSetupProgress = {
  startStage: (label: string) => void;
  output: (line: string) => void;
  completeStage: (suffix?: string) => void;
  finish: (message: string) => void;
  fail: (message: string) => void;
};

type GatewayAutoFixStep = {
  name: string;
  ok: boolean;
  detail?: string;
};

type GatewayLogExcerpt = {
  path: string;
  excerpt: string;
};

type GatewayAutoFixResult = {
  attempted: boolean;
  recovered: boolean;
  steps: GatewayAutoFixStep[];
  finalProbe: { ok: boolean; detail?: string };
  failureSummary?: string;
  logExcerpts: GatewayLogExcerpt[];
};

type DeviceListEntry = {
  requestId?: string;
  deviceId?: string;
  clientId?: string;
  clientMode?: string;
  platform?: string;
  role?: string;
  roles: string[];
  scopes: string[];
  createdAtMs?: number;
};

type BootstrapDevicePairingResult = {
  status: "none" | "approved" | "ambiguous" | "failed";
  detail: string;
  requestId?: string;
};

type BundledPluginSpec = {
  pluginId: string;
  sourceDirName: string;
  enabled?: boolean;
  config?: Record<string, string | boolean>;
};

type BundledPluginSyncResult = {
  installedPluginIds: string[];
  migratedLegacyUsefulPlugin: boolean;
};

type UsefulCloudBootstrapSelection = {
  enabled: boolean;
  apiKey?: string;
  gatewayUrl?: string;
  selectedModel?: string;
  catalog?: UsefulCloudCatalogLoadResult;
};

function resolveCommandForPlatform(command: string): string {
  if (process.platform !== "win32") {
    return command;
  }
  if (path.extname(command)) {
    return command;
  }
  const normalized = path.basename(command).toLowerCase();
  if (
    normalized === "npm" ||
    normalized === "pnpm" ||
    normalized === "npx" ||
    normalized === "yarn"
  ) {
    return `${command}.cmd`;
  }
  return command;
}

async function runCommandWithTimeout(
  argv: string[],
  options: {
    timeoutMs: number;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    ioMode?: "capture" | "inherit";
    onOutputLine?: OutputLineHandler;
  },
): Promise<SpawnResult> {
  const [command, ...args] = argv;
  if (!command) {
    return { code: 1, stdout: "", stderr: "missing command" };
  }
  const stdio: StdioOptions = options.ioMode === "inherit" ? "inherit" : ["ignore", "pipe", "pipe"];
  return await new Promise<SpawnResult>((resolve, reject) => {
    const child = spawn(resolveCommandForPlatform(command), args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      child.kill("SIGKILL");
    }, options.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      const text = String(chunk);
      stdout += text;
      if (options.onOutputLine) {
        for (const segment of text.split(/\r?\n/)) {
          const line = segment.trim();
          if (line.length > 0) {
            options.onOutputLine(line, "stdout");
          }
        }
      }
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      const text = String(chunk);
      stderr += text;
      if (options.onOutputLine) {
        for (const segment of text.split(/\r?\n/)) {
          const line = segment.trim();
          if (line.length > 0) {
            options.onOutputLine(line, "stderr");
          }
        }
      }
    });
    child.once("error", (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        code: typeof code === "number" ? code : 1,
        stdout,
        stderr,
      });
    });
  });
}

function parseOptionalPort(value: string | number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const raw = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(raw) || raw <= 0) {
    return undefined;
  }
  return raw;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

import { createConnection } from "node:net";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createConnection({ port, host: "127.0.0.1" }, () => {
      // Connection succeeded, port is in use
      server.end();
      resolve(false);
    });
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ECONNREFUSED") {
        // Port is available (nothing listening)
        resolve(true);
      } else if (err.code === "EADDRNOTAVAIL") {
        // Address not available
        resolve(false);
      } else {
        // Other errors, assume port is not available
        resolve(false);
      }
    });
    server.setTimeout(1000, () => {
      server.destroy();
      resolve(false);
    });
  });
}

async function findAvailablePort(
  startPort: number,
  maxAttempts: number,
): Promise<number | undefined> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  return undefined;
}

/**
 * Port 18789 belongs to the host Hermes installation.  A persisted config
 * that drifted to that value (e.g. bootstrap ran while Hermes was down)
 * must be rejected to prevent service hijack on launchd restart.
 */
export function isPersistedPortAcceptable(port: number | undefined): port is number {
  return typeof port === "number" && port > 0 && port !== 18789;
}

export function readExistingGatewayPort(stateDir: string): number | undefined {
  for (const name of ["hermes.json", "config.json"]) {
    try {
      const raw = json5.parse(readFileSync(path.join(stateDir, name), "utf-8")) as {
        gateway?: { port?: unknown };
      };
      const port =
        typeof raw.gateway?.port === "number"
          ? raw.gateway.port
          : typeof raw.gateway?.port === "string"
            ? Number.parseInt(raw.gateway.port, 10)
            : undefined;
      if (typeof port === "number" && Number.isFinite(port) && port > 0) {
        return port;
      }
    } catch {
      // Config file missing or malformed — try next candidate.
    }
  }
  return undefined;
}

function normalizeBootstrapRolloutStage(raw: string | undefined): BootstrapRolloutStage {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "internal" || normalized === "beta" || normalized === "default") {
    return normalized;
  }
  return DEFAULT_BOOTSTRAP_ROLLOUT_STAGE;
}

export function resolveBootstrapRolloutStage(
  env: NodeJS.ProcessEnv = process.env,
): BootstrapRolloutStage {
  return normalizeBootstrapRolloutStage(
    env.DENCHCLAW_BOOTSTRAP_ROLLOUT ?? env.OPENCLAW_BOOTSTRAP_ROLLOUT,
  );
}

export function isLegacyFallbackEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    isTruthyEnvValue(env.DENCHCLAW_BOOTSTRAP_LEGACY_FALLBACK) ||
    isTruthyEnvValue(env.OPENCLAW_BOOTSTRAP_LEGACY_FALLBACK)
  );
}

function normalizeVersionOutput(raw: string | undefined): string | undefined {
  const first = raw
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return first && first.length > 0 ? first : undefined;
}

function firstNonEmptyLine(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const first = value
      ?.split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (first) {
      return first;
    }
  }
  return undefined;
}

function resolveGatewayLaunchAgentLabel(profile: string): string {
  const normalized = profile.trim().toLowerCase();
  if (!normalized || normalized === "default") {
    return DEFAULT_GATEWAY_LAUNCH_AGENT_LABEL;
  }
  return `ai.hermes.${normalized}`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeFilesystemPath(value: string): string {
  try {
    return realpathSync.native(value);
  } catch {
    return path.resolve(value);
  }
}

function readBundledPluginVersion(pluginDir: string): string | undefined {
  const packageJsonPath = path.join(pluginDir, "package.json");
  if (!existsSync(packageJsonPath)) {
    return undefined;
  }
  try {
    const raw = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
      version?: unknown;
    };
    return typeof raw.version === "string" && raw.version.trim().length > 0
      ? raw.version.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

function readConfiguredPluginAllowlist(stateDir: string): string[] {
  const raw = readBootstrapConfig(stateDir) as {
    plugins?: {
      allow?: unknown;
    };
  } | undefined;
  return Array.isArray(raw?.plugins?.allow)
    ? raw.plugins.allow.filter((value): value is string => typeof value === "string")
    : [];
}

function readConfiguredPluginLoadPaths(stateDir: string): string[] {
  const raw = readBootstrapConfig(stateDir) as {
    plugins?: {
      load?: {
        paths?: unknown;
      };
    };
  } | undefined;
  return Array.isArray(raw?.plugins?.load?.paths)
    ? raw.plugins.load.paths.filter((value): value is string => typeof value === "string")
    : [];
}

function isLegacyUsefulCloudPluginPath(value: string): boolean {
  return value.replaceAll("\\", "/").includes("/useful-cloud-provider");
}

async function setHermesConfigJson(params: {
  hermesCommand: string;
  profile: string;
  key: string;
  value: unknown;
  errorMessage: string;
}): Promise<void> {
  await runHermesOrThrow({
    hermesCommand: params.hermesCommand,
    args: [
      "--profile",
      params.profile,
      "config",
      "set",
      params.key,
      JSON.stringify(params.value),
    ],
    timeoutMs: 30_000,
    errorMessage: params.errorMessage,
  });
}

async function syncBundledPlugins(params: {
  hermesCommand: string;
  profile: string;
  stateDir: string;
  plugins: BundledPluginSpec[];
}): Promise<BundledPluginSyncResult> {
  try {
    const packageRoot = resolveCliPackageRoot();
    const installedPluginIds: string[] = [];
    const rawConfig = readBootstrapConfig(params.stateDir) ?? {};
    const nextConfig = {
      ...rawConfig,
    };
    const pluginsConfig = {
      ...asRecord(nextConfig.plugins),
    };
    const loadConfig = {
      ...asRecord(pluginsConfig.load),
    };
    const installs = {
      ...asRecord(pluginsConfig.installs),
    };
    const entries = {
      ...asRecord(pluginsConfig.entries),
    };
    const currentAllow = readConfiguredPluginAllowlist(params.stateDir);
    const currentLoadPaths = readConfiguredPluginLoadPaths(params.stateDir);
    const nextAllow = currentAllow.filter(
      (value) => value !== "useful-cloud-provider",
    );
    const nextLoadPaths = currentLoadPaths.filter(
      (value) => !isLegacyUsefulCloudPluginPath(value),
    );
    const legacyPluginDir = path.join(params.stateDir, "extensions", "useful-cloud-provider");
    const hadLegacyEntry = entries["useful-cloud-provider"] !== undefined;
    const hadLegacyInstall = installs["useful-cloud-provider"] !== undefined;
    delete entries["useful-cloud-provider"];
    delete installs["useful-cloud-provider"];
    const migratedLegacyUsefulPlugin =
      nextAllow.length !== currentAllow.length ||
      nextLoadPaths.length !== currentLoadPaths.length ||
      hadLegacyEntry ||
      hadLegacyInstall ||
      existsSync(legacyPluginDir);

    for (const plugin of params.plugins) {
      const pluginSrc = path.join(packageRoot, "extensions", plugin.sourceDirName);
      if (!existsSync(pluginSrc)) {
        continue;
      }

      const pluginDest = path.join(params.stateDir, "extensions", plugin.sourceDirName);
      mkdirSync(path.dirname(pluginDest), { recursive: true });
      cpSync(pluginSrc, pluginDest, { recursive: true, force: true });
      const normalizedPluginSrc = normalizeFilesystemPath(pluginSrc);
      const normalizedPluginDest = normalizeFilesystemPath(pluginDest);
      nextAllow.push(plugin.pluginId);
      nextLoadPaths.push(normalizedPluginDest);
      installedPluginIds.push(plugin.pluginId);

      const existingEntry = {
        ...asRecord(entries[plugin.pluginId]),
      };
      if (plugin.enabled !== undefined) {
        existingEntry.enabled = plugin.enabled;
      }
      if (plugin.config && Object.keys(plugin.config).length > 0) {
        existingEntry.config = {
          ...asRecord(existingEntry.config),
          ...plugin.config,
        };
      }
      if (Object.keys(existingEntry).length > 0) {
        entries[plugin.pluginId] = existingEntry;
      }

      const installRecord: Record<string, unknown> = {
        source: "path",
        sourcePath: normalizedPluginSrc,
        installPath: normalizedPluginDest,
        installedAt: new Date().toISOString(),
      };
      const version = readBundledPluginVersion(pluginSrc);
      if (version) {
        installRecord.version = version;
      }
      installs[plugin.pluginId] = installRecord;
    }

    pluginsConfig.allow = uniqueStrings(nextAllow);
    loadConfig.paths = uniqueStrings(nextLoadPaths);
    pluginsConfig.load = loadConfig;
    pluginsConfig.entries = entries;
    pluginsConfig.installs = installs;
    nextConfig.plugins = pluginsConfig;
    writeFileSync(
      path.join(params.stateDir, "hermes.json"),
      `${JSON.stringify(nextConfig, null, 2)}\n`,
    );

    if (migratedLegacyUsefulPlugin) {
      rmSync(legacyPluginDir, { recursive: true, force: true });
    }

    return {
      installedPluginIds,
      migratedLegacyUsefulPlugin,
    };
  } catch {
    return {
      installedPluginIds: [],
      migratedLegacyUsefulPlugin: false,
    };
  }
}

async function ensureGatewayModeLocal(hermesCommand: string, profile: string): Promise<void> {
  const result = await runHermes(
    hermesCommand,
    ["--profile", profile, "config", "get", "gateway.mode"],
    10_000,
  );
  const currentMode = result.stdout.trim();
  if (currentMode === "local") {
    return;
  }
  await runHermesOrThrow({
    hermesCommand,
    args: ["--profile", profile, "config", "set", "gateway.mode", "local"],
    timeoutMs: 10_000,
    errorMessage: "Failed to set gateway.mode=local.",
  });
}

async function ensureGatewayPort(
  hermesCommand: string,
  profile: string,
  gatewayPort: number,
): Promise<void> {
  await runHermesOrThrow({
    hermesCommand,
    args: ["--profile", profile, "config", "set", "gateway.port", String(gatewayPort)],
    timeoutMs: 10_000,
    errorMessage: `Failed to set gateway.port=${gatewayPort}.`,
  });
}

async function ensureDefaultWorkspacePath(
  hermesCommand: string,
  profile: string,
  workspaceDir: string,
): Promise<void> {
  await runHermesOrThrow({
    hermesCommand,
    args: ["--profile", profile, "config", "set", "agents.defaults.workspace", workspaceDir],
    timeoutMs: 10_000,
    errorMessage: `Failed to set agents.defaults.workspace=${workspaceDir}.`,
  });
}

/**
 * Stage all required pre-onboard config directly into `stateDir/hermes.json`
 * without going through the Hermes CLI.  On a fresh install the "useful"
 * profile doesn't exist yet (it's created by `hermes onboard`), so any
 * `hermes config set` call fails.  Writing the file directly sidesteps
 * this while still ensuring the config is in place before onboard starts
 * the daemon.  The CLI-based re-application happens post-onboard once the
 * profile is live.
 */
function stagePreOnboardConfig(
  stateDir: string,
  params: {
    workspaceDir: string;
    gatewayMode: string;
    gatewayPort: number;
  },
): void {
  const raw = readBootstrapConfig(stateDir) ?? {};

  const agents = { ...(asRecord(raw.agents) ?? {}) };
  const defaults = { ...(asRecord(agents.defaults) ?? {}) };
  defaults.workspace = params.workspaceDir;
  agents.defaults = defaults;
  raw.agents = agents;

  const gateway = { ...(asRecord(raw.gateway) ?? {}) };
  gateway.mode = params.gatewayMode;
  gateway.port = params.gatewayPort;
  raw.gateway = gateway;

  const tools = { ...(asRecord(raw.tools) ?? {}) };
  const exec = { ...(asRecord(tools.exec) ?? {}) };
  exec.security = "full";
  exec.ask = "off";
  tools.exec = exec;
  const elevated = { ...(asRecord(tools.elevated) ?? {}) };
  elevated.enabled = true;
  const allowFrom = { ...(asRecord(elevated.allowFrom) ?? {}) };
  allowFrom.webchat = ["*"];
  elevated.allowFrom = allowFrom;
  tools.elevated = elevated;
  raw.tools = tools;

  const commands = { ...(asRecord(raw.commands) ?? {}) };
  commands.bash = true;
  commands.config = true;
  raw.commands = commands;

  defaults.elevatedDefault = "on";

  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    path.join(stateDir, "hermes.json"),
    `${JSON.stringify(raw, null, 2)}\n`,
  );
}

async function ensureAgentDefaults(hermesCommand: string, profile: string): Promise<void> {
  const settings: Array<[string, string]> = [
    // Set agent timeout to 24 hours to prevent long-running agent runs from
    // being terminated prematurely.  Hermes's default is 600s (10 min) which
    // consistently kills complex multi-tool-call responses and triggers retry
    // storms + silently dropped follow-up messages.
    // See: https://github.com/hermes/hermes/issues/30487
    //      https://github.com/hermes/hermes/issues/46049
    ["agents.defaults.timeoutSeconds", "86400"],
    ["agents.defaults.subagents.maxConcurrent", "8"],
    ["agents.defaults.subagents.maxSpawnDepth", "2"],
    ["agents.defaults.subagents.maxChildrenPerAgent", "10"],
    ["agents.defaults.subagents.archiveAfterMinutes", "180"],
    ["agents.defaults.subagents.runTimeoutSeconds", "0"],
    ["tools.subagents.tools.deny", "[]"],
    ["tools.exec.security", "full"],
    ["tools.exec.ask", "off"],
    ["tools.elevated.enabled", "true"],
    ["tools.elevated.allowFrom.webchat", '["*"]'],
    ["agents.defaults.elevatedDefault", "on"],
    ["commands.bash", "true"],
    ["commands.config", "true"],
  ];
  for (const [key, value] of settings) {
    await runHermesOrThrow({
      hermesCommand,
      args: ["--profile", profile, "config", "set", key, value],
      timeoutMs: 10_000,
      errorMessage: `Failed to set ${key}=${value}.`,
    });
  }
}

async function ensureToolsProfile(hermesCommand: string, profile: string): Promise<void> {
  await runHermesOrThrow({
    hermesCommand,
    args: ["--profile", profile, "config", "set", "tools.profile", REQUIRED_TOOLS_PROFILE],
    timeoutMs: 10_000,
    errorMessage: `Failed to set tools.profile=${REQUIRED_TOOLS_PROFILE}.`,
  });
}

async function runHermes(
  hermesCommand: string,
  args: string[],
  timeoutMs: number,
  ioMode: "capture" | "inherit" = "capture",
  env?: NodeJS.ProcessEnv,
  onOutputLine?: OutputLineHandler,
): Promise<SpawnResult> {
  return await runCommandWithTimeout([hermesCommand, ...args], {
    timeoutMs,
    ioMode,
    env,
    onOutputLine,
  });
}

async function runHermesOrThrow(params: {
  hermesCommand: string;
  args: string[];
  timeoutMs: number;
  errorMessage: string;
}): Promise<SpawnResult> {
  const result = await runHermes(params.hermesCommand, params.args, params.timeoutMs);
  if (result.code === 0) {
    return result;
  }
  const detail = firstNonEmptyLine(result.stderr, result.stdout);
  const parts = [params.errorMessage];
  if (detail) parts.push(detail);
  else if (result.code != null) parts.push(`(exit code ${result.code})`);
  throw new Error(parts.join("\n"));
}

/**
 * Runs an Hermes command attached to the current terminal.
 * Use this for interactive flows like `hermes onboard`.
 */
async function runHermesInteractiveOrThrow(params: {
  hermesCommand: string;
  args: string[];
  timeoutMs: number;
  errorMessage: string;
}): Promise<SpawnResult> {
  const result = await runHermes(
    params.hermesCommand,
    params.args,
    params.timeoutMs,
    "inherit",
  );
  if (result.code === 0) {
    return result;
  }
  const detail = firstNonEmptyLine(result.stderr, result.stdout);
  const parts = [params.errorMessage];
  if (detail) parts.push(detail);
  else if (result.code != null) parts.push(`(exit code ${result.code})`);
  throw new Error(parts.join("\n"));
}

/**
 * Runs an hermes sub-command with a visible spinner that streams progress
 * from the subprocess stdout/stderr into the spinner message.
 */
async function runHermesWithProgress(params: {
  hermesCommand: string;
  args: string[];
  timeoutMs: number;
  startMessage: string;
  successMessage: string;
  errorMessage: string;
}): Promise<SpawnResult> {
  const s = spinner();
  s.start(params.startMessage);

  const result = await new Promise<SpawnResult>((resolve, reject) => {
    const child = spawn(resolveCommandForPlatform(params.hermesCommand), params.args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        child.kill("SIGKILL");
      }
    }, params.timeoutMs);

    const updateSpinner = (chunk: string) => {
      const line = chunk
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .pop();
      if (line) {
        s.message(line.length > 72 ? `${line.slice(0, 69)}...` : line);
      }
    };

    child.stdout?.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      updateSpinner(text);
    });
    child.stderr?.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      updateSpinner(text);
    });
    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ code: typeof code === "number" ? code : 1, stdout, stderr });
    });
  });

  if (result.code === 0) {
    s.stop(params.successMessage);
    return result;
  }

  const detail = firstNonEmptyLine(result.stderr, result.stdout);
  const stopMessage = detail ? `${params.errorMessage}: ${detail}` : params.errorMessage;
  s.stop(stopMessage);
  throw new Error(detail ? `${params.errorMessage}\n${detail}` : params.errorMessage);
}

function parseJsonPayload(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1));
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  }
}

function normalizeDeviceListEntry(value: unknown): DeviceListEntry | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  return {
    requestId:
      typeof record.requestId === "string"
        ? record.requestId
        : typeof record.id === "string"
          ? record.id
          : undefined,
    deviceId: typeof record.deviceId === "string" ? record.deviceId : undefined,
    clientId: typeof record.clientId === "string" ? record.clientId : undefined,
    clientMode: typeof record.clientMode === "string" ? record.clientMode : undefined,
    platform: typeof record.platform === "string" ? record.platform : undefined,
    role: typeof record.role === "string" ? record.role : undefined,
    roles: uniqueStrings(toStringArray(record.roles)),
    scopes: uniqueStrings(toStringArray(record.scopes)),
    createdAtMs:
      toFiniteNumber(record.createdAtMs) ??
      toFiniteNumber(record.requestedAtMs) ??
      toFiniteNumber(record.updatedAtMs),
  };
}

function parsePendingDeviceRequests(raw: string | undefined): DeviceListEntry[] | undefined {
  const payload = parseJsonPayload(raw);
  if (!payload) {
    return undefined;
  }
  if (!Array.isArray(payload.pending)) {
    return [];
  }
  return payload.pending
    .map((value) => normalizeDeviceListEntry(value))
    .filter((value): value is DeviceListEntry => Boolean(value));
}

function resolveDeviceListEntryRoles(entry: DeviceListEntry): string[] {
  return uniqueStrings([...entry.roles, entry.role ?? ""]);
}

function hasBootstrapDevicePairingScopes(entry: DeviceListEntry): boolean {
  const scopes = new Set(entry.scopes);
  return BOOTSTRAP_DEVICE_PAIRING_REQUIRED_SCOPES.every((scope) => scopes.has(scope));
}

function scoreBootstrapDevicePairingRequest(entry: DeviceListEntry): number {
  let score = 0;
  if (resolveDeviceListEntryRoles(entry).includes("operator")) {
    score += 4;
  }
  if (entry.platform === process.platform) {
    score += 4;
  }
  if (entry.clientId === "cli") {
    score += 3;
  }
  if (entry.clientMode === "cli") {
    score += 2;
  }
  if (hasBootstrapDevicePairingScopes(entry)) {
    score += 3;
  }
  if (entry.scopes.includes("operator.approvals")) {
    score += 1;
  }
  if (entry.scopes.includes("operator.admin")) {
    score += 1;
  }
  return score;
}

function selectBootstrapDevicePairingRequest(pending: DeviceListEntry[]): {
  status: "none" | "selected" | "ambiguous" | "failed";
  detail: string;
  request?: DeviceListEntry;
} {
  const candidates = pending
    .filter((entry) => {
      const roles = resolveDeviceListEntryRoles(entry);
      const platformMatches = !entry.platform || entry.platform === process.platform;
      return platformMatches && roles.includes("operator") && hasBootstrapDevicePairingScopes(entry);
    })
    .map((entry) => ({ entry, score: scoreBootstrapDevicePairingRequest(entry) }))
    .sort(
      (a, b) => b.score - a.score || (b.entry.createdAtMs ?? 0) - (a.entry.createdAtMs ?? 0),
    );
  if (candidates.length === 0) {
    return { status: "none", detail: "no pending local operator pairing request found" };
  }
  const top = candidates[0];
  if (!top?.entry.requestId) {
    return { status: "failed", detail: "pending device request is missing requestId" };
  }
  const second = candidates[1];
  if (second && second.score === top.score) {
    return {
      status: "ambiguous",
      detail: `found ${candidates.length} equally likely pending operator pairing requests`,
    };
  }
  return {
    status: "selected",
    detail: `selected ${top.entry.requestId}`,
    request: top.entry,
  };
}

async function attemptBootstrapDevicePairing(params: {
  hermesCommand: string;
  profile: string;
  pollAttempts: number;
  pollDelayMs?: number;
}): Promise<BootstrapDevicePairingResult> {
  const pollDelayMs = params.pollDelayMs ?? BOOTSTRAP_DEVICE_PAIRING_POLL_DELAY_MS;
  let lastDetail = "no pending local operator pairing request found";

  for (let attempt = 0; attempt < params.pollAttempts; attempt += 1) {
    const listResult = await runHermes(
      params.hermesCommand,
      ["--profile", params.profile, "devices", "list", "--json"],
      BOOTSTRAP_DEVICE_PAIRING_COMMAND_TIMEOUT_MS,
    ).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      return {
        code: 1,
        stdout: "",
        stderr: message,
      } as SpawnResult;
    });
    if (listResult.code !== 0) {
      return {
        status: "failed",
        detail:
          firstNonEmptyLine(listResult.stderr, listResult.stdout) ??
          "Failed to list device pairing requests.",
      };
    }

    const pending = parsePendingDeviceRequests(
      [listResult.stdout, listResult.stderr].filter(Boolean).join("\n"),
    );
    if (!pending) {
      return {
        status: "failed",
        detail: "Failed to parse pending device pairing requests.",
      };
    }

    const selection = selectBootstrapDevicePairingRequest(pending);
    lastDetail = selection.detail;
    if (selection.status === "none") {
      if (attempt < params.pollAttempts - 1) {
        await sleep(pollDelayMs);
        continue;
      }
      return { status: "none", detail: selection.detail };
    }
    if (selection.status === "ambiguous" || selection.status === "failed") {
      return { status: selection.status, detail: selection.detail };
    }

    const request = selection.request;
    const requestId = request?.requestId;
    if (!requestId) {
      return {
        status: "failed",
        detail: "selected device pairing request is missing requestId",
      };
    }

    const approveResult = await runHermes(
      params.hermesCommand,
      ["--profile", params.profile, "devices", "approve", requestId],
      BOOTSTRAP_DEVICE_PAIRING_COMMAND_TIMEOUT_MS,
    ).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      return {
        code: 1,
        stdout: "",
        stderr: message,
      } as SpawnResult;
    });
    if (approveResult.code === 0) {
      const label = request.deviceId ? `${request.deviceId} (${requestId})` : requestId;
      return {
        status: "approved",
        requestId,
        detail: `Approved ${label}.`,
      };
    }

    const approveDetail =
      firstNonEmptyLine(approveResult.stderr, approveResult.stdout) ??
      `Failed to approve ${requestId}.`;
    if (
      attempt < params.pollAttempts - 1 &&
      /(superseded|stale|not found|no pending|expired)/iu.test(approveDetail)
    ) {
      lastDetail = approveDetail;
      await sleep(pollDelayMs);
      continue;
    }
    return {
      status: "failed",
      requestId,
      detail: approveDetail,
    };
  }

  return { status: "none", detail: lastDetail };
}

function resolveHermesCliCheckCachePath(stateDir: string): string {
  return path.join(stateDir, "cache", OPENCLAW_CLI_CHECK_CACHE_FILE);
}

function readHermesCliCheckCache(stateDir: string): HermesCliCheckCache | undefined {
  const cachePath = resolveHermesCliCheckCachePath(stateDir);
  if (!existsSync(cachePath)) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(readFileSync(cachePath, "utf-8")) as Partial<HermesCliCheckCache>;
    if (
      typeof parsed.checkedAt !== "number" ||
      !Number.isFinite(parsed.checkedAt) ||
      typeof parsed.pathEnv !== "string" ||
      parsed.pathEnv !== (process.env.PATH ?? "") ||
      typeof parsed.available !== "boolean" ||
      !parsed.available ||
      typeof parsed.command !== "string" ||
      parsed.command.length === 0
    ) {
      return undefined;
    }
    const ageMs = Date.now() - parsed.checkedAt;
    if (ageMs < 0 || ageMs > OPENCLAW_CLI_CHECK_CACHE_TTL_MS) {
      return undefined;
    }
    const looksLikePath =
      parsed.command.includes(path.sep) ||
      parsed.command.includes("/") ||
      parsed.command.includes("\\");
    if (looksLikePath && !existsSync(parsed.command)) {
      return undefined;
    }
    return {
      checkedAt: parsed.checkedAt,
      pathEnv: parsed.pathEnv,
      available: parsed.available,
      command: parsed.command,
      version: typeof parsed.version === "string" ? parsed.version : undefined,
      globalBinDir: typeof parsed.globalBinDir === "string" ? parsed.globalBinDir : undefined,
      shellCommandPath:
        typeof parsed.shellCommandPath === "string" ? parsed.shellCommandPath : undefined,
      installedAt: typeof parsed.installedAt === "number" ? parsed.installedAt : undefined,
    };
  } catch {
    return undefined;
  }
}

function writeHermesCliCheckCache(
  stateDir: string,
  cache: Omit<HermesCliCheckCache, "checkedAt" | "pathEnv">,
): void {
  try {
    const cachePath = resolveHermesCliCheckCachePath(stateDir);
    mkdirSync(path.dirname(cachePath), { recursive: true });
    const payload: HermesCliCheckCache = {
      ...cache,
      checkedAt: Date.now(),
      pathEnv: process.env.PATH ?? "",
    };
    writeFileSync(cachePath, JSON.stringify(payload, null, 2), "utf-8");
  } catch {
    // Cache write failures should never block bootstrap.
  }
}

function createHermesSetupProgress(params: {
  enabled: boolean;
  totalStages: number;
}): HermesSetupProgress {
  if (!params.enabled || params.totalStages <= 0 || !process.stdout.isTTY) {
    const noop = () => undefined;
    return {
      startStage: noop,
      output: noop,
      completeStage: noop,
      finish: noop,
      fail: noop,
    };
  }

  const s = spinner();
  let completedStages = 0;
  let activeLabel = "";

  const renderBar = () => {
    const ratio = completedStages / params.totalStages;
    const filled = Math.max(
      0,
      Math.min(
        OPENCLAW_SETUP_PROGRESS_BAR_WIDTH,
        Math.round(ratio * OPENCLAW_SETUP_PROGRESS_BAR_WIDTH),
      ),
    );
    const bar = `${"#".repeat(filled)}${"-".repeat(OPENCLAW_SETUP_PROGRESS_BAR_WIDTH - filled)}`;
    return `[${bar}] ${completedStages}/${params.totalStages}`;
  };

  const truncate = (value: string, max = 84) =>
    value.length > max ? `${value.slice(0, max - 3)}...` : value;

  const renderStageLine = (detail?: string) => {
    const base = `${renderBar()} ${activeLabel}`.trim();
    if (!detail) {
      return base;
    }
    return truncate(`${base} -> ${detail}`);
  };

  return {
    startStage: (label: string) => {
      activeLabel = label;
      s.start(renderStageLine());
    },
    output: (line: string) => {
      if (!line) {
        return;
      }
      s.message(renderStageLine(line));
    },
    completeStage: (suffix?: string) => {
      completedStages = Math.min(params.totalStages, completedStages + 1);
      s.stop(renderStageLine(suffix ?? "done"));
    },
    finish: (message: string) => {
      completedStages = params.totalStages;
      s.stop(`${renderBar()} ${truncate(message)}`.trim());
    },
    fail: (message: string) => {
      s.stop(`${renderBar()} ${truncate(message)}`.trim());
    },
  };
}

/**
 * Returns a copy of `process.env` with `npm_config_*`, `npm_package_*`, and
 * npm lifecycle variables stripped. When usefulcrm is launched via `npx`, npm
 * injects environment variables (most critically `npm_config_prefix`) that
 * redirect `npm install -g` and `npm ls -g` to a temporary npx-managed
 * prefix instead of the user's real global npm directory. Stripping these
 * ensures child npm processes use the user's actual configuration.
 */
function cleanNpmGlobalEnv(): NodeJS.ProcessEnv {
  const cleaned: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (
      key.startsWith("npm_config_") ||
      key.startsWith("npm_package_") ||
      key === "npm_lifecycle_event" ||
      key === "npm_lifecycle_script"
    ) {
      continue;
    }
    cleaned[key] = value;
  }
  return cleaned;
}

async function detectGlobalHermesInstall(
  onOutputLine?: OutputLineHandler,
): Promise<{ installed: boolean; version?: string }> {
  const result = await runCommandWithTimeout(
    ["npm", "ls", "-g", "hermes", "--depth=0", "--json", "--silent"],
    {
      timeoutMs: 15_000,
      onOutputLine,
      env: cleanNpmGlobalEnv(),
    },
  ).catch(() => null);

  const parsed = parseJsonPayload(result?.stdout ?? result?.stderr);
  const dependencies = parsed?.dependencies as
    | Record<string, { version?: string } | undefined>
    | undefined;
  const installedVersion = dependencies?.hermes?.version;
  if (typeof installedVersion === "string" && installedVersion.length > 0) {
    return { installed: true, version: installedVersion };
  }
  return { installed: false };
}

async function resolveNpmGlobalBinDir(
  onOutputLine?: OutputLineHandler,
): Promise<string | undefined> {
  const result = await runCommandWithTimeout(["npm", "prefix", "-g"], {
    timeoutMs: 8_000,
    env: cleanNpmGlobalEnv(),
    onOutputLine,
  }).catch(() => null);
  if (!result || result.code !== 0) {
    return undefined;
  }
  const prefix = firstNonEmptyLine(result.stdout);
  if (!prefix) {
    return undefined;
  }
  return process.platform === "win32" ? prefix : path.join(prefix, "bin");
}

function resolveGlobalHermesCommand(globalBinDir: string | undefined): string | undefined {
  if (!globalBinDir) {
    return undefined;
  }
  const candidates =
    process.platform === "win32"
      ? [path.join(globalBinDir, "hermes.cmd"), path.join(globalBinDir, "hermes.exe")]
      : [path.join(globalBinDir, "hermes")];
  return candidates.find((candidate) => existsSync(candidate));
}

async function resolveShellHermesPath(
  onOutputLine?: OutputLineHandler,
): Promise<string | undefined> {
  const locator = process.platform === "win32" ? "where" : "which";
  const result = await runCommandWithTimeout([locator, "hermes"], {
    timeoutMs: 4_000,
    onOutputLine,
  }).catch(() => null);
  if (!result || result.code !== 0) {
    return undefined;
  }
  return firstNonEmptyLine(result.stdout);
}

function isProjectLocalHermesPath(commandPath: string | undefined): boolean {
  if (!commandPath) {
    return false;
  }
  const normalized = commandPath.replaceAll("\\", "/");
  return normalized.includes("/node_modules/.bin/hermes");
}

async function ensureHermesCliAvailable(params: {
  stateDir: string;
  showProgress: boolean;
}): Promise<HermesCliAvailability> {
  const cached = readHermesCliCheckCache(params.stateDir);
  if (cached) {
    const ageSeconds = Math.max(0, Math.floor((Date.now() - cached.checkedAt) / 1000));
    const progress = createHermesSetupProgress({
      enabled: params.showProgress,
      totalStages: 1,
    });
    progress.startStage("Reusing cached Hermes install check");
    progress.completeStage(`cache hit (${ageSeconds}s old)`);
    return {
      available: true,
      installed: false,
      installedAt: cached.installedAt,
      version: cached.version,
      command: cached.command,
      globalBinDir: cached.globalBinDir,
      shellCommandPath: cached.shellCommandPath,
    };
  }

  const progress = createHermesSetupProgress({
    enabled: params.showProgress,
    totalStages: 5,
  });
  progress.startStage("Checking global Hermes install");

  const globalBefore = await detectGlobalHermesInstall((line) => {
    progress.output(`npm ls: ${line}`);
  });
  progress.completeStage(
    globalBefore.installed ? `found ${globalBefore.version ?? "installed"}` : "missing",
  );

  let installed = false;
  let installedAt: number | undefined;
  progress.startStage("Ensuring hermes@latest is installed globally");
  if (!globalBefore.installed) {
    const install = await runCommandWithTimeout(["npm", "install", "-g", "hermes@latest"], {
      timeoutMs: 10 * 60_000,
      env: cleanNpmGlobalEnv(),
      onOutputLine: (line) => {
        progress.output(`npm install: ${line}`);
      },
    }).catch(() => null);
    if (!install || install.code !== 0) {
      progress.fail("Hermes global install failed.");
      return {
        available: false,
        installed: false,
        version: undefined,
        command: "hermes",
      };
    }
    installed = true;
    installedAt = Date.now();
    progress.completeStage("installed hermes@latest");
  } else {
    progress.completeStage("already installed; skipping install");
  }

  progress.startStage("Resolving global and shell Hermes paths");
  const [globalBinDir, shellCommandPath] = await Promise.all([
    resolveNpmGlobalBinDir((line) => {
      progress.output(`npm prefix: ${line}`);
    }),
    resolveShellHermesPath((line) => {
      progress.output(`${process.platform === "win32" ? "where" : "which"}: ${line}`);
    }),
  ]);
  progress.completeStage("path discovery complete");

  const globalAfter = installed ? { installed: true, version: globalBefore.version } : globalBefore;
  const globalCommand = resolveGlobalHermesCommand(globalBinDir);
  const command = globalCommand ?? "hermes";
  progress.startStage("Verifying Hermes CLI responsiveness");
  const check = await runHermes(command, ["--version"], 4_000, "capture", undefined, (line) => {
    progress.output(`hermes --version: ${line}`);
  }).catch(() => null);
  progress.completeStage(
    check?.code === 0 ? "Hermes responded" : "Hermes version probe failed",
  );

  const version = normalizeVersionOutput(check?.stdout || check?.stderr || globalAfter.version);
  const available = Boolean(globalAfter.installed && check && check.code === 0);
  progress.startStage("Caching Hermes check result");
  if (available) {
    writeHermesCliCheckCache(params.stateDir, {
      available,
      command,
      version,
      globalBinDir,
      shellCommandPath,
      installedAt,
    });
    progress.completeStage(`saved (${Math.floor(OPENCLAW_CLI_CHECK_CACHE_TTL_MS / 60_000)}m TTL)`);
  } else {
    progress.fail("Hermes CLI check failed (cache not written).");
  }

  return {
    available,
    installed,
    installedAt,
    version,
    command,
    globalBinDir,
    shellCommandPath,
  };
}

async function probeGateway(
  hermesCommand: string,
  profile: string,
  gatewayPort?: number,
): Promise<{ ok: boolean; detail?: string }> {
  const env = gatewayPort
    ? { ...process.env, OPENCLAW_GATEWAY_PORT: String(gatewayPort) }
    : undefined;
  const result = await runHermes(
    hermesCommand,
    ["--profile", profile, "health", "--json"],
    12_000,
    "capture",
    env,
  ).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    return {
      code: 1,
      stdout: "",
      stderr: message,
    } as SpawnResult;
  });
  if (result.code === 0) {
    return { ok: true };
  }
  return {
    ok: false,
    detail: firstNonEmptyLine(result.stderr, result.stdout),
  };
}

function readLogTail(logPath: string, maxLines = 16): string | undefined {
  if (!existsSync(logPath)) {
    return undefined;
  }
  try {
    const lines = readFileSync(logPath, "utf-8")
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);
    if (lines.length === 0) {
      return undefined;
    }
    return lines.slice(-maxLines).join("\n");
  } catch {
    return undefined;
  }
}

function resolveLatestRuntimeLogPath(): string | undefined {
  const runtimeLogDir = "/tmp/hermes";
  if (!existsSync(runtimeLogDir)) {
    return undefined;
  }
  try {
    const files = readdirSync(runtimeLogDir)
      .filter((name) => /^hermes-.*\.log$/u.test(name))
      .toSorted((a, b) => b.localeCompare(a));
    if (files.length === 0) {
      return undefined;
    }
    return path.join(runtimeLogDir, files[0]);
  } catch {
    return undefined;
  }
}

function collectGatewayLogExcerpts(stateDir: string): GatewayLogExcerpt[] {
  const candidates = [
    path.join(stateDir, "logs", "gateway.err.log"),
    path.join(stateDir, "logs", "gateway.log"),
    resolveLatestRuntimeLogPath(),
  ].filter((candidate): candidate is string => Boolean(candidate));

  const excerpts: GatewayLogExcerpt[] = [];
  for (const candidate of candidates) {
    const excerpt = readLogTail(candidate);
    if (!excerpt) {
      continue;
    }
    excerpts.push({ path: candidate, excerpt });
  }
  return excerpts;
}

function deriveGatewayFailureSummary(
  probeDetail: string | undefined,
  excerpts: GatewayLogExcerpt[],
): string | undefined {
  const combinedLines = excerpts.flatMap((entry) => entry.excerpt.split(/\r?\n/));
  const signalRegex =
    /(cannot find module|plugin not found|invalid config|unauthorized|token mismatch|device token mismatch|device signature invalid|device signature expired|device-signature|eaddrinuse|address already in use|error:|failed to|failovererror)/iu;
  const likely = [...combinedLines].toReversed().find((line) => signalRegex.test(line));
  if (likely) {
    return likely.length > 220 ? `${likely.slice(0, 217)}...` : likely;
  }
  return probeDetail;
}

async function attemptGatewayAutoFix(params: {
  hermesCommand: string;
  profile: string;
  stateDir: string;
  gatewayPort: number;
}): Promise<GatewayAutoFixResult> {
  const steps: GatewayAutoFixStep[] = [];
  const commands: Array<{
    name: string;
    args: string[];
    timeoutMs: number;
  }> = [
    {
      name: "hermes gateway stop",
      args: ["--profile", params.profile, "gateway", "stop"],
      timeoutMs: 90_000,
    },
    {
      name: "hermes doctor --fix",
      args: ["--profile", params.profile, "doctor", "--fix"],
      timeoutMs: 2 * 60_000,
    },
    {
      name: "hermes gateway install --force",
      args: [
        "--profile",
        params.profile,
        "gateway",
        "install",
        "--force",
      ],
      timeoutMs: 2 * 60_000,
    },
    {
      name: "hermes gateway restart",
      args: ["--profile", params.profile, "gateway", "restart"],
      timeoutMs: 2 * 60_000,
    },
  ];

  for (const command of commands) {
    const result = await runHermes(params.hermesCommand, command.args, command.timeoutMs).catch(
      (error) => {
        const message = error instanceof Error ? error.message : String(error);
        return {
          code: 1,
          stdout: "",
          stderr: message,
        } as SpawnResult;
      },
    );
    steps.push({
      name: command.name,
      ok: result.code === 0,
      detail: result.code === 0 ? undefined : firstNonEmptyLine(result.stderr, result.stdout),
    });
  }

  let finalProbe = await probeGateway(params.hermesCommand, params.profile, params.gatewayPort);
  for (let attempt = 0; attempt < 4 && !finalProbe.ok; attempt += 1) {
    await sleep(1_000);
    finalProbe = await probeGateway(params.hermesCommand, params.profile, params.gatewayPort);
  }

  const logExcerpts = finalProbe.ok ? [] : collectGatewayLogExcerpts(params.stateDir);
  const failureSummary = finalProbe.ok
    ? undefined
    : deriveGatewayFailureSummary(finalProbe.detail, logExcerpts);

  return {
    attempted: true,
    recovered: finalProbe.ok,
    steps,
    finalProbe,
    failureSummary,
    logExcerpts,
  };
}

async function openUrl(url: string): Promise<boolean> {
  const argv =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  const result = await runCommandWithTimeout(argv, { timeoutMs: 5_000 }).catch(() => null);
  return Boolean(result && result.code === 0);
}

function remediationForGatewayFailure(
  detail: string | undefined,
  port: number,
  profile: string,
): string {
  const normalized = detail?.toLowerCase() ?? "";
  const isDeviceAuthMismatch =
    normalized.includes("device token mismatch") ||
    normalized.includes("device signature invalid") ||
    normalized.includes("device signature expired") ||
    normalized.includes("device-signature");
  if (isDeviceAuthMismatch) {
    return [
      `Gateway device-auth mismatch detected. Re-run \`hermes --profile ${profile} onboard --install-daemon --reset\`.`,
      `Last resort (security downgrade): \`hermes --profile ${profile} config set gateway.controlUi.dangerouslyDisableDeviceAuth true\`. Revert after recovery: \`hermes --profile ${profile} config set gateway.controlUi.dangerouslyDisableDeviceAuth false\`.`,
    ].join(" ");
  }
  if (normalized.includes("missing scope")) {
    return [
      `Gateway scope check failed (${detail}).`,
      `Re-run \`hermes --profile ${profile} onboard --install-daemon --reset\` to re-pair with full operator scopes.`,
      `If the problem persists, set OPENCLAW_GATEWAY_PASSWORD and restart the web runtime.`,
    ].join(" ");
  }
  if (
    normalized.includes("unauthorized") ||
    normalized.includes("token") ||
    normalized.includes("password")
  ) {
    return `Gateway auth mismatch detected. Re-run \`hermes --profile ${profile} onboard --install-daemon --reset\`.`;
  }
  if (normalized.includes("address already in use") || normalized.includes("eaddrinuse")) {
    return `Port ${port} is busy. The bootstrap will auto-assign an available port, or you can explicitly specify one with \`--gateway-port <port>\`.`;
  }
  return `Run \`hermes --profile ${profile} doctor --fix\` and retry \`npx usefulcrm bootstrap\`.`;
}

function remediationForWebUiFailure(port: number): string {
  return [
    `Web UI did not respond on ${port}.`,
    `Run \`npx usefulcrm update --web-port ${port}\` to refresh the managed web runtime.`,
    `If the port is stuck, run \`npx usefulcrm stop --web-port ${port}\` first.`,
  ].join(" ");
}

function describeWorkspaceSeedResult(result: WorkspaceSeedResult): string {
  if (result.seeded) {
    return `seeded ${result.dbPath}`;
  }
  if (result.reason === "already-exists") {
    return `skipped; existing database found at ${result.dbPath}`;
  }
  if (result.reason === "seed-asset-missing") {
    return `skipped; seed asset missing at ${result.seedDbPath}`;
  }
  if (result.reason === "copy-failed") {
    return `failed to copy seed database: ${result.error ?? "unknown error"}`;
  }
  return `skipped; reason=${result.reason}`;
}

function createCheck(
  id: BootstrapCheck["id"],
  status: BootstrapCheckStatus,
  detail: string,
  remediation?: string,
): BootstrapCheck {
  return { id, status, detail, remediation };
}

/**
 * Load Hermes profile config from state dir.
 * Supports both hermes.json (current) and config.json (legacy).
 */
function readBootstrapConfig(stateDir: string): Record<string, unknown> | undefined {
  for (const name of ["hermes.json", "config.json"]) {
    const configPath = path.join(stateDir, name);
    if (!existsSync(configPath)) {
      continue;
    }
    try {
      const raw = json5.parse(readFileSync(configPath, "utf-8"));
      if (raw && typeof raw === "object") {
        return raw as Record<string, unknown>;
      }
    } catch {
      // Config unreadable; skip.
    }
  }
  return undefined;
}

function resolveBootstrapWorkspaceDir(stateDir: string): string {
  return path.join(stateDir, "workspace");
}

/**
 * Resolve the model provider prefix from the config's primary model string.
 * e.g. "vercel-ai-gateway/anthropic/claude-opus-4.6" → "vercel-ai-gateway"
 */
function resolveModelProvider(stateDir: string): string | undefined {
  const raw = readBootstrapConfig(stateDir);
  const model = (raw as { agents?: { defaults?: { model?: { primary?: string } | string } } })
    ?.agents?.defaults?.model;
  const modelName = typeof model === "string" ? model : model?.primary;
  if (typeof modelName === "string" && modelName.includes("/")) {
    return modelName.split("/")[0];
  }
  return undefined;
}

/**
 * Check if the agent auth store has at least one key for the given provider.
 */
export function checkAgentAuth(
  stateDir: string,
  provider: string | undefined,
): { ok: boolean; provider?: string; detail: string } {
  if (!provider) {
    return { ok: false, detail: "No model provider configured." };
  }
  const rawConfig = readBootstrapConfig(stateDir) as {
    models?: {
      providers?: Record<string, unknown>;
    };
  } | undefined;
  const customProvider = rawConfig?.models?.providers?.[provider];
  if (customProvider && typeof customProvider === "object") {
    const apiKey = (customProvider as Record<string, unknown>).apiKey;
    if (
      (typeof apiKey === "string" && apiKey.trim().length > 0) ||
      (apiKey && typeof apiKey === "object")
    ) {
      return {
        ok: true,
        provider,
        detail: `Custom provider credentials configured for ${provider}.`,
      };
    }
  }
  const authPath = path.join(stateDir, "agents", "main", "agent", "auth-profiles.json");
  if (!existsSync(authPath)) {
    return {
      ok: false,
      provider,
      detail: `No auth-profiles.json found for agent (expected at ${authPath}).`,
    };
  }
  try {
    const raw = json5.parse(readFileSync(authPath, "utf-8"));
    const profiles = raw?.profiles;
    if (!profiles || typeof profiles !== "object") {
      return { ok: false, provider, detail: `auth-profiles.json has no profiles configured.` };
    }
    const hasKey = Object.values(profiles).some(
      (p: unknown) =>
        p &&
        typeof p === "object" &&
        (p as Record<string, unknown>).provider === provider &&
        typeof (p as Record<string, unknown>).key === "string" &&
        ((p as Record<string, unknown>).key as string).length > 0,
    );
    if (!hasKey) {
      return {
        ok: false,
        provider,
        detail: `No API key for provider "${provider}" in agent auth store.`,
      };
    }
    return { ok: true, provider, detail: `API key configured for ${provider}.` };
  } catch {
    return { ok: false, provider, detail: `Failed to read auth-profiles.json.` };
  }
}

export function buildBootstrapDiagnostics(params: {
  profile: string;
  openClawCliAvailable: boolean;
  openClawVersion?: string;
  gatewayPort: number;
  gatewayUrl: string;
  gatewayProbe: { ok: boolean; detail?: string };
  webPort: number;
  webReachable: boolean;
  rolloutStage: BootstrapRolloutStage;
  legacyFallbackEnabled: boolean;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
  posthogPluginInstalled?: boolean;
}): BootstrapDiagnostics {
  const env = params.env ?? process.env;
  const checks: BootstrapCheck[] = [];

  if (params.openClawCliAvailable) {
    checks.push(
      createCheck(
        "hermes-cli",
        "pass",
        `Hermes CLI detected${params.openClawVersion ? ` (${params.openClawVersion})` : ""}.`,
      ),
    );
  } else {
    checks.push(
      createCheck(
        "hermes-cli",
        "fail",
        "Hermes CLI is missing.",
        "Install Hermes globally once: `npm install -g hermes`.",
      ),
    );
  }

  if (params.profile === DEFAULT_DENCHCLAW_PROFILE) {
    checks.push(createCheck("profile", "pass", `Profile pinned: ${params.profile}.`));
  } else {
    checks.push(
      createCheck(
        "profile",
        "fail",
        `UsefulCRM profile drift detected (${params.profile}).`,
        `UsefulCRM requires \`--profile ${DEFAULT_DENCHCLAW_PROFILE}\`. Re-run bootstrap to repair environment defaults.`,
      ),
    );
  }

  if (params.gatewayProbe.ok) {
    checks.push(createCheck("gateway", "pass", `Gateway reachable at ${params.gatewayUrl}.`));
  } else {
    checks.push(
      createCheck(
        "gateway",
        "fail",
        `Gateway probe failed at ${params.gatewayUrl}${params.gatewayProbe.detail ? ` (${params.gatewayProbe.detail})` : ""}.`,
        remediationForGatewayFailure(
          params.gatewayProbe.detail,
          params.gatewayPort,
          params.profile,
        ),
      ),
    );
  }

  const stateDir = params.stateDir ?? resolveProfileStateDir(params.profile, env);
  const modelProvider = resolveModelProvider(stateDir);
  const authCheck = checkAgentAuth(stateDir, modelProvider);
  if (authCheck.ok) {
    checks.push(createCheck("agent-auth", "pass", authCheck.detail));
  } else {
    checks.push(
      createCheck(
        "agent-auth",
        "fail",
        authCheck.detail,
        `Run \`hermes --profile ${DEFAULT_DENCHCLAW_PROFILE} onboard --install-daemon\` to configure API keys.`,
      ),
    );
  }

  if (params.webReachable) {
    checks.push(createCheck("web-ui", "pass", `Web UI reachable on port ${params.webPort}.`));
  } else {
    checks.push(
      createCheck(
        "web-ui",
        "fail",
        `Web UI is not reachable on port ${params.webPort}.`,
        remediationForWebUiFailure(params.webPort),
      ),
    );
  }

  const expectedStateDir = resolveProfileStateDir(DEFAULT_DENCHCLAW_PROFILE, env);
  const usesPinnedStateDir = path.resolve(stateDir) === path.resolve(expectedStateDir);
  if (usesPinnedStateDir) {
    checks.push(createCheck("state-isolation", "pass", `State dir pinned: ${stateDir}.`));
  } else {
    checks.push(
      createCheck(
        "state-isolation",
        "fail",
        `Unexpected state dir: ${stateDir}.`,
        `UsefulCRM requires \`${expectedStateDir}\`. Re-run bootstrap to restore pinned defaults.`,
      ),
    );
  }

  const launchAgentLabel = resolveGatewayLaunchAgentLabel(params.profile);
  const expectedLaunchAgentLabel = resolveGatewayLaunchAgentLabel(DEFAULT_DENCHCLAW_PROFILE);
  if (launchAgentLabel === expectedLaunchAgentLabel) {
    checks.push(createCheck("daemon-label", "pass", `Gateway service label: ${launchAgentLabel}.`));
  } else {
    checks.push(
      createCheck(
        "daemon-label",
        "fail",
        `Gateway service label mismatch (${launchAgentLabel}).`,
        `UsefulCRM requires launch agent label ${expectedLaunchAgentLabel}.`,
      ),
    );
  }

  checks.push(
    createCheck(
      "rollout-stage",
      params.rolloutStage === "default" ? "pass" : "warn",
      `Bootstrap rollout stage: ${params.rolloutStage}${params.legacyFallbackEnabled ? " (legacy fallback enabled)" : ""}.`,
      params.rolloutStage === "beta"
        ? "Enable beta cutover by setting DENCHCLAW_BOOTSTRAP_BETA_OPT_IN=1."
        : undefined,
    ),
  );

  const migrationSuiteOk = isTruthyEnvValue(env.DENCHCLAW_BOOTSTRAP_MIGRATION_SUITE_OK);
  const onboardingE2EOk = isTruthyEnvValue(env.DENCHCLAW_BOOTSTRAP_ONBOARDING_E2E_OK);
  const enforceCutoverGates = isTruthyEnvValue(env.DENCHCLAW_BOOTSTRAP_ENFORCE_SAFETY_GATES);
  const cutoverGatePassed = migrationSuiteOk && onboardingE2EOk;
  checks.push(
    createCheck(
      "cutover-gates",
      cutoverGatePassed ? "pass" : enforceCutoverGates ? "fail" : "warn",
      `Cutover gate: migrationSuite=${migrationSuiteOk ? "pass" : "missing"}, onboardingE2E=${onboardingE2EOk ? "pass" : "missing"}.`,
      cutoverGatePassed
        ? undefined
        : "Run migration contracts + onboarding E2E and set DENCHCLAW_BOOTSTRAP_MIGRATION_SUITE_OK=1 and DENCHCLAW_BOOTSTRAP_ONBOARDING_E2E_OK=1 before full cutover.",
    ),
  );

  if (params.posthogPluginInstalled != null) {
    checks.push(
      createCheck(
        "posthog-analytics",
        params.posthogPluginInstalled ? "pass" : "warn",
        params.posthogPluginInstalled
          ? "PostHog analytics plugin installed."
          : "PostHog analytics plugin not installed (POSTHOG_KEY missing or extension not bundled).",
      ),
    );
  }

  return {
    rolloutStage: params.rolloutStage,
    legacyFallbackEnabled: params.legacyFallbackEnabled,
    checks,
    hasFailures: checks.some((check) => check.status === "fail"),
  };
}

function formatCheckStatus(status: BootstrapCheckStatus): string {
  if (status === "pass") {
    return theme.success("[ok]");
  }
  if (status === "warn") {
    return theme.warn("[warn]");
  }
  return theme.error("[fail]");
}

function logBootstrapChecklist(diagnostics: BootstrapDiagnostics, runtime: RuntimeEnv) {
  runtime.log("");
  runtime.log(theme.heading("Bootstrap checklist"));
  for (const check of diagnostics.checks) {
    runtime.log(`${formatCheckStatus(check.status)} ${check.detail}`);
    if (check.status !== "pass" && check.remediation) {
      runtime.log(theme.muted(`       remediation: ${check.remediation}`));
    }
  }
}

function isExplicitUsefulCloudRequest(opts: BootstrapOptions): boolean {
  return Boolean(
    opts.usefulCloud ||
      opts.usefulCloudApiKey?.trim() ||
      opts.usefulCloudModel?.trim() ||
      opts.usefulGatewayUrl?.trim(),
  );
}

function resolveUsefulCloudApiKeyCandidate(params: {
  opts: BootstrapOptions;
  existingApiKey?: string;
}): string | undefined {
  return (
    params.opts.usefulCloudApiKey?.trim() ||
    process.env.DENCH_CLOUD_API_KEY?.trim() ||
    process.env.DENCH_API_KEY?.trim() ||
    params.existingApiKey?.trim()
  );
}

async function promptForUsefulCloudApiKey(initialValue?: string): Promise<string | undefined> {
  const value = await text({
    message: stylePromptMessage("Paste your Useful Cloud API key"),
    placeholder: "useful_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    ...(initialValue ? { initialValue } : {}),
    validate: (input) => (input?.trim().length ? undefined : "API key is required."),
  });
  if (isCancel(value)) {
    return undefined;
  }
  return String(value).trim();
}

async function promptForUsefulCloudModel(params: {
  models: UsefulCloudCatalogModel[];
  initialStableId?: string;
}): Promise<string | undefined> {
  const sorted = [...params.models].sort((a, b) => {
    const aRec = a.id === RECOMMENDED_DENCH_CLOUD_MODEL_ID ? 0 : 1;
    const bRec = b.id === RECOMMENDED_DENCH_CLOUD_MODEL_ID ? 0 : 1;
    return aRec - bRec;
  });
  const selection = await select({
    message: stylePromptMessage("Choose your default Useful Cloud model"),
    options: sorted.map((model) => ({
      value: model.stableId,
      label: model.displayName,
      hint: formatUsefulCloudModelHint(model),
    })),
    ...(params.initialStableId ? { initialValue: params.initialStableId } : {}),
  });
  if (isCancel(selection)) {
    return undefined;
  }
  return String(selection);
}

async function applyUsefulCloudBootstrapConfig(params: {
  hermesCommand: string;
  profile: string;
  stateDir: string;
  gatewayUrl: string;
  apiKey: string;
  catalog: UsefulCloudCatalogLoadResult;
  selectedModel: string;
}): Promise<void> {
  const raw = readBootstrapConfig(params.stateDir) as {
    agents?: {
      defaults?: {
        models?: unknown;
      };
    };
  } | undefined;
  const existingAgentModels =
    raw?.agents?.defaults?.models && typeof raw.agents.defaults.models === "object"
      ? (raw.agents.defaults.models as Record<string, unknown>)
      : {};
  const configPatch = buildUsefulCloudConfigPatch({
    gatewayUrl: params.gatewayUrl,
    apiKey: params.apiKey,
    models: params.catalog.models,
  });
  const nextAgentModels = {
    ...existingAgentModels,
    ...((configPatch.agents?.defaults?.models as Record<string, unknown> | undefined) ?? {}),
  };

  await runHermesOrThrow({
    hermesCommand: params.hermesCommand,
    args: ["--profile", params.profile, "config", "set", "models.mode", "merge"],
    timeoutMs: 30_000,
    errorMessage: "Failed to set models.mode=merge for Useful Cloud.",
  });

  await setHermesConfigJson({
    hermesCommand: params.hermesCommand,
    profile: params.profile,
    key: "models.providers.useful-cloud",
    value: configPatch.models.providers["useful-cloud"],
    errorMessage: "Failed to configure models.providers.useful-cloud.",
  });

  await runHermesOrThrow({
    hermesCommand: params.hermesCommand,
    args: [
      "--profile",
      params.profile,
      "config",
      "set",
      "agents.defaults.model.primary",
      `useful-cloud/${params.selectedModel}`,
    ],
    timeoutMs: 30_000,
    errorMessage: "Failed to set the default Useful Cloud model.",
  });

  await setHermesConfigJson({
    hermesCommand: params.hermesCommand,
    profile: params.profile,
    key: "agents.defaults.models",
    value: nextAgentModels,
    errorMessage: "Failed to update agents.defaults.models for Useful Cloud.",
  });
}

async function resolveUsefulCloudBootstrapSelection(params: {
  opts: BootstrapOptions;
  nonInteractive: boolean;
  stateDir: string;
  runtime: RuntimeEnv;
}): Promise<UsefulCloudBootstrapSelection> {
  const rawConfig = readBootstrapConfig(params.stateDir);
  const existing = readConfiguredUsefulCloudSettings(rawConfig);
  const explicitRequest = isExplicitUsefulCloudRequest(params.opts);
  const currentProvider = resolveModelProvider(params.stateDir);
  const existingUsefulConfigured = currentProvider === "useful-cloud" && Boolean(existing.apiKey);
  const gatewayUrl = normalizeUsefulGatewayUrl(
    params.opts.usefulGatewayUrl?.trim() ||
      process.env.DENCH_GATEWAY_URL?.trim() ||
      existing.gatewayUrl ||
      DEFAULT_DENCH_CLOUD_GATEWAY_URL,
  );

  if (params.nonInteractive) {
    if (!explicitRequest && !existingUsefulConfigured) {
      return { enabled: false };
    }

    const apiKey = resolveUsefulCloudApiKeyCandidate({
      opts: params.opts,
      existingApiKey: existing.apiKey,
    });
    if (!apiKey) {
      throw new Error(
        "Useful Cloud bootstrap requires --useful-cloud-api-key or DENCH_CLOUD_API_KEY in non-interactive mode.",
      );
    }

    await validateUsefulCloudApiKey(gatewayUrl, apiKey);
    const catalog = await fetchUsefulCloudCatalog(gatewayUrl);
    const selected = resolveUsefulCloudModel(
      catalog.models,
      params.opts.usefulCloudModel?.trim() ||
        process.env.DENCH_CLOUD_MODEL?.trim() ||
        existing.selectedModel,
    );
    if (!selected) {
      throw new Error("Configured Useful Cloud model is not available.");
    }

    return {
      enabled: true,
      apiKey,
      gatewayUrl,
      selectedModel: selected.stableId,
      catalog,
    };
  }

  const wantsUsefulCloud = explicitRequest
    ? true
    : await confirm({
      message: stylePromptMessage(
        "Use Useful Cloud for inference? Get your API key at useful.com/api",
      ),
      initialValue: existingUsefulConfigured || !currentProvider,
    });
  if (isCancel(wantsUsefulCloud) || !wantsUsefulCloud) {
    return { enabled: false };
  }

  if (!params.nonInteractive) {
    await openUrl("https://useful.com/api").catch(() => {});
  }

  let apiKey = resolveUsefulCloudApiKeyCandidate({
    opts: params.opts,
    existingApiKey: existing.apiKey,
  });
  const showSpinners = !params.opts.json;

  while (true) {
    apiKey = await promptForUsefulCloudApiKey(apiKey);
    if (!apiKey) {
      throw new Error("Useful Cloud setup cancelled before an API key was provided.");
    }

    const keySpinner = showSpinners ? spinner() : null;
    keySpinner?.start("Validating API key…");
    try {
      await validateUsefulCloudApiKey(gatewayUrl, apiKey);
      keySpinner?.stop("API key is valid.");
    } catch (error) {
      keySpinner?.stop("API key validation failed.");
      params.runtime.log(theme.warn(error instanceof Error ? error.message : String(error)));
      const retry = await confirm({
        message: stylePromptMessage("Try another Useful Cloud API key?"),
        initialValue: true,
      });
      if (isCancel(retry) || !retry) {
        throw error instanceof Error ? error : new Error(String(error));
      }
      continue;
    }

    const catalogSpinner = showSpinners ? spinner() : null;
    catalogSpinner?.start("Fetching available models…");
    const catalog = await fetchUsefulCloudCatalog(gatewayUrl);
    if (catalog.source === "fallback") {
      catalogSpinner?.stop(
        `Model catalog fallback active (${catalog.detail ?? "public catalog unavailable"}).`,
      );
    } else {
      catalogSpinner?.stop("Models loaded.");
    }

    const explicitModel = params.opts.usefulCloudModel?.trim() || process.env.DENCH_CLOUD_MODEL?.trim();
    const preselected = resolveUsefulCloudModel(catalog.models, explicitModel || existing.selectedModel);
    if (!preselected && explicitModel) {
      params.runtime.log(theme.warn(`Configured Useful Cloud model "${explicitModel}" is unavailable.`));
    }
    const selection = await promptForUsefulCloudModel({
      models: catalog.models,
      initialStableId: preselected?.stableId || existing.selectedModel,
    });
    if (!selection) {
      throw new Error("Useful Cloud setup cancelled during model selection.");
    }
    const selected = resolveUsefulCloudModel(catalog.models, selection);
    if (!selected) {
      throw new Error("No Useful Cloud model could be selected.");
    }

    const verifySpinner = showSpinners ? spinner() : null;
    verifySpinner?.start("Verifying Useful Cloud configuration…");
    try {
      await validateUsefulCloudApiKey(gatewayUrl, apiKey);
      verifySpinner?.stop("Useful Cloud ready.");
    } catch (error) {
      verifySpinner?.stop("Verification failed.");
      params.runtime.log(
        theme.warn(error instanceof Error ? error.message : String(error)),
      );
      const retry = await confirm({
        message: stylePromptMessage("Re-enter your Useful Cloud API key?"),
        initialValue: true,
      });
      if (isCancel(retry) || !retry) {
        throw error instanceof Error ? error : new Error(String(error));
      }
      continue;
    }

    return {
      enabled: true,
      apiKey,
      gatewayUrl,
      selectedModel: selected.stableId,
      catalog,
    };
  }
}

async function shouldRunUpdate(params: {
  opts: BootstrapOptions;
  runtime: RuntimeEnv;
  installResult: HermesCliAvailability;
}): Promise<boolean> {
  if (params.opts.updateNow) {
    return true;
  }
  if (
    params.opts.skipUpdate ||
    params.opts.nonInteractive ||
    params.opts.json ||
    !process.stdin.isTTY
  ) {
    return false;
  }
  const installedRecently =
    params.installResult.installed ||
    (typeof params.installResult.installedAt === "number" &&
      Date.now() - params.installResult.installedAt <=
        OPENCLAW_UPDATE_PROMPT_SUPPRESS_AFTER_INSTALL_MS);
  if (installedRecently) {
    params.runtime.log(
      theme.muted("Skipping update prompt because Hermes was installed moments ago."),
    );
    return false;
  }
  const decision = await confirm({
    message: stylePromptMessage("Check and install Hermes updates now?"),
    initialValue: false,
  });
  if (isCancel(decision)) {
    params.runtime.log(theme.muted("Update check skipped."));
    return false;
  }
  return Boolean(decision);
}

export async function bootstrapCommand(
  opts: BootstrapOptions,
  runtime: RuntimeEnv = defaultRuntime,
): Promise<BootstrapSummary> {
  const nonInteractive = Boolean(opts.nonInteractive || opts.json);
  const rolloutStage = resolveBootstrapRolloutStage();
  const legacyFallbackEnabled = isLegacyFallbackEnabled();
  const appliedProfile = applyCliProfileEnv({ profile: opts.profile });
  const profile = appliedProfile.effectiveProfile;
  const stateDir = resolveProfileStateDir(profile);
  const workspaceDir = resolveBootstrapWorkspaceDir(stateDir);
  if (appliedProfile.warning && !opts.json) {
    runtime.log(theme.warn(appliedProfile.warning));
  }

  const daemonless = isDaemonlessMode(opts);
  const bootstrapStartTime = Date.now();

  if (!opts.json) {
    const telemetryCfg = readTelemetryConfig();
    if (!telemetryCfg.noticeShown) {
      runtime.log(
        theme.muted(
          "Useful collects anonymous telemetry to improve the product.\n" +
            "No personal data is ever collected. Disable anytime:\n" +
            "  npx usefulcrm telemetry disable\n" +
            "  DENCHCLAW_TELEMETRY_DISABLED=1\n" +
            "  DO_NOT_TRACK=1\n" +
            "Learn more: https://github.com/UsefulHQ/UsefulCRM/blob/main/TELEMETRY.md\n",
        ),
      );
      markNoticeShown();
    }
  }

  track("cli_bootstrap_started", { version: VERSION });

  const installResult = await ensureHermesCliAvailable({
    stateDir,
    showProgress: !opts.json,
  });
  if (!installResult.available) {
    throw new Error(
      [
        "Hermes CLI is required but unavailable.",
        "Install it with: npm install -g hermes",
        installResult.globalBinDir
          ? `Expected global binary directory: ${installResult.globalBinDir}`
          : "",
      ]
        .filter((line) => line.length > 0)
        .join("\n"),
    );
  }
  const hermesCommand = installResult.command;

  if (await shouldRunUpdate({ opts, runtime, installResult })) {
    await runHermesWithProgress({
      hermesCommand,
      args: ["update", "--yes"],
      timeoutMs: 8 * 60_000,
      startMessage: "Checking for Hermes updates...",
      successMessage: "Hermes is up to date.",
      errorMessage: "Hermes update failed",
    });
  }

  // Determine gateway port: use explicit override, honour previously persisted
  // port, or find an available one in the UsefulCRM range (19001+).
  // NEVER claim Hermes's default port (18789) — that belongs to the host
  // Hermes installation and sharing it causes port-hijack on restart.
  //
  // When a persisted port exists, trust it unconditionally — the process
  // occupying it is almost certainly our own gateway from a previous run.
  // The onboard step will stop/replace the existing daemon on the same profile.
  // Only scan for a free port on first run (no persisted port) when 19001 is
  // occupied by something external.
  const preCloudSpinner = !opts.json ? spinner() : null;
  preCloudSpinner?.start("Preparing gateway configuration…");

  const explicitPort = parseOptionalPort(opts.gatewayPort);
  let gatewayPort: number;
  let portAutoAssigned = false;

  if (explicitPort) {
    gatewayPort = explicitPort;
  } else {
    const existingPort = readExistingGatewayPort(stateDir);
    if (isPersistedPortAcceptable(existingPort)) {
      gatewayPort = existingPort;
    } else if (await isPortAvailable(DENCHCLAW_GATEWAY_PORT_START)) {
      gatewayPort = DENCHCLAW_GATEWAY_PORT_START;
    } else {
      preCloudSpinner?.message("Scanning for available port…");
      const availablePort = await findAvailablePort(
        DENCHCLAW_GATEWAY_PORT_START + 1,
        MAX_PORT_SCAN_ATTEMPTS,
      );
      if (!availablePort) {
        preCloudSpinner?.stop("Port scan failed.");
        throw new Error(
          `Could not find an available gateway port between ${DENCHCLAW_GATEWAY_PORT_START} and ${DENCHCLAW_GATEWAY_PORT_START + MAX_PORT_SCAN_ATTEMPTS}. ` +
            `Please specify a port explicitly with --gateway-port.`,
        );
      }
      gatewayPort = availablePort;
      portAutoAssigned = true;
    }
  }

  if (portAutoAssigned && !opts.json) {
    runtime.log(
      theme.muted(
        `Default gateway port ${DENCHCLAW_GATEWAY_PORT_START} is in use. Using auto-assigned port ${gatewayPort}.`,
      ),
    );
  }

  // Stage workspace, gateway mode, and gateway port directly into the raw JSON
  // config file.  On a fresh install the "useful" profile doesn't exist yet
  // (it's created by `hermes onboard`), so any `hermes config set` call
  // would fail.  Writing directly sidesteps this; the CLI-based re-application
  // happens post-onboard once the profile is live.
  mkdirSync(workspaceDir, { recursive: true });
  preCloudSpinner?.message("Staging pre-onboard config…");
  stagePreOnboardConfig(stateDir, {
    workspaceDir,
    gatewayMode: "local",
    gatewayPort,
  });

  preCloudSpinner?.stop("Gateway ready.");

  const usefulCloudSelection = await resolveUsefulCloudBootstrapSelection({
    opts,
    nonInteractive,
    stateDir,
    runtime,
  });

  const packageRoot = resolveCliPackageRoot();
  const managedBundledPlugins: BundledPluginSpec[] = [
    {
      pluginId: "posthog-analytics",
      sourceDirName: "posthog-analytics",
      ...(process.env.POSTHOG_KEY
        ? {
          enabled: true,
          config: {
            apiKey: process.env.POSTHOG_KEY,
          },
        }
        : {}),
    },
    {
      pluginId: "useful-ai-gateway",
      sourceDirName: "useful-ai-gateway",
      enabled: true,
      config: {
        gatewayUrl:
          usefulCloudSelection.gatewayUrl ||
          opts.usefulGatewayUrl?.trim() ||
          process.env.DENCH_GATEWAY_URL?.trim() ||
          DEFAULT_DENCH_CLOUD_GATEWAY_URL,
      },
    },
    {
      pluginId: "useful-identity",
      sourceDirName: "useful-identity",
      enabled: true,
    },
  ];

  // Trust managed bundled plugins BEFORE onboard so the gateway daemon never
  // starts with transient "untracked local plugin" warnings for UsefulCRM-owned
  // extensions.
  const preOnboardSpinner = !opts.json ? spinner() : null;
  preOnboardSpinner?.start("Syncing bundled plugins…");
  const preOnboardPlugins = await syncBundledPlugins({
    hermesCommand,
    profile,
    stateDir,
    plugins: managedBundledPlugins,
  });
  const posthogPluginInstalled = preOnboardPlugins.installedPluginIds.includes("posthog-analytics");

  // All pre-onboard config (workspace, gateway mode/port, plugin trust) is now
  // staged via raw JSON writes above — no CLI calls needed before the profile
  // exists.  syncBundledPlugins already wrote plugins.allow / plugins.load.paths
  // to the raw JSON file.  Post-onboard re-application via the CLI happens after
  // `hermes onboard` creates the profile.

  preOnboardSpinner?.stop("Ready to onboard.");

  const onboardArgv = [
    "--profile",
    profile,
    "onboard",
    ...(daemonless ? [] : ["--install-daemon"]),
    "--gateway-bind",
    "loopback",
    "--gateway-port",
    String(gatewayPort),
  ];
  if (opts.forceOnboard) {
    onboardArgv.push("--reset");
  }
  if (nonInteractive) {
    onboardArgv.push("--non-interactive");
  }
  if (usefulCloudSelection.enabled) {
    onboardArgv.push("--auth-choice", "skip");
  }

  onboardArgv.push("--accept-risk", "--skip-ui");
  if (daemonless) {
    onboardArgv.push("--skip-health");
  }

  if (nonInteractive) {
    await runHermesOrThrow({
      hermesCommand,
      args: onboardArgv,
      timeoutMs: 12 * 60_000,
      errorMessage: "Hermes onboarding failed.",
    });
  } else {
    await runHermesInteractiveOrThrow({
      hermesCommand,
      args: onboardArgv,
      timeoutMs: 12 * 60_000,
      errorMessage: "Hermes onboarding failed.",
    });
  }

  const workspaceSeed = seedWorkspaceFromAssets({
    workspaceDir,
    packageRoot,
  });

  const postOnboardSpinner = !opts.json ? spinner() : null;
  postOnboardSpinner?.start("Finalizing configuration…");

  // ── Post-onboard config reconciliation ──
  // Apply all Useful-owned settings via the CLI now that onboard has created the
  // profile.  Pre-onboard config was staged via raw JSON writes (the profile
  // didn't exist for CLI calls); this pass enforces the values through
  // Hermes's own config resolution and guards against onboard wizard drift.
  await ensureDefaultWorkspacePath(hermesCommand, profile, workspaceDir);
  postOnboardSpinner?.message("Configuring gateway…");
  await ensureGatewayModeLocal(hermesCommand, profile);
  postOnboardSpinner?.message("Configuring gateway port…");
  await ensureGatewayPort(hermesCommand, profile, gatewayPort);
  postOnboardSpinner?.message("Setting tools profile…");
  await ensureToolsProfile(hermesCommand, profile);

  if (
    usefulCloudSelection.enabled &&
    usefulCloudSelection.apiKey &&
    usefulCloudSelection.gatewayUrl &&
    usefulCloudSelection.selectedModel &&
    usefulCloudSelection.catalog
  ) {
    postOnboardSpinner?.message("Applying Useful Cloud model config…");
    await applyUsefulCloudBootstrapConfig({
      hermesCommand,
      profile,
      stateDir,
      gatewayUrl: usefulCloudSelection.gatewayUrl,
      apiKey: usefulCloudSelection.apiKey,
      catalog: usefulCloudSelection.catalog,
      selectedModel: usefulCloudSelection.selectedModel,
    });
  }

  postOnboardSpinner?.message("Refreshing managed plugin config…");
  await syncBundledPlugins({
    hermesCommand,
    profile,
    stateDir,
    plugins: managedBundledPlugins,
  });

  postOnboardSpinner?.message("Configuring agent defaults…");
  await ensureAgentDefaults(hermesCommand, profile);

  // ── Gateway daemon restart + readiness verification ──
  // Skipped entirely in daemonless mode — the user manages the gateway process
  // externally (e.g. `hermes gateway --port <port>` as a foreground process).
  let gatewayProbe: { ok: boolean; detail?: string };
  let gatewayAutoFix: GatewayAutoFixResult | undefined;

  if (daemonless) {
    gatewayProbe = { ok: true, detail: "skipped (daemonless)" };
  } else {
    // All Useful-owned config has been applied.  Restart the gateway once so the
    // daemon picks up plugin, model, and subagent changes that were written after
    // onboard started it.  No helper above triggers its own restart.
    postOnboardSpinner?.message("Restarting gateway…");
    try {
      await runHermesOrThrow({
        hermesCommand,
        args: ["--profile", profile, "gateway", "restart"],
        timeoutMs: 60_000,
        errorMessage: "Failed to restart gateway after config update.",
      });
    } catch {
      // Gateway may not be running (e.g. onboard daemon install failed on this
      // platform).  The final readiness check below will catch this.
    }

    // Give the gateway time to finish starting after the restart, then verify
    // readiness.  The probe retries here replace the old pattern of probing
    // immediately (which raced gateway startup) and jumping straight into a
    // destructive stop/install/start auto-fix cycle.
    postOnboardSpinner?.message("Waiting for gateway…");
    gatewayProbe = await probeGateway(hermesCommand, profile, gatewayPort);
    for (let attempt = 0; attempt < 4 && !gatewayProbe.ok; attempt += 1) {
      await sleep(750);
      postOnboardSpinner?.message(`Probing gateway health (attempt ${attempt + 2}/5)…`);
      gatewayProbe = await probeGateway(hermesCommand, profile, gatewayPort);
    }

    // Repair is failure-only: only invoked when the retried final verification
    // still reports the gateway as unreachable.
    if (!gatewayProbe.ok) {
      postOnboardSpinner?.message("Gateway unreachable, attempting auto-fix…");
      gatewayAutoFix = await attemptGatewayAutoFix({
        hermesCommand,
        profile,
        stateDir,
        gatewayPort,
      });
      gatewayProbe = gatewayAutoFix.finalProbe;
      if (!gatewayProbe.ok && gatewayAutoFix.failureSummary) {
        gatewayProbe = {
          ...gatewayProbe,
          detail: [gatewayProbe.detail, gatewayAutoFix.failureSummary]
            .filter((value, index, self) => value && self.indexOf(value) === index)
            .join(" | "),
        };
      }
    }
  }
  const gatewayUrl = `ws://127.0.0.1:${gatewayPort}`;
  const preferredWebPort = parseOptionalPort(opts.webPort) ?? DEFAULT_WEB_APP_PORT;
  postOnboardSpinner?.message(`Starting web runtime on port ${preferredWebPort}…`);
  let webRuntimeStatus = await ensureManagedWebRuntime({
    stateDir,
    packageRoot,
    usefulVersion: VERSION,
    port: preferredWebPort,
    gatewayPort,
  });

  // Bootstrap should finish with the local CLI device paired so the Control UI
  // and follow-up commands do not rely on loopback fallback or manual approval.
  postOnboardSpinner?.message("Checking local device pairing…");
  const devicePairing = await attemptBootstrapDevicePairing({
    hermesCommand,
    profile,
    pollAttempts: webRuntimeStatus.ready
      ? READY_WEB_DEVICE_PAIRING_POLL_ATTEMPTS
      : UNREADY_WEB_DEVICE_PAIRING_POLL_ATTEMPTS,
  });
  if (!webRuntimeStatus.ready && devicePairing.status === "approved") {
    postOnboardSpinner?.message("Waiting for web runtime after pairing…");
    const webRuntimeRetry = await waitForWebRuntime(preferredWebPort);
    webRuntimeStatus = {
      ready: webRuntimeRetry.ok,
      reason: webRuntimeRetry.reason,
    };
  }

  postOnboardSpinner?.stop(
    webRuntimeStatus.ready
      ? "Post-onboard setup complete."
      : "Post-onboard setup complete (web runtime unhealthy).",
  );
  const webReachable = webRuntimeStatus.ready;
  const webUrl = `http://localhost:${preferredWebPort}`;
  const diagnostics = buildBootstrapDiagnostics({
    profile,
    openClawCliAvailable: installResult.available,
    openClawVersion: installResult.version,
    gatewayPort,
    gatewayUrl,
    gatewayProbe,
    webPort: preferredWebPort,
    webReachable,
    rolloutStage,
    legacyFallbackEnabled,
    stateDir,
    posthogPluginInstalled,
  });

  let opened = false;
  let openAttempted = false;
  if (!opts.noOpen && !opts.json && webReachable) {
    if (nonInteractive) {
      openAttempted = true;
      opened = await openUrl(webUrl);
    } else {
      const wantOpen = await confirm({
        message: stylePromptMessage(`Open ${webUrl} in your browser?`),
        initialValue: true,
      });
      if (!isCancel(wantOpen) && wantOpen) {
        openAttempted = true;
        opened = await openUrl(webUrl);
      }
    }
  }

  if (!opts.json) {
    if (!webRuntimeStatus.ready) {
      runtime.log(theme.warn(`Managed web runtime check failed: ${webRuntimeStatus.reason}`));
    }
    if (devicePairing.status === "approved") {
      runtime.log(theme.muted("Approved the pending local Hermes device pairing request."));
    } else if (devicePairing.status === "ambiguous") {
      runtime.log(theme.warn(`Automatic device pairing skipped: ${devicePairing.detail}.`));
      runtime.log(
        theme.muted(
          `Run \`hermes --profile ${profile} devices list\` and approve the correct request manually.`,
        ),
      );
    } else if (devicePairing.status === "failed") {
      runtime.log(theme.warn(`Automatic device pairing failed: ${devicePairing.detail}`));
      runtime.log(
        theme.muted(
          `If the Control UI still reports "pairing required", run \`hermes --profile ${profile} devices list\` and approve the pending request.`,
        ),
      );
    }
    if (installResult.installed) {
      runtime.log(theme.muted("Installed global Hermes CLI via npm."));
    }
    if (isProjectLocalHermesPath(installResult.shellCommandPath)) {
      runtime.log(
        theme.warn(
          `\`hermes\` currently resolves to a project-local binary (${installResult.shellCommandPath}).`,
        ),
      );
      runtime.log(
        theme.muted(
          `Bootstrap now uses the global binary (${hermesCommand}) to avoid repo-local drift.`,
        ),
      );
    } else if (!installResult.shellCommandPath && installResult.globalBinDir) {
      runtime.log(
        theme.warn("Global Hermes was installed, but `hermes` is not on shell PATH."),
      );
      runtime.log(
        theme.muted(
          `Add this to your shell profile, then open a new terminal: export PATH="${installResult.globalBinDir}:$PATH"`,
        ),
      );
    }

    runtime.log(theme.muted(`Workspace seed: ${describeWorkspaceSeedResult(workspaceSeed)}`));
    if (gatewayAutoFix?.attempted) {
      runtime.log(
        theme.muted(
          `Gateway auto-fix ${gatewayAutoFix.recovered ? "recovered connectivity" : "ran but gateway is still unhealthy"}.`,
        ),
      );
      for (const step of gatewayAutoFix.steps) {
        runtime.log(
          theme.muted(
            `  ${step.ok ? "[ok]" : "[fail]"} ${step.name}${step.detail ? ` (${step.detail})` : ""}`,
          ),
        );
      }
      if (!gatewayAutoFix.recovered && gatewayAutoFix.failureSummary) {
        runtime.log(theme.error(`Likely gateway cause: ${gatewayAutoFix.failureSummary}`));
      }
      if (!gatewayAutoFix.recovered && gatewayAutoFix.logExcerpts.length > 0) {
        runtime.log(theme.muted("Recent gateway logs:"));
        for (const excerpt of gatewayAutoFix.logExcerpts) {
          runtime.log(theme.muted(`  ${excerpt.path}`));
          for (const line of excerpt.excerpt.split(/\r?\n/)) {
            runtime.log(theme.muted(`    ${line}`));
          }
        }
      }
    }
    logBootstrapChecklist(diagnostics, runtime);
    runtime.log("");
    runtime.log(theme.heading("UsefulCRM ready"));
    runtime.log(`Profile: ${profile}`);
    runtime.log(`Hermes CLI: ${installResult.version ?? "detected"}`);
    runtime.log(`Gateway: ${gatewayProbe.ok ? "reachable" : "check failed"}`);
    runtime.log(`Web UI: ${webUrl}`);
    runtime.log(
      `Rollout stage: ${rolloutStage}${legacyFallbackEnabled ? " (legacy fallback enabled)" : ""}`,
    );
    if (!opened && openAttempted) {
      runtime.log(theme.muted("Browser open failed; copy/paste the URL above."));
    }
    if (diagnostics.hasFailures) {
      runtime.log(
        theme.warn(
          "Bootstrap completed with failing checks. Address remediation items above before full cutover.",
        ),
      );
    }
  }

  const summary: BootstrapSummary = {
    profile,
    onboarded: true,
    installedHermesCli: installResult.installed,
    openClawCliAvailable: installResult.available,
    openClawVersion: installResult.version,
    gatewayUrl,
    gatewayReachable: gatewayProbe.ok,
    gatewayAutoFix: gatewayAutoFix
      ? {
          attempted: gatewayAutoFix.attempted,
          recovered: gatewayAutoFix.recovered,
          steps: gatewayAutoFix.steps,
          failureSummary: gatewayAutoFix.failureSummary,
          logExcerpts: gatewayAutoFix.logExcerpts,
        }
      : undefined,
    workspaceSeed,
    webUrl,
    webReachable,
    webOpened: opened,
    diagnostics,
  };
  track("cli_bootstrap_completed", {
    duration_ms: Date.now() - bootstrapStartTime,
    workspace_created: Boolean(workspaceSeed),
    gateway_reachable: gatewayProbe.ok,
    web_reachable: webReachable,
    version: VERSION,
  });

  if (opts.json) {
    runtime.log(JSON.stringify(summary, null, 2));
  }
  return summary;
}
