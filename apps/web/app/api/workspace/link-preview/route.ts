import { parseMetadata } from "./link-preview-utils";
import type { LinkPreviewData } from "./link-preview-utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FETCH_TIMEOUT_MS = 6000;
const MAX_BODY_BYTES = 512_000;

function isValidHttpUrl(raw: string): boolean {
	try {
		const u = new URL(raw);
		return u.protocol === "http:" || u.protocol === "https:";
	} catch {
		return false;
	}
}

export async function GET(req: Request) {
	const { searchParams } = new URL(req.url);
	const targetUrl = searchParams.get("url");

	if (!targetUrl || !isValidHttpUrl(targetUrl)) {
		return Response.json({ error: "Invalid or missing URL" }, { status: 400 });
	}

	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

		const res = await fetch(targetUrl, {
			signal: controller.signal,
			headers: {
				"User-Agent": "Mozilla/5.0 (compatible; UsefulCRMBot/1.0; +https://useful.com)",
				Accept: "text/html,application/xhtml+xml",
			},
			redirect: "follow",
		});
		clearTimeout(timer);

		if (!res.ok) {
			return Response.json({ error: `Upstream returned ${res.status}` }, { status: 502 });
		}

		const contentType = res.headers.get("content-type") ?? "";
		if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
			return Response.json(
				{ url: targetUrl, domain: new URL(targetUrl).hostname } satisfies LinkPreviewData,
				{ headers: { "Cache-Control": "public, max-age=86400" } },
			);
		}

		const reader = res.body?.getReader();
		if (!reader) {
			return Response.json({ error: "No response body" }, { status: 502 });
		}

		const chunks: Uint8Array[] = [];
		let totalBytes = 0;
		while (totalBytes < MAX_BODY_BYTES) {
			const { done, value } = await reader.read();
			if (done) {break;}
			chunks.push(value);
			totalBytes += value.byteLength;
		}
		reader.cancel().catch(() => {});

		const html = new TextDecoder("utf-8", { fatal: false }).decode(
			Buffer.concat(chunks),
		);

		const finalUrl = res.url || targetUrl;
		const data = parseMetadata(html, finalUrl);

		return Response.json(data, {
			headers: { "Cache-Control": "public, max-age=86400" },
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : "Fetch failed";
		return Response.json({ error: message }, { status: 502 });
	}
}
