import { PostHog } from "posthog-node";
import { readTelemetryConfig, getOrCreateAnonymousId, readPersonInfo } from "./config.js";
import type { PersonInfo } from "./config.js";
import { VERSION, resolveHermesVersion } from "../version.js";

const POSTHOG_KEY = process.env.POSTHOG_KEY || "";
const POSTHOG_HOST = "https://us.i.posthog.com";

let client: PostHog | null = null;
let _identified = false;

export function isTelemetryEnabled(): boolean {
  if (!POSTHOG_KEY) return false;
  if (process.env.DO_NOT_TRACK === "1") return false;
  if (process.env.DENCHCLAW_TELEMETRY_DISABLED === "1") return false;
  if (process.env.CI) return false;

  try {
    const config = readTelemetryConfig();
    if (!config.enabled) return false;
  } catch {
    // If config read fails, default to enabled.
  }

  return true;
}

function getMachineContext(): Record<string, unknown> {
  return {
    os: process.platform,
    arch: process.arch,
    node_version: process.version,
    usefulcrm_version: VERSION,
    hermes_version: resolveHermesVersion(),
  };
}

function ensureClient(): PostHog | null {
  if (!POSTHOG_KEY) return null;
  if (!client) {
    client = new PostHog(POSTHOG_KEY, {
      host: POSTHOG_HOST,
      flushAt: 5,
      flushInterval: 10_000,
    });
  }
  return client;
}

export function track(event: string, properties?: Record<string, unknown>): void {
  if (!isTelemetryEnabled()) return;

  if (process.env.DENCHCLAW_TELEMETRY_DEBUG === "1") {
    process.stderr.write(
      `[telemetry:debug] ${JSON.stringify({ event, properties }, null, 2)}\n`,
    );
    return;
  }

  const ph = ensureClient();
  if (!ph) return;

  const distinctId = getOrCreateAnonymousId();

  if (!_identified) {
    _identified = true;
    const person = readPersonInfo();
    if (person) {
      ph.identify({
        distinctId,
        properties: personInfoToPostHogProps(person),
      });
    }
  }

  ph.capture({
    distinctId,
    event,
    properties: {
      ...getMachineContext(),
      ...properties,
    },
  });
}

function personInfoToPostHogProps(person: PersonInfo): Record<string, string> {
  const props: Record<string, string> = {};
  if (person.name) props.$name = person.name;
  if (person.email) props.$email = person.email;
  if (person.avatar) props.$avatar = person.avatar;
  if (person.usefulOrgId) props.useful_org_id = person.usefulOrgId;
  return props;
}

export async function shutdownTelemetry(): Promise<void> {
  if (client) {
    await client.shutdown();
    client = null;
  }
}
