import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ResolvedModel } from "opencode-model-resolver";

import type {
  AuditArtifact,
  BriefArtifact,
  CritiqueArtifact,
  DraftArtifact,
  OpenCodeClient,
  OutlineArtifact,
  StepResult,
} from "./types.js";

const DEFAULT_BANNED_WORDS = ["delve", "tapestry", "leverage", "game-changer", "cutting-edge", "robust"];
const PROMPTS_DIR = join(homedir(), ".config", "opencode", "prompts");
const SCHEMAS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "schemas");

const promptCache = new Map<string, string>();
const schemaCache = new Map<string, Record<string, unknown>>();

function sanitizeWords(text: string): string[] {
  const haystack = text.toLowerCase();
  return DEFAULT_BANNED_WORDS.filter((word) => haystack.includes(word.toLowerCase()));
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function loadPrompt(filename: string): string {
  const cached = promptCache.get(filename);
  if (cached) {
    return cached;
  }

  const content = readFileSync(join(PROMPTS_DIR, filename), "utf8").trim();
  promptCache.set(filename, content);
  return content;
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

function parseStructuredOutput<T>(result: unknown): T {
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

function extractFinalText(responseText: string): string {
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
  agent: string;
  personaFile: string;
  taskPrompt: string;
  schemaFile?: string;
  model?: ResolvedModel;
}): Promise<T> {
  const { client, title, agent, personaFile, taskPrompt, schemaFile, model } = input;
  const sessionResponse = await client.session.create({ body: { title } });
  const session = unwrapData<{ id: string }>(sessionResponse);

  try {
    await promptSession(
      client,
      session.id,
      {
        agent,
        noReply: true,
        parts: [{ type: "text", text: loadPrompt(personaFile) }],
      },
      model,
    );

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

    if (schemaFile) {
      return parseStructuredOutput<T>(result);
    }

    const text = extractText(unwrapData<any>(result)?.parts);
    return extractFinalText(text) as T;
  } finally {
    await deleteSession(client, session.id);
  }
}

export async function runBriefIntake(
  client: OpenCodeClient,
  rawBrief: string,
  model?: ResolvedModel,
): Promise<StepResult<BriefArtifact>> {
  const artifact = await runSession<BriefArtifact>({
    client,
    title: "Corina brief intake",
    agent: "corina",
    personaFile: "corina-persona.txt",
    schemaFile: "BriefArtifact.json",
    model,
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
): Promise<StepResult<OutlineArtifact>> {
  const artifact = await runSession<OutlineArtifact>({
    client,
    title: "Corina outline",
    agent: "corina",
    personaFile: "corina-persona.txt",
    schemaFile: "OutlineArtifact.json",
    model,
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
): Promise<StepResult<DraftArtifact>> {
  const content = await runSession<string>({
    client,
    title: "Corina draft",
    agent: "corina",
    personaFile: "corina-persona.txt",
    model,
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
): Promise<StepResult<CritiqueArtifact>> {
  const artifact = await runSession<CritiqueArtifact>({
    client,
    title: "Corina critique",
    agent: "corina-critic",
    personaFile: "corina-critic.txt",
    schemaFile: "CritiqueArtifact.json",
    model,
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
): Promise<StepResult<DraftArtifact>> {
  const content = await runSession<string>({
    client,
    title: "Corina revise",
    agent: "corina",
    personaFile: "corina-persona.txt",
    model,
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
): Promise<StepResult<AuditArtifact>> {
  const artifact = await runSession<AuditArtifact>({
    client,
    title: "Corina audit",
    agent: "corina-auditor",
    personaFile: "corina-auditor.txt",
    schemaFile: "AuditArtifact.json",
    model,
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
