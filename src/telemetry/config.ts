import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveStateDir } from "../config/paths.js";

type TelemetryConfig = {
  enabled: boolean;
  noticeShown?: boolean;
  privacyMode?: boolean;
  anonymousId?: string;
  name?: string;
  email?: string;
  avatar?: string;
  usefulOrgId?: string;
};

export type PersonInfo = {
  name?: string;
  email?: string;
  avatar?: string;
  usefulOrgId?: string;
};

const TELEMETRY_FILENAME = "telemetry.json";

function telemetryConfigPath(): string {
  return join(resolveStateDir(), TELEMETRY_FILENAME);
}

export function readTelemetryConfig(): TelemetryConfig {
  const configPath = telemetryConfigPath();
  try {
    if (!existsSync(configPath)) {
      return { enabled: true };
    }
    const raw = JSON.parse(readFileSync(configPath, "utf-8")) as Partial<TelemetryConfig>;
    return {
      enabled: raw.enabled !== false,
      noticeShown: raw.noticeShown === true,
      privacyMode: raw.privacyMode !== false,
      anonymousId: typeof raw.anonymousId === "string" ? raw.anonymousId : undefined,
      name: typeof raw.name === "string" && raw.name ? raw.name : undefined,
      email: typeof raw.email === "string" && raw.email ? raw.email : undefined,
      avatar: typeof raw.avatar === "string" && raw.avatar ? raw.avatar : undefined,
      usefulOrgId: typeof raw.usefulOrgId === "string" && raw.usefulOrgId ? raw.usefulOrgId : undefined,
    };
  } catch {
    return { enabled: true };
  }
}

export function writeTelemetryConfig(config: Partial<TelemetryConfig>): void {
  const configPath = telemetryConfigPath();
  const existing = readTelemetryConfig();
  const merged = { ...existing, ...config };
  try {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  } catch {
    // Non-fatal: telemetry config write failure should never crash the CLI.
  }
}

export function markNoticeShown(): void {
  writeTelemetryConfig({ noticeShown: true });
}

export function isPrivacyModeEnabled(): boolean {
  const config = readTelemetryConfig();
  return config.privacyMode !== false;
}

/**
 * Read optional person identity fields from telemetry.json.
 * Returns null when no identity fields are set.
 */
export function readPersonInfo(): PersonInfo | null {
  const config = readTelemetryConfig();
  if (!config.name && !config.email && !config.avatar && !config.usefulOrgId) {
    return null;
  }
  const info: PersonInfo = {};
  if (config.name) info.name = config.name;
  if (config.email) info.email = config.email;
  if (config.avatar) info.avatar = config.avatar;
  if (config.usefulOrgId) info.usefulOrgId = config.usefulOrgId;
  return info;
}

let _cachedAnonymousId: string | null = null;

/**
 * Return the persisted install-scoped anonymous ID from telemetry.json,
 * generating and writing one on first access.
 */
export function getOrCreateAnonymousId(): string {
  if (_cachedAnonymousId) return _cachedAnonymousId;

  const configPath = telemetryConfigPath();
  try {
    let raw: Record<string, unknown> = {};
    if (existsSync(configPath)) {
      raw = JSON.parse(readFileSync(configPath, "utf-8"));
    }
    if (typeof raw.anonymousId === "string" && raw.anonymousId) {
      _cachedAnonymousId = raw.anonymousId;
      return raw.anonymousId;
    }
    const id = randomUUID();
    raw.anonymousId = id;
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(raw, null, 2) + "\n", "utf-8");
    _cachedAnonymousId = id;
    return id;
  } catch {
    const id = randomUUID();
    _cachedAnonymousId = id;
    return id;
  }
}
