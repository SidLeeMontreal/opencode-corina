import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { RunCritiqueOptions } from "./critique.js";
import { PROMPTS_DIR, promptExists, loadPrompt } from "./prompt-loader.js";
import { inferFormat, inferVoice } from "./tone-defaults.js";
import type {
  EvaluationContext,
  EvaluationKind,
  EvaluationModule,
  ResolvedRubric,
  ToneVoice,
  WorkflowState,
} from "./types.js";

const EVIDENCE_VOICES = new Set<ToneVoice | "unknown">(["persuasive", "executive", "brand", "journalist"]);
const FORMAT_SUPPORTED = new Set(["article", "slide", "email", "social", "brief"]);

function loadVoicePrompt(voice: ToneVoice | null | undefined): string | null {
  if (!voice) {
    return null;
  }

  const relativePath = `voices/${voice}.md`;
  return promptExists(relativePath) ? loadPrompt(relativePath) : null;
}

function loadBrandProfile(voice: ToneVoice | null | undefined): string | null {
  if (voice !== "brand") {
    return null;
  }

  const voicePrompt = loadVoicePrompt(voice);
  return voicePrompt || null;
}

export const EVALUATION_MODULES: EvaluationModule[] = [
  {
    id: "prose-evaluator",
    family: "prose",
    kinds: ["critic", "auditor"],
    order: 1,
    applies: () => true,
  },
  {
    id: "voice-evaluator",
    family: "voice",
    kinds: ["critic", "auditor"],
    order: 2,
    applies: () => true,
  },
  {
    id: "evidence-evaluator",
    family: "evidence",
    kinds: ["critic", "auditor"],
    order: 3,
    applies: (context) => EVIDENCE_VOICES.has(context.requested_voice ?? "unknown"),
  },
  {
    id: "format-auditor",
    family: "format",
    kinds: ["auditor"],
    order: 4,
    applies: (context) => Boolean(context.requested_format && FORMAT_SUPPORTED.has(context.requested_format)),
  },
  {
    id: "critic-adjudicator",
    family: "system",
    kinds: ["critic"],
    order: 99,
    applies: () => true,
  },
  {
    id: "auditor-adjudicator",
    family: "system",
    kinds: ["auditor"],
    order: 99,
    applies: () => true,
  },
];

export function selectModules(context: EvaluationContext, kind: EvaluationKind): EvaluationModule[] {
  return EVALUATION_MODULES
    .filter((module) => module.kinds.includes(kind))
    .filter((module) => module.applies(context))
    .sort((a, b) => a.order - b.order);
}

function normalizeConstraints(constraints: string[] | undefined): string[] {
  return (constraints ?? []).map((item) => item.trim()).filter(Boolean);
}

function normalizeRequestedVoice(optionsVoice: string | undefined, fallbackText: string): ToneVoice | null {
  const direct = optionsVoice?.trim();
  if (direct) {
    return direct as ToneVoice;
  }

  return inferVoice(fallbackText);
}

export function buildEvaluationContextFromCritiqueArgs(
  args: RunCritiqueOptions,
  draft: string,
  brief?: string,
  resolvedRubric?: ResolvedRubric,
): EvaluationContext {
  const mode = args.mode ?? "quality";
  const requested_voice = normalizeRequestedVoice(args.voice, draft);
  return {
    kind: "critic",
    draft_text: draft,
    brief_text: brief ?? null,
    requested_voice,
    requested_format: inferFormat(draft),
    voice_prompt: loadVoicePrompt(requested_voice),
    brand_profile: requested_voice === "brand"
      ? {
          name: "brand",
          voice_statement: loadBrandProfile(requested_voice) ?? "",
          core_rules: [],
          banned_words: [],
          banned_phrases: [],
          tone_adjectives: [],
          sample_approved: [],
          sample_rejected: [],
        }
      : null,
    user_constraints: [],
    mode,
    audience: mode === "audience" ? args.audience ?? null : null,
    rubric_id: mode === "rubric" ? resolvedRubric?.id ?? args.rubric ?? null : null,
    rubric_text: mode === "rubric" ? resolvedRubric?.raw_markdown ?? null : null,
    metadata: {
      pipeline_step: "critique",
      chain: args.chain ?? null,
      rubric_name: mode === "rubric" ? resolvedRubric?.name ?? null : null,
      rubric_source_path: mode === "rubric" ? resolvedRubric?.source_path ?? null : null,
    },
  };
}

export function buildEvaluationContextFromWorkflowState(state: WorkflowState, kind: "audit"): EvaluationContext {
  const draftText = state.draftArtifact?.content ?? "";
  const requested_voice = state.requested_voice ?? inferVoice(draftText);
  return {
    kind: kind === "audit" ? "auditor" : "critic",
    draft_text: draftText,
    brief_text: state.briefText,
    requested_voice,
    requested_format: inferFormat(draftText),
    voice_prompt: state.voice_prompt ?? loadVoicePrompt(requested_voice),
    brand_profile: requested_voice === "brand"
      ? {
          name: "brand",
          voice_statement: state.voice_prompt ?? loadBrandProfile(requested_voice) ?? "",
          core_rules: [],
          banned_words: [],
          banned_phrases: [],
          tone_adjectives: [],
          sample_approved: [],
          sample_rejected: [],
        }
      : null,
    user_constraints: normalizeConstraints(state.user_constraints),
    mode: null,
    audience: state.briefArtifact?.audience ?? null,
    rubric_id: null,
    rubric_text: null,
    metadata: {
      pipeline_step: "audit",
      critique_pass: state.critiquePasses,
    },
  };
}
