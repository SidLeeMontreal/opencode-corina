import type { PluginInput } from "@opencode-ai/plugin";
import type { StepModelConfig } from "opencode-model-resolver";

export type OpenCodeClient = PluginInput["client"];
export type { ModelInfo, Preset, ResolvedModel, StepModelConfig } from "opencode-model-resolver";

export type ToneVoice =
  | "journalist"
  | "technical"
  | "persuasive"
  | "social"
  | "ux"
  | "seo"
  | "accessibility"
  | "executive"
  | "brand"
  | "email"
  | "personal";

export type ToneFormat = "article" | "social" | "slide" | "email" | "brief" | "other";

export interface PipelineModelConfig {
  provider: string;
  briefIntake: StepModelConfig;
  outline: StepModelConfig;
  draft: StepModelConfig;
  critique: StepModelConfig;
  revise: StepModelConfig;
  audit: StepModelConfig;
}

export interface BriefArtifact {
  objective: string;
  audience: string;
  tone: "analytical" | "conversational" | "authoritative" | "narrative";
  format: "article" | "white paper" | "slide" | "social" | "email" | "other";
  constraints: string[];
  missing_info: string[];
  success_rubric: string[];
}

export interface OutlineSection {
  section: string;
  intent: string;
  evidence_needed?: string[];
}

export interface OutlineArtifact {
  thesis: string;
  structure: OutlineSection[];
  risks: string[];
  editorial_intent: string;
}

export interface DraftArtifact {
  content: string;
  word_count: number;
  claims?: string[];
  assumptions?: string[];
  open_risks?: string[];
}

export interface CritiqueDimensionScore {
  score: number;
  issues: string[];
}

export interface CritiqueArtifact {
  pass: boolean;
  overall_score: number;
  dimensions: {
    ai_patterns: CritiqueDimensionScore;
    corina_tone: CritiqueDimensionScore;
    precision: CritiqueDimensionScore;
    evidence: CritiqueDimensionScore;
    rhythm: CritiqueDimensionScore;
  };
  revision_instructions: string[];
  fatal_issues: string[];
}

export interface AuditArtifact {
  approved_for_delivery: boolean;
  ai_patterns_remaining: string[];
  banned_words_remaining: string[];
  style_violations: string[];
  publishability_note: string;
  final_content?: string | null;
}

export interface PersonalVoiceProfile {
  sentence_length: "short" | "varied" | "long" | "unspecified";
  vocabulary_register: "casual" | "professional" | "technical" | "mixed" | "unspecified";
  personality_markers: string[];
  avoid: string[];
  explicit_style_rules: string[];
}

export interface BrandProfile {
  name: string;
  voice_statement: string;
  core_rules: string[];
  banned_words: string[];
  banned_phrases: string[];
  tone_adjectives: string[];
  sample_approved: string[];
  sample_rejected: string[];
}

export interface ToneSourceMetrics {
  character_count: number;
  word_count: number;
  paragraph_count: number;
  heading_count: number;
}

export interface ToneInputArtifact {
  original_text: string;
  source_path?: string | null;
  voice: ToneVoice;
  format: ToneFormat;
  audience?: string | null;
  brand_profile?: BrandProfile | null;
  tone_description?: string | null;
  personal_tone_profile?: PersonalVoiceProfile | null;
  preservation_instructions?: string[];
  detected_source_format?: string | null;
  source_metrics?: ToneSourceMetrics | null;
}

export interface ToneValidationArtifact {
  pass: boolean;
  validation_score: number;
  voice_checks: string[];
  preservation_checks: string[];
  entity_gaps: string[];
  ai_patterns_found: string[];
  format_match: boolean;
  validator_notes: string[];
  correction_instructions: string[];
}

export interface ToneOutputArtifact {
  rewritten_content: string;
  final_content: string;
  voice_applied: ToneVoice;
  format_applied: ToneFormat;
  changes_summary: string[];
  humanizer_score: {
    score: number;
    remaining_flags: string[];
  };
  preservation_check?: {
    meaning_preserved: boolean;
    flagged_drift: string[];
  } | null;
  validator_notes: string[];
  assumptions: string[];
  validation_score: number;
}

export interface ToneRawInput {
  text: string;
  voice?: string;
  format?: string;
  audience?: string;
  toneDesc?: string;
  toneFile?: string;
  profile?: string;
  modelPreset?: string;
}

export interface WorkflowState {
  briefText: string;
  briefArtifact?: BriefArtifact;
  outlineArtifact?: OutlineArtifact;
  draftArtifact?: DraftArtifact;
  critiqueArtifact?: CritiqueArtifact;
  auditArtifact?: AuditArtifact;
  critiquePasses: number;
  warnings: string[];
}

export interface StepResult<T> {
  artifact: T;
  warnings?: string[];
  retrySuggested?: boolean;
}

export interface AuditLogEntry {
  timestamp: string;
  event: string;
  sessionId?: string;
  briefPreview?: string;
  outcome?: string;
  metadata?: Record<string, unknown>;
}
