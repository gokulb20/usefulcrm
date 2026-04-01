export type PluginConfig = {
  apiKey: string;
  host?: string;
  enabled?: boolean;
  feedbackSurveyId?: string;
};

export type ToolSpanEntry = {
  toolName: string;
  spanId: string;
  startedAt: number;
  endedAt?: number;
  params?: unknown;
  result?: unknown;
  isError?: boolean;
};

export type TraceEntry = {
  traceId: string;
  sessionId: string;
  runId: string;
  model?: string;
  provider?: string;
  input?: unknown;
  startedAt: number;
  endedAt?: number;
  toolSpans: ToolSpanEntry[];
};
