/**
 * api-bridge-client.ts
 *
 * Typed client for the UsefulCRM API Bridge (api-bridge/main.py).
 * The bridge runs at USEFUL_API_URL (default: http://localhost:3200).
 *
 * Usage:
 *   import { apiBridge } from "@/lib/api-bridge-client";
 *   const contacts = await apiBridge.contacts.list({ limit: 20 });
 */

// ── Base URL ────────────────────────────────────────────────────────────────

function getBridgeBaseUrl(): string {
  // Server-side: use USEFUL_API_URL env var
  if (typeof process !== "undefined" && process.env.USEFUL_API_URL) {
    return process.env.USEFUL_API_URL.replace(/\/$/, "");
  }
  // Client-side: same origin fallback or env var
  if (typeof window !== "undefined") {
    return (
      (window as Window & { USEFUL_API_URL?: string }).USEFUL_API_URL ??
      "http://localhost:3200"
    );
  }
  return "http://localhost:3200";
}

// ── Generic fetch helper ────────────────────────────────────────────────────

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
  headers?: Record<string, string>;
};

async function bridgeFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const base = getBridgeBaseUrl();
  const url = `${base}${path}`;
  const res = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    body: options.body != null ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API Bridge ${options.method ?? "GET"} ${path} failed: ${res.status} ${text}`);
  }

  return res.json() as Promise<T>;
}

function buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null) q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

// ── Types ───────────────────────────────────────────────────────────────────

export type ListResponse<T> = {
  data: T[];
  total: number;
  limit: number;
  offset: number;
};

export type Contact = {
  id: string;
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  title?: string;
  company_id?: string;
  status: string;
  linkedin?: string;
  twitter?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
};

export type Company = {
  id: string;
  name: string;
  domain?: string;
  industry?: string;
  size?: string;
  website?: string;
  linkedin?: string;
  description?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
};

export type Deal = {
  id: string;
  name: string;
  value?: number;
  currency: string;
  stage_id?: string;
  stage?: string;
  company_id?: string;
  contact_id?: string;
  owner?: string;
  close_date?: string;
  probability?: number;
  notes?: string;
  created_at: string;
  updated_at: string;
};

export type Activity = {
  id: string;
  type: string;
  subject?: string;
  body?: string;
  contact_id?: string;
  company_id?: string;
  deal_id?: string;
  completed: boolean;
  due_at?: string;
  occurred_at: string;
  created_at: string;
  updated_at: string;
};

export type Document = {
  id: string;
  title: string;
  content?: string;
  type: string;
  contact_id?: string;
  company_id?: string;
  deal_id?: string;
  created_at: string;
  updated_at: string;
};

export type DealStage = {
  id: string;
  name: string;
  position: number;
  color?: string;
  created_at: string;
  updated_at: string;
};

export type SearchResult = {
  entity_type: "contact" | "company" | "deal" | "activity" | "document";
  id: string;
  title: string;
  subtitle?: string;
  created_at: string;
};

export type PaginationParams = {
  limit?: number;
  offset?: number;
};

// ── Contacts resource ───────────────────────────────────────────────────────

const contacts = {
  list(params: PaginationParams & { company_id?: string; status?: string; q?: string } = {}) {
    return bridgeFetch<ListResponse<Contact>>(`/api/contacts${buildQuery(params)}`);
  },
  get(id: string) {
    return bridgeFetch<Contact>(`/api/contacts/${id}`);
  },
  create(data: Partial<Contact>) {
    return bridgeFetch<Contact>("/api/contacts", { method: "POST", body: data });
  },
  update(id: string, data: Partial<Contact>) {
    return bridgeFetch<Contact>(`/api/contacts/${id}`, { method: "PUT", body: data });
  },
  delete(id: string) {
    return bridgeFetch<void>(`/api/contacts/${id}`, { method: "DELETE" });
  },
};

// ── Companies resource ──────────────────────────────────────────────────────

const companies = {
  list(params: PaginationParams & { industry?: string; q?: string } = {}) {
    return bridgeFetch<ListResponse<Company>>(`/api/companies${buildQuery(params)}`);
  },
  get(id: string) {
    return bridgeFetch<Company>(`/api/companies/${id}`);
  },
  create(data: Partial<Company>) {
    return bridgeFetch<Company>("/api/companies", { method: "POST", body: data });
  },
  update(id: string, data: Partial<Company>) {
    return bridgeFetch<Company>(`/api/companies/${id}`, { method: "PUT", body: data });
  },
};

// ── Deals resource ───────────────────────────────────────────────────────────

const deals = {
  list(
    params: PaginationParams & {
      company_id?: string;
      contact_id?: string;
      stage?: string;
      stage_id?: string;
    } = {},
  ) {
    return bridgeFetch<ListResponse<Deal>>(`/api/deals${buildQuery(params)}`);
  },
  get(id: string) {
    return bridgeFetch<Deal>(`/api/deals/${id}`);
  },
  create(data: Partial<Deal>) {
    return bridgeFetch<Deal>("/api/deals", { method: "POST", body: data });
  },
  update(id: string, data: Partial<Deal>) {
    return bridgeFetch<Deal>(`/api/deals/${id}`, { method: "PUT", body: data });
  },
};

// ── Activities resource ──────────────────────────────────────────────────────

const activities = {
  list(
    params: PaginationParams & {
      contact_id?: string;
      company_id?: string;
      deal_id?: string;
      type?: string;
    } = {},
  ) {
    return bridgeFetch<ListResponse<Activity>>(`/api/activities${buildQuery(params)}`);
  },
  create(data: Partial<Activity>) {
    return bridgeFetch<Activity>("/api/activities", { method: "POST", body: data });
  },
};

// ── Documents resource ───────────────────────────────────────────────────────

const documents = {
  list(
    params: PaginationParams & {
      contact_id?: string;
      company_id?: string;
      deal_id?: string;
      type?: string;
    } = {},
  ) {
    return bridgeFetch<ListResponse<Document>>(`/api/documents${buildQuery(params)}`);
  },
  create(data: Partial<Document>) {
    return bridgeFetch<Document>("/api/documents", { method: "POST", body: data });
  },
  update(id: string, data: Partial<Document>) {
    return bridgeFetch<Document>(`/api/documents/${id}`, { method: "PUT", body: data });
  },
};

// ── Search ───────────────────────────────────────────────────────────────────

const search = {
  query(q: string, params: PaginationParams = {}) {
    return bridgeFetch<ListResponse<SearchResult> & { query: string }>(
      `/api/search${buildQuery({ q, ...params })}`,
    );
  },
};

// ── Deal stages ──────────────────────────────────────────────────────────────

const dealStages = {
  list() {
    return bridgeFetch<{ data: DealStage[] }>("/api/deal-stages");
  },
};

// ── Chat (SSE) ───────────────────────────────────────────────────────────────

export type ChatChunk = {
  type: "text-delta" | "tool-call" | "tool-result" | "done" | "error";
  content: string;
  [key: string]: unknown;
};

/**
 * Send a message to the Hermes agent via the API bridge and receive chunks
 * via the provided callback. Returns when the stream is complete.
 *
 * @example
 * await apiBridge.chat.stream("List all open deals", (chunk) => {
 *   if (chunk.type === "text-delta") setOutput((o) => o + chunk.content);
 * });
 */
async function chatStream(
  message: string,
  onChunk: (chunk: ChatChunk) => void,
  sessionId?: string,
): Promise<void> {
  const base = getBridgeBaseUrl();
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, session_id: sessionId }),
  });

  if (!res.ok || !res.body) {
    throw new Error(`Chat stream failed: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const raw = line.slice(6).trim();
        if (raw === "[DONE]" || !raw) continue;
        try {
          const chunk = JSON.parse(raw) as ChatChunk;
          onChunk(chunk);
        } catch {
          // ignore malformed chunks
        }
      }
    }
  }
}

const chat = { stream: chatStream };

// ── Health ────────────────────────────────────────────────────────────────────

async function checkHealth() {
  return bridgeFetch<{ ok: boolean; hermes: Record<string, unknown> }>("/health");
}

// ── Export ───────────────────────────────────────────────────────────────────

export const apiBridge = {
  contacts,
  companies,
  deals,
  activities,
  documents,
  search,
  dealStages,
  chat,
  health: checkHealth,
  /** Raw fetch against the bridge for custom queries */
  fetch: bridgeFetch,
};
