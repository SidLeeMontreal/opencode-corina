import type { ResolvedModel } from "opencode-model-resolver";

import { addLlmMetrics, errorDetails, extractLlmMetrics, type AgentLogger, type UsageAccumulator } from "./logger.js";
import { loadPrompt } from "./prompt-loader.js";
import type { EvaluationContext, OpenCodeClient } from "./types.js";

function unwrapData<T>(response: unknown): T {
  if (typeof response === "object" && response !== null && "data" in response) {
    return response as T;
  }

  return response as T;
}

function extractText(parts: unknown): string {
  if (!Array.isArray(parts)) {
    return "";
  }

  return parts
    .filter((part): part is { type: string; text?: string } => typeof part === "object" && part !== null && "type" in part)
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function buildPromptBody(body: Record<string, unknown>, model?: ResolvedModel): Record<string, unknown> {
  return model
    ? {
        ...body,
        model: {
          providerID: model.providerID,
          modelID: model.modelID,
        },
      }
    : body;
}

async function promptSession(
  client: OpenCodeClient,
  sessionId: string,
  body: Record<string, unknown>,
  model?: ResolvedModel,
): Promise<unknown> {
  const sessionClient = client.session as unknown as {
    prompt: (options: Record<string, unknown>) => Promise<unknown>;
  };

  try {
    return await sessionClient.prompt({ path: { id: sessionId }, body: buildPromptBody(body, model) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("sessionID") && !message.includes("id")) {
      throw error;
    }

    return sessionClient.prompt({ path: { sessionID: sessionId }, body: buildPromptBody(body, model) });
  }
}

async function deleteSession(client: OpenCodeClient, sessionId: string): Promise<void> {
  const sessionClient = client.session as unknown as {
    delete: (options: Record<string, unknown>) => Promise<unknown>;
  };

  try {
    await sessionClient.delete({ path: { id: sessionId } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("sessionID") && !message.includes("id")) {
      throw error;
    }

    await sessionClient.delete({ path: { sessionID: sessionId } });
  }
}

export function buildEvaluationContextBlock(context: EvaluationContext): string {
  const tone = context.voice_prompt ? context.voice_prompt.split("\n").find((line) => line.trim()) ?? "set" : "none";
  const constraints = context.user_constraints.length ? context.user_constraints.join(" | ") : "none";
  const priorFindings = Array.isArray(context.metadata["prior_findings"])
    ? (context.metadata["prior_findings"] as string[]).join(" | ")
    : "none";
  const block = [
    "=== PIPELINE CONTEXT ===",
    `Voice: ${context.requested_voice ?? "none"} | Format: ${context.requested_format ?? "other"} | Mode: ${context.mode ?? context.kind}`,
    `Tone: ${tone}`,
    `Constraints: ${constraints}`,
    `Audience: ${context.audience ?? "none"}`,
    `Rubric: ${context.rubric_id ?? "none"}`,
    `Prior findings: ${priorFindings}`,
    "=== END PIPELINE CONTEXT ===",
  ];

  if (context.rubric_text?.trim()) {
    block.push("=== RUBRIC TEXT ===", context.rubric_text.trim(), "=== END RUBRIC TEXT ===");
  }

  return block.join("\n");
}

export function extractDelimitedJson(text: string, tag: string): unknown {
  const pattern = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = text.match(pattern);
  if (!match?.[1]) {
    throw new Error(`Missing <${tag}> delimiter in evaluation output.`);
  }

  return JSON.parse(match[1].trim()) as unknown;
}

export async function runEvaluationAgent(input: {
  client: OpenCodeClient;
  capability: "critique" | "pipeline";
  title: string;
  step: string;
  agent: string;
  promptFile: string;
  taskPrompt: string;
  delimiter: string;
  model?: ResolvedModel;
  logger: AgentLogger;
  usage?: UsageAccumulator;
}): Promise<{ raw: unknown; text: string; metrics: ReturnType<typeof extractLlmMetrics> }> {
  const { client, capability, title, step, agent, promptFile, taskPrompt, delimiter, model, logger, usage } = input;
  const sessionResponse = await client.session.create({ body: { title } });
  const session = unwrapData<{ data?: { id?: string }; id?: string }>(sessionResponse);
  const sessionId = session.data?.id ?? session.id;

  if (!sessionId) {
    throw new Error(`Could not create session for ${step}.`);
  }

  logger.debug("session_created", {
    capability,
    step,
    session_id: sessionId,
    agent,
    model_id: model?.modelID,
    provider_id: model?.providerID,
  });

  try {
    const primerStartMs = Date.now();
    const primerResult = await promptSession(
      client,
      sessionId,
      {
        agent,
        noReply: true,
        parts: [{ type: "text", text: loadPrompt(promptFile) }],
      },
      model,
    );
    const primerMetrics = extractLlmMetrics(primerResult, `${step}_setup`, primerStartMs);
    addLlmMetrics(usage, primerMetrics);
    logger.info("llm_call", { capability, ...primerMetrics });

    const callStartMs = Date.now();
    const result = await promptSession(
      client,
      sessionId,
      {
        agent,
        parts: [{ type: "text", text: taskPrompt }],
      },
      model,
    );
    const metrics = extractLlmMetrics(result, step, callStartMs);
    addLlmMetrics(usage, metrics);
    logger.info("llm_call", { capability, ...metrics });

    const responseText = extractText((unwrapData<{ data?: { parts?: unknown[] }; parts?: unknown[] }>(result).data ?? unwrapData<Record<string, unknown>>(result)).parts);
    const raw = extractDelimitedJson(responseText, delimiter);
    return { raw, text: responseText, metrics };
  } catch (error) {
    logger.error("step_error", {
      capability,
      step,
      degraded: false,
      ...errorDetails(error),
    });
    throw error;
  } finally {
    await deleteSession(client, sessionId);
    logger.debug("session_deleted", { capability, step, session_id: sessionId });
  }
}

export function normalizeBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n");
}
