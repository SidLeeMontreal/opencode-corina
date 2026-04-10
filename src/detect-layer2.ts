import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Layer1Scan } from "opencode-text-tools";

import type { Layer2Analysis, OpenCodeClient, PatternFinding } from "./types.js";

const PROMPTS_DIR = join(homedir(), ".config", "opencode", "prompts");
const SCHEMAS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "schemas");
const FALLBACK_PROMPT = `You are an independent AI-writing pattern analyst. Your role is forensic and diagnostic — you do not rewrite, you do not judge quality, and you do not claim authorship with certainty.

You receive:
1. A piece of text to analyze
2. A Layer1Scan from programmatic pre-processing that flags potential AI-writing patterns

Your job:
- Review each flagged pattern in full context
- Confirm or dismiss the flags conservatively
- Add structural patterns the pre-scan may have missed
- Return Layer2Analysis JSON only.`;

function unwrapData<T>(response: unknown): T {
  if (typeof response === "object" && response !== null && "data" in response) {
    return (response as { data: T }).data;
  }
  return response as T;
}

function extractText(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
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
    if (candidate && typeof candidate === "object") return candidate as T;
  }

  const text = extractText(data?.parts);
  if (!text) throw new Error("Layer 2 response did not include structured JSON.");
  return JSON.parse(text) as T;
}

async function promptSession(client: OpenCodeClient, sessionId: string, body: Record<string, unknown>): Promise<unknown> {
  const sessionClient = client.session as unknown as {
    prompt: (options: Record<string, unknown>) => Promise<unknown>;
  };

  try {
    return await sessionClient.prompt({ path: { id: sessionId }, body });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("sessionID") && !message.includes("id")) throw error;
    return sessionClient.prompt({ path: { sessionID: sessionId }, body });
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
    if (!message.includes("sessionID") && !message.includes("id")) throw error;
    await sessionClient.delete({ path: { sessionID: sessionId } });
  }
}

function loadPrompt(): string {
  const candidate = join(PROMPTS_DIR, "corina-detector.txt");
  return existsSync(candidate) ? readFileSync(candidate, "utf8").trim() : FALLBACK_PROMPT;
}

function fallbackLayer2(layer1Scan: Layer1Scan, findings: PatternFinding[], error?: unknown): Layer2Analysis {
  const reasoningNotes = ["Layer 2 analysis was unavailable, so the report used Layer 1 signals only."];
  if (layer1Scan.ambiguousPatterns.length) {
    reasoningNotes.push(`Ambiguous patterns left unreviewed: ${layer1Scan.ambiguousPatterns.join(", ")}.`);
  }
  if (error instanceof Error) {
    reasoningNotes.push(`Layer 2 fallback reason: ${error.message}.`);
  }

  return {
    ran: false,
    confirmed_patterns: findings.filter((finding) => finding.confidence === "high").map((finding) => finding.pattern_id),
    dismissed_patterns: [],
    reasoning_notes: reasoningNotes,
    score_adjustment: 0,
    additional_findings: [],
  };
}

export async function runLayer2Analysis(
  text: string,
  layer1Scan: Layer1Scan,
  client: OpenCodeClient,
  modelPreset?: string,
): Promise<Layer2Analysis> {
  const sessionResponse = await client.session.create({ body: { title: "Corina detect layer 2" } });
  const session = unwrapData<{ id: string }>(sessionResponse);

  try {
    await promptSession(client, session.id, {
      agent: "corina-detector",
      noReply: true,
      parts: [{ type: "text", text: loadPrompt() }],
    });

    const result = await promptSession(client, session.id, {
      agent: "corina-detector",
      parts: [
        {
          type: "text",
          text: [
            "Return Layer2Analysis JSON only.",
            modelPreset ? `Preferred model preset: ${modelPreset}` : "",
            "",
            "TEXT:",
            text,
            "",
            "LAYER 1 SCAN:",
            JSON.stringify(layer1Scan, null, 2),
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      format: {
        type: "json_schema",
        schema: JSON.parse(readFileSync(join(SCHEMAS_DIR, "Layer2Analysis.json"), "utf8")),
        retryCount: 2,
      },
    });

    return parseStructuredOutput<Layer2Analysis>(result);
  } catch (error) {
    return fallbackLayer2(layer1Scan, [], error);
  } finally {
    await deleteSession(client, session.id);
  }
}
