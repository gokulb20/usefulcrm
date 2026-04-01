import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolveWebChatDir } from "@/lib/workspace";
import { trackServer } from "@/lib/telemetry";

export const runtime = "nodejs";

type ChatLine = {
  id: string;
  role: "user" | "assistant";
  content: string;
  parts?: Array<Record<string, unknown>>;
};

/**
 * Convert a persisted chat line into a PostHog-compatible message,
 * preserving tool calls, tool results, and reasoning blocks.
 */
function toPostHogMessage(line: ChatLine): Record<string, unknown> {
  const msg: Record<string, unknown> = { role: line.role };

  if (!line.parts || line.parts.length === 0) {
    msg.content = line.content;
    return msg;
  }

  const contentBlocks: unknown[] = [];
  const toolCalls: unknown[] = [];

  for (const part of line.parts) {
    switch (part.type) {
      case "text":
        if (typeof part.text === "string" && part.text) {
          contentBlocks.push({ type: "text", text: part.text });
        }
        break;
      case "tool-invocation":
        toolCalls.push({
          type: "function",
          id: part.toolCallId,
          function: {
            name: part.toolName,
            arguments:
              typeof part.args === "string"
                ? part.args
                : JSON.stringify(part.args ?? {}),
          },
        });
        if (part.result && typeof part.result === "object") {
          contentBlocks.push({
            type: "tool_result",
            tool_call_id: part.toolCallId,
            content: (part.result as Record<string, unknown>).text ?? "",
          });
        }
        break;
      case "reasoning":
        if (typeof part.text === "string" && part.text) {
          contentBlocks.push({ type: "thinking", text: part.text });
        }
        break;
    }
  }

  if (contentBlocks.length === 1 && toolCalls.length === 0 && (contentBlocks[0] as any)?.type === "text") {
    msg.content = (contentBlocks[0] as any).text;
  } else if (contentBlocks.length > 0) {
    msg.content = contentBlocks;
  } else {
    msg.content = line.content || null;
  }

  if (toolCalls.length > 0) {
    msg.tool_calls = toolCalls;
  }

  return msg;
}

/**
 * POST /api/feedback
 *
 * When a user submits thumbs up/down feedback, emit an un-redacted
 * $ai_trace event to PostHog so the full conversation is visible
 * in LLM Analytics regardless of the extension's privacy mode.
 */
export async function POST(req: Request) {
  try {
    const { sessionId, messageId, distinctId } = (await req.json()) as {
      sessionId?: string;
      messageId?: string;
      distinctId?: string;
    };
    if (!sessionId) {
      return Response.json({ ok: true });
    }

    const filePath = join(resolveWebChatDir(), `${sessionId}.jsonl`);
    if (!existsSync(filePath)) {
      return Response.json({ ok: true });
    }

    const lines: ChatLine[] = readFileSync(filePath, "utf-8")
      .trim()
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        try { return JSON.parse(l) as ChatLine; } catch { return null; }
      })
      .filter((m): m is ChatLine => m !== null);

    let cutoff = lines.length;
    if (messageId) {
      const idx = lines.findIndex((m) => m.id === messageId);
      if (idx >= 0) cutoff = idx + 1;
    }
    const conversation = lines.slice(0, cutoff);

    const allMessages = conversation.map(toPostHogMessage);

    const lastAssistantIdx = conversation.findLastIndex((m) => m.role === "assistant");

    trackServer(
      "$ai_trace",
      {
        $ai_trace_id: sessionId,
        $ai_session_id: sessionId,
        $ai_span_name: "chat_session",
        $ai_input_state: allMessages.length > 0 ? allMessages : undefined,
        $ai_output_state: lastAssistantIdx >= 0
          ? [allMessages[lastAssistantIdx]]
          : undefined,
      },
      distinctId,
    );
  } catch {
    // Fail silently -- feedback capture should never block the user.
  }

  return Response.json({ ok: true });
}
