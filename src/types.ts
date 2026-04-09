import type { PluginInput } from "@opencode-ai/plugin";
import type { StepModelConfig } from "opencode-model-resolver";

export type OpenCodeClient = PluginInput["client"];
export type { ModelInfo, Preset, ResolvedModel, StepModelConfig } from "opencode-model-resolver";

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
