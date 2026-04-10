import type { OpenCodeClient } from "./types.js";

export interface AgentLogger {
  debug(event: string, extra?: Record<string, unknown>): void;
  info(event: string, extra?: Record<string, unknown>): void;
  warn(event: string, extra?: Record<string, unknown>): void;
  error(event: string, extra?: Record<string, unknown>): void;
}

export interface LlmCallMetrics {
  session_id: string;
  step: string;
  model_id?: string;
  provider_id?: string;
  tokens?: {
    input: number;
    output: number;
    cache_read?: number;
    total?: number;
  };
  cost?: number;
  duration_ms: number;
}

export interface UsageAccumulator {
  total_tokens: number;
  total_cost: number;
}

type LogLevel = "debug" | "info" | "warn" | "error";

function normalizeExtra(event: string, service: string, level: LogLevel, extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    timestamp: new Date().toISOString(),
    service,
    level,
    event,
    ...(extra ?? {}),
  };
}

function emitRuntimeLog(client: OpenCodeClient, service: string, level: LogLevel, event: string, extra?: Record<string, unknown>): void {
  client.app.log({
    body: {
      service,
      level,
      message: event,
      extra: normalizeExtra(event, service, level, extra),
    },
  });
}

export function makeOpenCodeLogger(client: OpenCodeClient, service: string): AgentLogger {
  return {
    debug: (event, extra) => emitRuntimeLog(client, service, "debug", event, extra),
    info: (event, extra) => emitRuntimeLog(client, service, "info", event, extra),
    warn: (event, extra) => emitRuntimeLog(client, service, "warn", event, extra),
    error: (event, extra) => emitRuntimeLog(client, service, "error", event, extra),
  };
}

export function makeConsoleLogger(service: string): AgentLogger {
  const debugEnabled = process.env["CORINA_DEBUG"] === "1" || process.env["NODE_ENV"] === "development";
  const emit = (level: LogLevel, event: string, extra?: Record<string, unknown>) => {
    const payload = normalizeExtra(event, service, level, extra);
    const line = JSON.stringify(payload);

    if (level === "debug") {
      if (debugEnabled) {
        console.info(line);
      }
      return;
    }

    if (level === "info") {
      console.info(line);
      return;
    }

    if (level === "warn") {
      console.warn(line);
      return;
    }

    console.error(line);
  };

  return {
    debug: (event, extra) => emit("debug", event, extra),
    info: (event, extra) => emit("info", event, extra),
    warn: (event, extra) => emit("warn", event, extra),
    error: (event, extra) => emit("error", event, extra),
  };
}

export function extractLlmMetrics(result: unknown, step: string, startMs: number): Partial<LlmCallMetrics> {
  const data = (result as any)?.data;
  const info = data?.info;
  return {
    step,
    session_id: info?.sessionID ?? info?.sessionId ?? "",
    model_id: info?.modelID ?? info?.modelId ?? "",
    provider_id: info?.providerID ?? info?.providerId ?? "",
    tokens: info?.tokens
      ? {
          input: info.tokens.input ?? 0,
          output: info.tokens.output ?? 0,
          cache_read: info.tokens.cache?.read ?? 0,
          total: info.tokens.total ?? 0,
        }
      : undefined,
    cost: info?.cost ?? 0,
    duration_ms: Date.now() - startMs,
  };
}

export function createUsageAccumulator(): UsageAccumulator {
  return {
    total_tokens: 0,
    total_cost: 0,
  };
}

export function addLlmMetrics(accumulator: UsageAccumulator | undefined, metrics: Partial<LlmCallMetrics> | undefined): void {
  if (!accumulator || !metrics) {
    return;
  }

  const tokens = metrics.tokens;
  const totalTokens = tokens?.total ?? (tokens ? (tokens.input ?? 0) + (tokens.output ?? 0) + (tokens.cache_read ?? 0) : 0);
  accumulator.total_tokens += totalTokens;
  accumulator.total_cost += metrics.cost ?? 0;
}

export function errorDetails(error: unknown): { error_type: string; message: string } {
  if (error instanceof Error) {
    return {
      error_type: error.name || "Error",
      message: error.message,
    };
  }

  return {
    error_type: typeof error,
    message: String(error),
  };
}
