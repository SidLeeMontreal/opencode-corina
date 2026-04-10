import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ResolvedModel } from "opencode-model-resolver";
import { detectBannedWords, wordCount } from "opencode-text-tools";

import {
  addLlmMetrics,
  errorDetails,
  extractLlmMetrics,
  makeConsoleLogger,
  type AgentLogger,
  type UsageAccumulator,
} from "./logger.js";
import { loadPrompt } from "./prompt-loader.js";
import type {
  AuditArtifact,
  BriefArtifact,
  CritiqueArtifact,
  DraftArtifact,
  OpenCodeClient,
  OutlineArtifact,
  StepResult,
} from "./types.js";

const SCHEMAS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "schemas");

const schemaCache = new Map<string, Record<string, unknown>>();

export function sanitizeWords(text: string): string[] {
  return detectBannedWords(text).found;
}

export function countWords(text: string): number {
  return wordCount(text).total_words;
}

function loadSchema(filename: string): Record<string, unknown> {
  const cached = schemaCache.get(filename);
  if (cached) {
    return cached;
  }

  const schema = JSON.parse(readFileSync(join(SCHEMAS_DIR, filename), "utf8")) as Record<string, unknown>;
  schemaCache.set(filename, schema);
  return schema;
}

function unwrapData<T>(response: unknown): T {
  if (typeof response === "object" && response !== null && "data" in response) {
    return (response as { data: T }).data;
  }

  return response as T;
}

function buildPromptBody(body: Record<string, unknown>, model?: ResolvedModel): Record<string, unknown> {
  return {
    model: model
      ? {
          providerID: model.providerID,
          modelID: model.modelID,
        }
      : undefined,
    ...body,
  };
}

async function promptSession(
  client: OpenCodeClient,
  sessionId: string,
  body: Record<string, unknown>,
  model?: ResolvedModel,
): Promise<any> {
  const sessionClient = client.session as unknown as {
    prompt: (options: Record<string, unknown>) => Promise<any>;
  };

  try {
    return await sessionClient.prompt({
      path: { id: sessionId },
      body: buildPromptBody(body, model),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("sessionID") && !message.includes("id")) {
      throw error;
    }

    return sessionClient.prompt({
      path: { sessionID: sessionId },
      body: buildPromptBody(body, model),
    });
  }
}

async function deleteSession(client: OpenCodeClient, sessionId: string): Promise<void> {
  const sessionClient = client.session as unknown as {
    delete: (options: Record<string, unknown>) => Promise<any>;
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

export function extractText(parts: unknown): string {
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

export function parseStructuredOutput<T>(result: unknown): T {
  const data = unwrapData<any>(result);
  const candidates = [
    data?.info?.structured,
    data?.info?.structured_output,
    data?.info?.structuredOutput,
    data?.info?.metadata?.structured_output,
    data?.structured_output,
    data?.structuredOutput,
  ];

  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object") {
      return candidate as T;
    }
  }

  const text = extractText(data?.parts);
  if (!text) {
    throw new Error("Structured response did not include structured_output or JSON text parts.");
  }

  return JSON.parse(text) as T;
}

export function extractFinalText(responseText: string): string {
  const finalHeader = /^## FINAL\s*$/im;
  if (!finalHeader.test(responseText)) {
    return responseText.trim();
  }

  const segments = responseText.split(finalHeader);
  return (segments.at(-1) ?? responseText).trim();
}

async function runSession<T>(input: {
  client: OpenCodeClient;
  title: string;
  step: string;
  agent: string;
  personaFile: string;
  taskPrompt: string;
  schemaFile?: string;
  model?: ResolvedModel;
  logger?: AgentLogger;
  usage?: UsageAccumulator;
}): Promise<T> {
  const { client, title, step, agent, personaFile, taskPrompt, schemaFile, model, usage } = input;
  const logger = input.logger ?? makeConsoleLogger("corina");
  const sessionResponse = await client.session.create({ body: { title } });
  const session = unwrapData<{ id: string }>(sessionResponse);

  logger.debug("session_created", {
    capability: "pipeline",
    step,
    session_id: session.id,
    agent,
    model_id: model?.modelID,
    provider_id: model?.providerID,
  });

  try {
    const primerStartMs = Date.now();
    const primerResult = await promptSession(
      client,
      session.id,
      {
        agent,
        noReply: true,
        parts: [{ type: "text", text: loadPrompt(personaFile) }],
      },
      model,
    );
    const primerMetrics = extractLlmMetrics(primerResult, `${step}_setup`, primerStartMs);
    addLlmMetrics(usage, primerMetrics);
    logger.info("llm_call", { capability: "pipeline", ...primerMetrics });

    const taskStartMs = Date.now();
    const result = await promptSession(
      client,
      session.id,
      {
        agent,
        parts: [{ type: "text", text: taskPrompt }],
        ...(schemaFile
          ? {
              format: {
                type: "json_schema",
                schema: loadSchema(schemaFile),
                retryCount: 2,
              },
            }
          : {}),
      },
      model,
    );
    const taskMetrics = extractLlmMetrics(result, step, taskStartMs);
    addLlmMetrics(usage, taskMetrics);
    logger.info("llm_call", { capability: "pipeline", ...taskMetrics });

    if (schemaFile) {
      return parseStructuredOutput<T>(result);
    }

    const text = extractText(unwrapData<any>(result)?.parts);
    return extractFinalText(text) as T;
  } catch (error) {
    logger.error("step_error", {
      capability: "pipeline",
      step,
      session_id: session.id,
      degraded: false,
      ...errorDetails(error),
    });
    throw error;
  } finally {
    try {
      await deleteSession(client, session.id);
      logger.debug("session_deleted", {
        capability: "pipeline",
        step,
        session_id: session.id,
      });
    } catch (error) {
      logger.error("session_delete_failed", {
        capability: "pipeline",
        step,
        session_id: session.id,
        degraded: true,
        ...errorDetails(error),
      });
      throw error;
    }
  }
}

export async function runBriefIntake(
  client: OpenCodeClient,
  rawBrief: string,
  model?: ResolvedModel,
  logger?: AgentLogger,
  usage?: UsageAccumulator,
): Promise<StepResult<BriefArtifact>> {
  const artifact = await runSession<BriefArtifact>({
    client,
    title: "Corina brief intake",
    step: "brief_intake",
    agent: "corina",
    personaFile: "base/corina-persona.md",
    schemaFile: "BriefArtifact.json",
    model,
    logger,
    usage,
    taskPrompt: [
      "Turn the raw writing request into a validated BriefArtifact.",
      "Return JSON only via the schema formatter for this step.",
      "If the brief is underspecified, fill missing_info with concrete clarification questions.",
      "Prefer conservative inference over invented facts.",
      "",
      "RAW BRIEF:",
      rawBrief.trim(),
    ].join("\n"),
  });

  return { artifact };
}

export async function runOutline(
  client: OpenCodeClient,
  brief: BriefArtifact,
  model?: ResolvedModel,
  logger?: AgentLogger,
  usage?: UsageAccumulator,
): Promise<StepResult<OutlineArtifact>> {
  const artifact = await runSession<OutlineArtifact>({
    client,
    title: "Corina outline",
    step: "outline",
    agent: "corina",
    personaFile: "base/corina-persona.md",
    schemaFile: "OutlineArtifact.json",
    model,
    logger,
    usage,
    taskPrompt: [
      "Create an OutlineArtifact for the writing assignment below.",
      "Return JSON only via the schema formatter for this step.",
      "Build a thesis, useful structure, explicit risks, and a strong editorial intent.",
      "",
      "BRIEF ARTIFACT:",
      JSON.stringify(brief, null, 2),
    ].join("\n"),
  });

  return { artifact };
}

export async function runDraft(
  client: OpenCodeClient,
  brief: BriefArtifact,
  outline: OutlineArtifact,
  model?: ResolvedModel,
  logger?: AgentLogger,
  usage?: UsageAccumulator,
): Promise<StepResult<DraftArtifact>> {
  const content = await runSession<string>({
    client,
    title: "Corina draft",
    step: "draft",
    agent: "corina",
    personaFile: "base/corina-persona.md",
    model,
    logger,
    usage,
    taskPrompt: [
      "Write the full draft using the brief and outline below.",
      "Follow the Corina persona process, but the content we will keep is the ## FINAL section.",
      "Ground claims in the supplied material only. Do not invent statistics.",
      "Keep the writing human, specific, and free of generic AI phrasing.",
      "",
      "BRIEF ARTIFACT:",
      JSON.stringify(brief, null, 2),
      "",
      "OUTLINE ARTIFACT:",
      JSON.stringify(outline, null, 2),
    ].join("\n"),
  });

  const bannedWords = sanitizeWords(content);

  return {
    artifact: {
      content,
      word_count: countWords(content),
      claims: [outline.thesis],
      assumptions: brief.missing_info,
      open_risks: outline.risks,
    },
    warnings: bannedWords.length ? [`Banned words detected in draft pre-scan: ${bannedWords.join(", ")}`] : [],
  };
}

export async function runCritique(
  client: OpenCodeClient,
  draft: DraftArtifact,
  brief: BriefArtifact,
  model?: ResolvedModel,
  logger?: AgentLogger,
  usage?: UsageAccumulator,
): Promise<StepResult<CritiqueArtifact>> {
  const artifact = await runSession<CritiqueArtifact>({
    client,
    title: "Corina critique",
    step: "critique",
    agent: "critic",
    personaFile: "tasks/critic.md",
    schemaFile: "CritiqueArtifact.json",
    model,
    logger,
    usage,
    taskPrompt: [
      "Evaluate the draft against the brief and return a CritiqueArtifact.",
      "Return JSON only via the schema formatter for this step.",
      "Be strict. Identify AI-pattern failures, evidence problems, tone problems, and rhythm issues.",
      "",
      "BRIEF ARTIFACT:",
      JSON.stringify(brief, null, 2),
      "",
      "DRAFT ARTIFACT:",
      JSON.stringify(draft, null, 2),
    ].join("\n"),
  });

  return { artifact };
}

export async function runRevise(
  client: OpenCodeClient,
  draft: DraftArtifact,
  critique: CritiqueArtifact,
  model?: ResolvedModel,
  logger?: AgentLogger,
  usage?: UsageAccumulator,
): Promise<StepResult<DraftArtifact>> {
  const content = await runSession<string>({
    client,
    title: "Corina revise",
    step: "revise",
    agent: "corina",
    personaFile: "base/corina-persona.md",
    model,
    logger,
    usage,
    taskPrompt: [
      "Revise the draft using the critique below.",
      "Follow the Corina persona process, but the content we will keep is the ## FINAL section.",
      "Fix every revision instruction and every fatal issue. Preserve the core argument unless the critique requires changing it.",
      "Do not add fabricated evidence.",
      "",
      "DRAFT ARTIFACT:",
      JSON.stringify(draft, null, 2),
      "",
      "CRITIQUE ARTIFACT:",
      JSON.stringify(critique, null, 2),
    ].join("\n"),
  });

  return {
    artifact: {
      ...draft,
      content,
      word_count: countWords(content),
    },
  };
}

export async function runAudit(
  client: OpenCodeClient,
  draft: DraftArtifact,
  brief: BriefArtifact,
  model?: ResolvedModel,
  logger?: AgentLogger,
  usage?: UsageAccumulator,
): Promise<StepResult<AuditArtifact>> {
  const artifact = await runSession<AuditArtifact>({
    client,
    title: "Corina audit",
    step: "audit",
    agent: "auditor",
    personaFile: "tasks/auditor.md",
    schemaFile: "AuditArtifact.json",
    model,
    logger,
    usage,
    taskPrompt: [
      "Run the final audit on this draft and return an AuditArtifact.",
      "Return JSON only via the schema formatter for this step.",
      "Approve only if the text is clean for delivery.",
      "",
      "BRIEF ARTIFACT:",
      JSON.stringify(brief, null, 2),
      "",
      "DRAFT ARTIFACT:",
      JSON.stringify(draft, null, 2),
    ].join("\n"),
  });

  const bannedWords = sanitizeWords(draft.content);
  const warnings = bannedWords.length ? [`Local banned-word scan still sees: ${bannedWords.join(", ")}`] : [];

  return { artifact, warnings };
}
