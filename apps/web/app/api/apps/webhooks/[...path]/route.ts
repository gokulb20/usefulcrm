export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type WebhookEvent = {
  method: string;
  headers: Record<string, string>;
  body: string;
  receivedAt: number;
};

const MAX_EVENTS_PER_HOOK = 100;
const webhookStore = new Map<string, WebhookEvent[]>();

// Survive HMR
const g = globalThis as unknown as { __webhookStore?: Map<string, WebhookEvent[]> };
if (!g.__webhookStore) g.__webhookStore = webhookStore;
const store = g.__webhookStore;

function hookKey(params: { path: string[] }): string {
  return params.path.join("/");
}

function pushEvent(key: string, event: WebhookEvent) {
  let events = store.get(key);
  if (!events) {
    events = [];
    store.set(key, events);
  }
  events.push(event);
  if (events.length > MAX_EVENTS_PER_HOOK) {
    events.splice(0, events.length - MAX_EVENTS_PER_HOOK);
  }
}

async function handleIncoming(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const p = await params;
  const key = hookKey(p);
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => { headers[k] = v; });

  let body = "";
  try {
    body = await req.text();
  } catch { /* empty body */ }

  pushEvent(key, {
    method: req.method,
    headers,
    body,
    receivedAt: Date.now(),
  });

  return Response.json({ ok: true, received: true });
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const url = new URL(req.url);
  const since = url.searchParams.get("since");
  const poll = url.searchParams.get("poll");

  if (poll || since) {
    const p = await ctx.params;
    const key = hookKey(p);
    const events = store.get(key) || [];
    const sinceTs = since ? parseInt(since, 10) : 0;
    const filtered = events.filter((e) => e.receivedAt > sinceTs);
    return Response.json({ events: filtered });
  }

  return handleIncoming(req, ctx);
}

export const POST = handleIncoming;
export const PUT = handleIncoming;
export const PATCH = handleIncoming;
export const DELETE = handleIncoming;
