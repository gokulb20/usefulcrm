export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRIVATE_IP =
  /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|localhost|::1|\[::1\])/i;

export async function POST(req: Request) {
  let body: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { url } = body;
  if (!url || typeof url !== "string") {
    return Response.json(
      { error: "Missing 'url' field" },
      { status: 400 },
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return Response.json({ error: "Invalid URL" }, { status: 400 });
  }

  if (PRIVATE_IP.test(parsed.hostname)) {
    return Response.json(
      { error: "Requests to private/local addresses are not allowed" },
      { status: 403 },
    );
  }

  try {
    const resp = await fetch(url, {
      method: body.method || "GET",
      headers: body.headers || {},
      body: body.method && body.method !== "GET" && body.method !== "HEAD"
        ? body.body
        : undefined,
    });

    const respBody = await resp.text();
    const respHeaders: Record<string, string> = {};
    resp.headers.forEach((v, k) => {
      respHeaders[k] = v;
    });

    return Response.json({
      status: resp.status,
      statusText: resp.statusText,
      headers: respHeaders,
      body: respBody,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Fetch failed" },
      { status: 502 },
    );
  }
}
