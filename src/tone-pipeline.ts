import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  BrandProfile,
  OpenCodeClient,
  PersonalVoiceProfile,
  ToneFormat,
  ToneInputArtifact,
  ToneOutputArtifact,
  ToneRawInput,
  ToneValidationArtifact,
  ToneVoice,
} from "./types.js";
import { buildPersonalVoiceProfile, inferFormat, inferVoice, resolveVoiceProfile } from "./tone-defaults.js";
import { validate } from "./validators.js";

const PROMPTS_DIR = join(homedir(), ".config", "opencode", "prompts");
const VOICES_DIR = join(PROMPTS_DIR, "voices");
const PROFILES_DIR = join(homedir(), ".config", "opencode", "corina", "profiles");
const SCHEMAS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "schemas");
const AI_PATTERNS = [
  "additionally",
  "pivotal",
  "tapestry",
  "vibrant",
  "underscore",
  "showcase",
  "leverage",
  "game-changing",
  "nestled",
  "delve",
];

function unwrapData<T>(response: unknown): T {
  if (typeof response === "object" && response !== null && "data" in response) {
    return (response as { data: T }).data;
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

function parseJsonText<T>(result: unknown): T {
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
    throw new Error("Expected JSON validator response.");
  }

  return JSON.parse(text) as T;
}

async function promptSession(
  client: OpenCodeClient,
  sessionId: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const sessionClient = client.session as unknown as {
    prompt: (options: Record<string, unknown>) => Promise<unknown>;
  };

  try {
    return await sessionClient.prompt({ path: { id: sessionId }, body });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("sessionID") && !message.includes("id")) {
      throw error;
    }

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
    if (!message.includes("sessionID") && !message.includes("id")) {
      throw error;
    }

    await sessionClient.delete({ path: { sessionID: sessionId } });
  }
}

function loadPrompt(pathOrName: string): string {
  const fullPath = isAbsolute(pathOrName) ? pathOrName : join(PROMPTS_DIR, pathOrName);
  return readFileSync(fullPath, "utf8").trim();
}

function cleanText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\t/g, " ").replace(/[ \t]+\n/g, "\n").trim();
}

function maybeResolveTextInput(textOrPath: string): { text: string; sourcePath: string | null } {
  const trimmed = textOrPath.trim();
  const candidates = [trimmed, resolve(trimmed)];

  for (const candidate of candidates) {
    if (!candidate || !existsSync(candidate)) {
      continue;
    }

    try {
      const fileText = readFileSync(candidate, "utf8");
      return { text: fileText, sourcePath: candidate };
    } catch {
      return { text: trimmed, sourcePath: null };
    }
  }

  return { text: trimmed, sourcePath: null };
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function detectHeadingCount(text: string): number {
  return text
    .split("\n")
    .filter((line) => /^#{1,6}\s+/.test(line) || (/^[A-Z][^.!?]{2,80}$/.test(line.trim()) && line.trim().length < 80))
    .length;
}

function inferAudience(voice: ToneVoice): string | null {
  switch (voice) {
    case "executive":
      return "C-suite leaders";
    case "ux":
      return "product users";
    case "accessibility":
      return "general public";
    case "social":
      return "social followers";
    case "email":
      return "direct recipient";
    case "journalist":
      return "general readers";
    default:
      return null;
  }
}

function listProfileFiles(): string[] {
  if (!existsSync(PROFILES_DIR)) {
    return [];
  }

  return readdirSync(PROFILES_DIR)
    .filter((entry) => /\.(json|ya?ml|md|txt)$/i.test(entry))
    .map((entry) => join(PROFILES_DIR, entry));
}

function resolveProfilePath(profile?: string): string | null {
  if (!profile?.trim()) {
    return null;
  }

  const value = profile.trim();
  const candidates = [
    value,
    resolve(value),
    join(PROFILES_DIR, value),
    join(PROFILES_DIR, `${value}.json`),
    join(PROFILES_DIR, `${value}.md`),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function loadBrandProfile(profile?: string): { profile: BrandProfile | null; assumption?: string } {
  const explicitPath = resolveProfilePath(profile);
  if (explicitPath) {
    try {
      return {
        profile: JSON.parse(readFileSync(explicitPath, "utf8")) as BrandProfile,
        assumption: `Loaded brand profile from ${explicitPath}.`,
      };
    } catch {
      return { profile: null, assumption: `Brand profile at ${explicitPath} was unreadable.` };
    }
  }

  const inferred = resolveVoiceProfile("brand", PROFILES_DIR) as BrandProfile | null;
  if (inferred) {
    const newest = listProfileFiles().sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
    return {
      profile: inferred,
      assumption: newest
        ? `Brand voice requested without --profile; used ${newest}.`
        : "Brand voice requested without --profile; used the only available profile.",
    };
  }

  return { profile: null, assumption: "Brand profile not found; fell back to persuasive voice." };
}

function loadToneDescription(input: ToneRawInput): { toneDescription: string | null; assumptions: string[] } {
  const assumptions: string[] = [];
  const parts: string[] = [];

  if (input.toneDesc?.trim()) {
    parts.push(input.toneDesc.trim());
  }

  if (input.toneFile?.trim()) {
    const resolved = resolve(input.toneFile.trim());
    if (existsSync(resolved)) {
      parts.push(readFileSync(resolved, "utf8").trim());
      assumptions.push(`Loaded personal tone file from ${resolved}.`);
    }
  }

  if (parts.length > 1) {
    assumptions.push("Merged --tone-desc and --tone-file into one personal tone description.");
  }

  if (parts.length === 0) {
    const fallbackFiles = [join(PROFILES_DIR, "personal-voice.md"), join(PROFILES_DIR, "personal-voice.txt")];
    const found = fallbackFiles.find((candidate) => existsSync(candidate));
    if (found) {
      assumptions.push(`Loaded default personal voice description from ${found}.`);
      return { toneDescription: readFileSync(found, "utf8").trim(), assumptions };
    }

    assumptions.push("No personal tone description provided; used Corina base voice defaults.");
    return {
      toneDescription: "Warm, direct, clear, professional, and specific. Short to medium sentences. No hype.",
      assumptions,
    };
  }

  return { toneDescription: parts.join("\n\n"), assumptions };
}

function parseWriterResponse(text: string): { assumptions: string[]; rewrittenContent: string } {
  const normalized = text.replace(/\r\n/g, "\n");
  const rewrittenMatch = normalized.match(/## REWRITTEN CONTENT\s*\n([\s\S]*)$/i);
  const assumptionsMatch = normalized.match(/## ASSUMPTIONS\s*\n([\s\S]*?)\n## /i);

  const assumptions = assumptionsMatch
    ? assumptionsMatch[1]
        .split("\n")
        .map((line) => line.replace(/^[-*•]\s*/, "").trim())
        .filter((line) => line && line.toLowerCase() !== "none")
    : [];

  return {
    assumptions,
    rewrittenContent: rewrittenMatch?.[1]?.trim() || normalized.trim(),
  };
}

function buildHumanizerScore(text: string): { score: number; remaining_flags: string[] } {
  const lower = text.toLowerCase();
  const remaining_flags = AI_PATTERNS.filter((pattern) => lower.includes(pattern));
  return {
    score: Math.max(0, 100 - remaining_flags.length * 10),
    remaining_flags,
  };
}

function extractImportantTokens(text: string): string[] {
  const tokens = text.match(/\b(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*|\d{1,4}(?:[%:/.-]\d+)?|20\d{2}|19\d{2})\b/g) ?? [];
  return [...new Set(tokens.map((token) => token.trim()).filter(Boolean))].slice(0, 20);
}

function localValidate(
  originalText: string,
  rewrittenText: string,
  voice: ToneVoice,
  format: ToneFormat,
): ToneValidationArtifact {
  const lower = rewrittenText.toLowerCase();
  const ai_patterns_found = AI_PATTERNS.filter((pattern) => lower.includes(pattern));
  const importantTokens = extractImportantTokens(originalText);
  const entity_gaps = importantTokens.filter((token) => !rewrittenText.includes(token));
  const format_match =
    format === "email"
      ? /\b(hi|hello|dear|best|thanks|regards)\b/i.test(rewrittenText)
      : format === "social"
        ? rewrittenText.split("\n").filter(Boolean).length >= 1
        : true;

  const voice_checks = [`Applied ${voice} voice heuristics.`];
  const preservation_checks = entity_gaps.length
    ? [`Potentially missing: ${entity_gaps.join(", ")}`]
    : ["Named entities, numbers, and dates appear preserved."];
  const validator_notes = [
    ai_patterns_found.length ? `AI patterns found: ${ai_patterns_found.join(", ")}` : "No key AI patterns found.",
    format_match ? `Format aligns with ${format}.` : `Format may not align with ${format}.`,
  ];
  const correction_instructions: string[] = [];

  if (entity_gaps.length) {
    correction_instructions.push("Restore missing names, numbers, and dates from the source.");
  }
  if (ai_patterns_found.length) {
    correction_instructions.push("Remove the flagged AI-pattern words and replace them with concrete phrasing.");
  }
  if (!format_match) {
    correction_instructions.push(`Adapt the output so it reads like ${format}.`);
  }

  const validation_score = Math.max(0, 100 - entity_gaps.length * 20 - ai_patterns_found.length * 10 - (format_match ? 0 : 15));

  return {
    pass: entity_gaps.length === 0 && ai_patterns_found.length === 0 && format_match,
    validation_score,
    voice_checks,
    preservation_checks,
    entity_gaps,
    ai_patterns_found,
    format_match,
    validator_notes,
    correction_instructions,
  };
}

async function runWriter(
  client: OpenCodeClient,
  inputArtifact: ToneInputArtifact,
  voiceProfile: string,
  extraInstructions?: string[],
): Promise<{ assumptions: string[]; rewrittenContent: string }> {
  const sessionResponse = await client.session.create({ body: { title: "Corina tone writer" } });
  const session = unwrapData<{ id: string }>(sessionResponse);

  try {
    await promptSession(client, session.id, {
      agent: "corina-tone-writer",
      noReply: true,
      parts: [{ type: "text", text: loadPrompt("corina-tone-writer.txt") }],
    });

    const result = await promptSession(client, session.id, {
      agent: "corina-tone-writer",
      parts: [
        {
          type: "text",
          text: [
            "VOICE PROFILE:",
            voiceProfile,
            "",
            "TONE INPUT ARTIFACT:",
            JSON.stringify(inputArtifact, null, 2),
            ...(extraInstructions?.length ? ["", "TARGETED FIX INSTRUCTIONS:", ...extraInstructions] : []),
          ].join("\n"),
        },
      ],
    });

    return parseWriterResponse(extractText(unwrapData<any>(result)?.parts));
  } finally {
    await deleteSession(client, session.id);
  }
}

async function runValidator(
  client: OpenCodeClient,
  originalText: string,
  rewrittenText: string,
  voice: ToneVoice,
  format: ToneFormat,
): Promise<ToneValidationArtifact> {
  const sessionResponse = await client.session.create({ body: { title: "Corina tone validator" } });
  const session = unwrapData<{ id: string }>(sessionResponse);

  try {
    await promptSession(client, session.id, {
      agent: "corina-tone-validator",
      noReply: true,
      parts: [{ type: "text", text: loadPrompt("corina-tone-validator.txt") }],
    });

    const result = await promptSession(client, session.id, {
      agent: "corina-tone-validator",
      parts: [
        {
          type: "text",
          text: [
            `VOICE: ${voice}`,
            `FORMAT: ${format}`,
            "",
            "ORIGINAL TEXT:",
            originalText,
            "",
            "REWRITTEN TEXT:",
            rewrittenText,
          ].join("\n"),
        },
      ],
      format: {
        type: "json_schema",
        schema: JSON.parse(readFileSync(join(SCHEMAS_DIR, "ToneValidationArtifact.json"), "utf8")),
        retryCount: 2,
      },
    });

    return parseJsonText<ToneValidationArtifact>(result);
  } catch {
    return localValidate(originalText, rewrittenText, voice, format);
  } finally {
    await deleteSession(client, session.id);
  }
}

function buildChangesSummary(voice: ToneVoice, format: ToneFormat, originalText: string, rewrittenText: string): string[] {
  const summary = [`Applied ${voice} voice rules.`, `Adapted structure for ${format} format.`];
  if (originalText.length !== rewrittenText.length) {
    summary.push("Adjusted rhythm and sentence structure while preserving the source meaning.");
  }
  return summary;
}

function makeToneOutputArtifact(
  rewrittenContent: string,
  voice: ToneVoice,
  format: ToneFormat,
  assumptions: string[],
  validator: ToneValidationArtifact,
  originalText: string,
): ToneOutputArtifact {
  const humanizer_score = buildHumanizerScore(rewrittenContent);
  return {
    rewritten_content: rewrittenContent,
    final_content: rewrittenContent,
    voice_applied: voice,
    format_applied: format,
    changes_summary: buildChangesSummary(voice, format, originalText, rewrittenContent),
    humanizer_score,
    preservation_check: {
      meaning_preserved: validator.entity_gaps.length === 0,
      flagged_drift: validator.entity_gaps,
    },
    validator_notes: validator.validator_notes,
    assumptions,
    validation_score: validator.validation_score,
  };
}

export async function runTonePipeline(input: ToneRawInput, client: OpenCodeClient): Promise<ToneOutputArtifact> {
  const assumptions: string[] = [];
  const { text: sourceText, sourcePath } = maybeResolveTextInput(input.text);
  const originalText = cleanText(sourceText);

  if (!originalText) {
    const emptyOutput: ToneOutputArtifact = {
      rewritten_content: "No content to rewrite.",
      final_content: "No content to rewrite.",
      voice_applied: "persuasive",
      format_applied: "other",
      changes_summary: ["Returned a safe single-line fallback for empty input."],
      humanizer_score: { score: 100, remaining_flags: [] },
      preservation_check: { meaning_preserved: true, flagged_drift: [] },
      validator_notes: ["Input was empty."],
      assumptions: ["Source text was empty."],
      validation_score: 100,
    };
    return emptyOutput;
  }

  let voice = (input.voice?.trim() as ToneVoice | undefined) ?? inferVoice(originalText);
  if (!input.voice?.trim()) {
    assumptions.push(`Voice inferred as ${voice}.`);
  }

  let format = (input.format?.trim() as ToneFormat | undefined) ?? inferFormat(originalText);
  if (!input.format?.trim()) {
    assumptions.push(`Format inferred as ${format}.`);
  }

  let audience = input.audience?.trim() || inferAudience(voice);
  if (!input.audience?.trim() && audience) {
    assumptions.push(`Audience defaulted to ${audience}.`);
  }

  let brandProfile: BrandProfile | null = null;
  let toneDescription: string | null = null;
  let personalToneProfile: PersonalVoiceProfile | null = null;

  if (voice === "brand") {
    if (input.toneDesc || input.toneFile) {
      assumptions.push("Ignored personal tone inputs because brand voice was requested.");
    }

    const loaded = loadBrandProfile(input.profile);
    if (loaded.assumption) {
      assumptions.push(loaded.assumption);
    }

    if (loaded.profile) {
      brandProfile = loaded.profile;
    } else {
      voice = "persuasive";
    }
  }

  if (voice === "personal") {
    if (input.profile) {
      assumptions.push("Ignored --profile because personal voice was requested.");
    }
    const loaded = loadToneDescription(input);
    assumptions.push(...loaded.assumptions);
    toneDescription = loaded.toneDescription;
    personalToneProfile = buildPersonalVoiceProfile(toneDescription ?? "");
  } else if (input.toneDesc || input.toneFile) {
    assumptions.push("Ignored personal tone inputs because personal voice was not requested.");
  }

  const inputArtifact: ToneInputArtifact = {
    original_text: originalText,
    source_path: sourcePath,
    voice,
    format,
    audience: audience ?? null,
    brand_profile: brandProfile,
    tone_description: toneDescription,
    personal_tone_profile: personalToneProfile,
    preservation_instructions: ["Preserve facts, named entities, dates, numbers, and core claims."],
    detected_source_format: inferFormat(originalText),
    source_metrics: {
      character_count: originalText.length,
      word_count: countWords(originalText),
      paragraph_count: originalText.split(/\n{2,}/).filter(Boolean).length,
      heading_count: detectHeadingCount(originalText),
    },
  };

  const inputValidation = validate("ToneInputArtifact", inputArtifact);
  if (!inputValidation.valid) {
    assumptions.push(`ToneInputArtifact validation warning: ${inputValidation.errors.join("; ")}`);
  }

  const voiceProfilePath = join(VOICES_DIR, `${voice}.txt`);
  const voiceProfile = existsSync(voiceProfilePath)
    ? loadPrompt(voiceProfilePath)
    : `Voice profile missing for ${voice}. Preserve facts. Produce usable output.`;

  const firstPass = await runWriter(client, inputArtifact, voiceProfile);
  let rewrittenContent = firstPass.rewrittenContent || originalText;
  assumptions.push(...firstPass.assumptions);

  let validator = await runValidator(client, originalText, rewrittenContent, voice, format);

  if (!validator.pass && validator.correction_instructions.length > 0) {
    assumptions.push("Validator requested one targeted correction pass.");
    const fixPass = await runWriter(client, inputArtifact, voiceProfile, validator.correction_instructions);
    rewrittenContent = fixPass.rewrittenContent || rewrittenContent;
    assumptions.push(...fixPass.assumptions);
    validator = await runValidator(client, originalText, rewrittenContent, voice, format);
  }

  const outputArtifact = makeToneOutputArtifact(rewrittenContent, voice, format, assumptions, validator, originalText);
  const outputValidation = validate("ToneOutputArtifact", outputArtifact);
  if (!outputValidation.valid) {
    outputArtifact.validator_notes = [
      ...outputArtifact.validator_notes,
      `ToneOutputArtifact validation warning: ${outputValidation.errors.join("; ")}`,
    ];
  }

  return outputArtifact;
}
