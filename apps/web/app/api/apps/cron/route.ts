import { callGatewayRpc } from "@/lib/agent-runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { action?: string; params?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { action, params } = body;
  if (!action || typeof action !== "string") {
    return Response.json(
      { error: "Missing 'action' field" },
      { status: 400 },
    );
  }

  const ALLOWED_ACTIONS = ["add", "remove", "enable", "disable", "run", "list"];
  if (!ALLOWED_ACTIONS.includes(action)) {
    return Response.json(
      { error: `Invalid action: ${action}` },
      { status: 400 },
    );
  }

  try {
    const result = await callGatewayRpc(`cron.${action}`, params || {});
    if (result.ok) {
      return Response.json({ ok: true, payload: result.payload });
    }
    return Response.json(
      { error: result.error || "RPC failed" },
      { status: 500 },
    );
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Gateway RPC failed" },
      { status: 502 },
    );
  }
}

export async function GET() {
  try {
    const result = await callGatewayRpc("cron.list", {});
    if (result.ok) {
      return Response.json(result.payload);
    }
    return Response.json(
      { error: result.error || "RPC failed" },
      { status: 500 },
    );
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Gateway RPC failed" },
      { status: 502 },
    );
  }
}
