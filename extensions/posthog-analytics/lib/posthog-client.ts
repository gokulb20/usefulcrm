const DEFAULT_HOST = "https://us.i.posthog.com";
const FLUSH_INTERVAL_MS = 15_000;
const FLUSH_AT = 10;

export interface CaptureEvent {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
}

/**
 * Minimal PostHog client using the HTTP capture API directly.
 * Zero npm dependencies -- uses built-in fetch (Node 18+).
 */
export class PostHogClient {
  private apiKey: string;
  private host: string;
  private globalProperties: Record<string, unknown>;
  private queue: Array<Record<string, unknown>> = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(apiKey: string, host?: string, globalProperties?: Record<string, unknown>) {
    this.apiKey = apiKey;
    this.host = (host || DEFAULT_HOST).replace(/\/$/, "");
    this.globalProperties = globalProperties ?? {};
    this.timer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
    if (this.timer.unref) this.timer.unref();
  }

  capture(event: CaptureEvent): void {
    this.queue.push({
      event: event.event,
      distinct_id: event.distinctId,
      properties: {
        ...this.globalProperties,
        ...event.properties,
        $lib: "usefulcrm-posthog-plugin",
      },
      timestamp: new Date().toISOString(),
    });

    if (this.queue.length >= FLUSH_AT) {
      this.flush();
    }
  }

  flush(): void {
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0);
    const body = JSON.stringify({
      api_key: this.apiKey,
      batch,
    });

    fetch(`${this.host}/batch/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }).catch(() => {
      // Fail silently -- telemetry should never block the gateway.
    });
  }

  identify(distinctId: string, properties: Record<string, unknown>): void {
    this.queue.push({
      event: "$identify",
      distinct_id: distinctId,
      properties: {
        ...this.globalProperties,
        $set: properties,
        $lib: "usefulcrm-posthog-plugin",
      },
      timestamp: new Date().toISOString(),
    });

    if (this.queue.length >= FLUSH_AT) {
      this.flush();
    }
  }

  async shutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flush();
  }
}

export function createPostHogClient(
  apiKey: string,
  host?: string,
  globalProperties?: Record<string, unknown>,
): PostHogClient {
  return new PostHogClient(apiKey, host, globalProperties);
}

export async function shutdownPostHogClient(client: PostHogClient): Promise<void> {
  try {
    await client.shutdown();
  } catch {
    // Non-fatal.
  }
}
