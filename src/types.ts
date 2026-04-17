import type { PluginInput } from "@opencode-ai/plugin";
import type { StepModelConfig } from "opencode-model-resolver";

export type OpenCodeClient = PluginInput["client"];
export type { AgentCapabilityOutput } from "opencode-text-tools";
export type { ModelInfo, Preset, ResolvedModel, StepModelConfig } from "opencode-model-resolver";

export type ToolOutcome = "success" | "degraded" | "failed";

export interface CorinaToolEnvelope<TArtifact> {
  agent: "corina";
  capability: string;
  outcome: ToolOutcome;
  should_persist: boolean;
  artifact: TArtifact | null;
  rendered: string;
  warnings: string[];
  metrics: {
    total_tokens?: number;
    total_cost?: number;
  };
  version: string;
  timestamp: string;
  input_summary: string;
  chained_to?: string;
  chain_result?: unknown;
}

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
export type DetectionFormat = "inline" | "report" | "json";
export type DetectionConfidence = "high" | "medium" | "low";
export type DetectionVerdict = "clean" | "probably_human" | "possibly_ai" | "likely_ai";
export type DetectionRuleSource = "layer_1" | "layer_2";
export type DetectionCategory = "content" | "language" | "style" | "communication" | "filler";

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

export type EvaluationKind = "critic" | "auditor";
export type EvaluationModuleId =
  | "prose-evaluator"
  | "voice-evaluator"
  | "evidence-evaluator"
  | "format-auditor"
  | "critic-adjudicator"
  | "auditor-adjudicator";
export type EvaluationSeverity = "blocking" | "major" | "minor";
export type EvaluationModuleFamily = "prose" | "voice" | "evidence" | "format" | "system";
export type ModuleRunStatus = "ok" | "skipped" | "degraded";

export interface EvaluationFinding {
  module: EvaluationModuleFamily;
  rule_id: string;
  severity: EvaluationSeverity;
  location?: string | null;
  excerpt: string;
  explanation: string;
  score_impact: number;
  fix_hint: string;
  duplicate_key?: string | null;
}

export interface EvaluationContext {
  kind: EvaluationKind;
  draft_text: string;
  brief_text?: string | null;
  requested_voice?: ToneVoice | null;
  requested_format?: ToneFormat | null;
  voice_prompt?: string | null;
  brand_profile?: BrandProfile | null;
  user_constraints: string[];
  mode?: CritiqueMode | null;
  audience?: string | null;
  rubric_id?: string | null;
  rubric_text?: string | null;
  metadata: Record<string, unknown>;
}

export interface ModuleOutput {
  module_id: EvaluationModuleId;
  status: "ok" | "skipped" | "degraded";
  skipped: boolean;
  findings: EvaluationFinding[];
  summary: string;
  errors?: string[];
  warnings?: string[];
  metrics?: {
    total_tokens?: number;
    total_cost?: number;
    duration_ms?: number;
    model_id?: string;
    provider_id?: string;
  };
}

export interface EvaluationModule {
  id: EvaluationModuleId;
  family: EvaluationModuleFamily;
  kinds: EvaluationKind[];
  order: number;
  applies: (context: EvaluationContext) => boolean;
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
    tone: CritiqueDimensionScore;
    precision: CritiqueDimensionScore;
    evidence: CritiqueDimensionScore;
    rhythm: CritiqueDimensionScore;
  };
  revision_instructions: string[];
  fatal_issues: string[];
  findings?: EvaluationFinding[];
  module_status?: Partial<Record<EvaluationModuleId, ModuleRunStatus>>;
  degraded?: boolean;
}

export interface AuditArtifact {
  approved_for_delivery: boolean;
  ai_patterns_remaining: string[];
  banned_words_remaining: string[];
  style_violations: string[];
  publishability_note: string;
  final_content?: string | null;
  findings?: EvaluationFinding[];
  module_status?: Partial<Record<EvaluationModuleId, ModuleRunStatus>>;
  degraded?: boolean;
}

export interface DraftToolArtifact {
  final_content: string;
  audit: AuditArtifact;
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
  fixInstructions?: string[];
  preservationInstructions?: string[];
}

export interface PatternFinding {
  pattern_id: string;
  pattern_name: string;
  category: DetectionCategory;
  severity: DetectionConfidence;
  confidence: DetectionConfidence;
  matched_text: string;
  normalized_match: string;
  location_hint: string;
  char_start: number;
  char_end: number;
  rule_source: DetectionRuleSource;
  explanation: string;
  fix_suggestion: string;
  context_before: string;
  context_after: string;
}

export interface DetectionReportInput {
  source_type: "text" | "file";
  source_path: string | null;
  character_count: number;
  word_count: number;
  paragraph_count: number;
  sentence_count: number;
}

export interface DetectionPatternCounts {
  by_pattern: Record<string, number>;
  by_category: Record<string, number>;
  by_severity: Record<DetectionConfidence, number>;
}

export interface DetectionLayer1ScanSummary {
  score: number;
  deep_recommended: boolean;
  rules_triggered: string[];
  ambiguous_patterns: string[];
  notes: string[];
}

export interface Layer2AdditionalFinding {
  pattern_id: string;
  matched_text: string;
  location_hint?: string;
  explanation: string;
  severity: DetectionConfidence;
  confidence: DetectionConfidence;
  fix_suggestion: string;
}

export interface Layer2Analysis {
  ran: boolean;
  score_adjustment: number;
  confirmed_patterns: string[];
  dismissed_patterns: string[];
  reasoning_notes: string[];
  additional_findings: Layer2AdditionalFinding[];
}

export interface DetectionReport {
  overall_score: number;
  confidence: DetectionConfidence;
  verdict: DetectionVerdict;
  summary: string;
  input: DetectionReportInput;
  patterns_found: PatternFinding[];
  pattern_counts: DetectionPatternCounts;
  top_signals: string[];
  layer_1_scan: DetectionLayer1ScanSummary;
  layer_2_analysis: Layer2Analysis | null;
  assumptions: string[];
}

export interface DetectionRawInput {
  text: string;
  format?: DetectionFormat;
  autoFix?: boolean;
  chain?: "pipeline";
  voice?: string;
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
  requested_voice?: ToneVoice;
  voice_prompt?: string;
  user_constraints?: string[];
}

export type CritiqueMode = "quality" | "audience" | "rubric" | "compare";
export type CritiqueRenderFormat = "inline" | "report" | "json";
export type CritiqueChain = "tone" | "pipeline" | "detect";
export type CritiqueStatus = "ok" | "no_input" | "degraded";
export type CritiqueDimensionKey = "ai_patterns" | "tone" | "precision" | "evidence" | "rhythm";
export type AudienceNeedGapType = "clarity" | "evidence" | "relevance" | "trust" | "terminology";

export interface CritiqueDimensionDetail {
  score: number;
  issues: string[];
  strengths: string[];
  evidence?: string[];
}

export interface CritiqueIssue {
  id: string;
  dimension: CritiqueDimensionKey;
  severity: "high" | "medium" | "low";
  summary: string;
  fix_direction: string;
}

export interface CritiqueReport {
  status: CritiqueStatus;
  pass: boolean;
  overall_score: number;
  pass_threshold: number;
  dimensions: Record<CritiqueDimensionKey, CritiqueDimensionDetail>;
  issues: CritiqueIssue[];
  strengths: string[];
  revision_instructions: string[];
  fatal_issues: string[];
  assumptions: string[];
}

export interface AudienceNeedGap {
  type: AudienceNeedGapType;
  summary: string;
  fix_direction: string;
}

export interface AudienceCritiqueReport {
  status: CritiqueStatus;
  audience_requested: string | null;
  audience_applied: string;
  audience_inferred: boolean;
  resonance_score: number;
  what_lands: string[];
  what_misses: string[];
  unclear_points: string[];
  missing_for_audience: string[];
  jargon_risks: string[];
  need_gaps: AudienceNeedGap[];
  rewrite_brief: string[];
  assumptions: string[];
}

export interface RubricDimension {
  id: string;
  name: string;
  max_score: number;
  description: string;
}

export interface ResolvedRubric {
  id: string;
  name: string;
  version: string;
  dimensions: RubricDimension[];
  raw_markdown: string;
  source_path: string;
}

export interface RubricDimensionResult {
  id: string;
  label: string;
  score: number;
  max_score: number;
  rationale: string;
  strengths: string[];
  weaknesses: string[];
  fix_directions: string[];
}

export interface RubricReport {
  status: CritiqueStatus;
  rubric_id: string;
  rubric_name: string;
  voice_profile_hint?: string | null;
  total_score: number;
  max_total_score: number;
  dimensions: RubricDimensionResult[];
  strongest_dimensions: string[];
  weakest_dimensions: string[];
  overall_assessment: string;
  assumptions: string[];
}

export interface ComparisonDelta {
  compared_to: string;
  score_delta: number;
  dimension_deltas: Record<CritiqueDimensionKey, number>;
  summary: string[];
}

export interface RankedVersion {
  rank: number;
  item_id: string;
  label: string;
  critique: CritiqueReport;
  strengths_summary: string[];
  weaknesses_summary: string[];
  deltas_vs_next?: ComparisonDelta | null;
}

export interface ComparisonReport {
  status: CritiqueStatus;
  compared_count: number;
  ranking: RankedVersion[];
  recommended_item_id: string | null;
  recommended_label: string | null;
  recommendation_reason: string;
  winner_text: string | null;
  cross_version_patterns: string[];
  assumptions: string[];
  skipped_inputs: string[];
}

export type CritiqueArtifactUnion = CritiqueReport | AudienceCritiqueReport | RubricReport | ComparisonReport;

export interface StepResult<T> {
  artifact: T;
  warnings?: string[];
  retrySuggested?: boolean;
}

export interface HeatMapEntry {
  tag: string;
  severity: "Minor" | "Moderate" | "Major";
  count: number;
}

export interface RevisionLogEntry {
  id: string;
  original_excerpt: string;
  tags: string[];
  solution_move: string;
  new_text: string;
  scope: "Target" | "Previous bridge" | "Next bridge";
}

export interface PreservationCheck {
  facts: boolean;
  nuance: boolean;
  argument_function: boolean;
  evidence: boolean;
  tone_voice: boolean;
  chronology: boolean;
  notes?: string;
}

export interface ReconciliationEntry {
  id: string;
  location: string;
  issue_type: string;
  what_changed: string;
  reason: string;
}

export interface ParagraphFunctionEntry {
  paragraph: string;
  function: string;
  compression_priority: "High" | "Medium" | "Low" | "None";
  revision_risk: "Low risk" | "Medium risk" | "High risk";
  preservation_constraints: string;
}

export interface ConciseArtifact {
  mode: "quick" | "full";
  original_word_count: number;
  revised_word_count: number;
  compression_ratio: number;
  revised_draft: string;
  heat_map: HeatMapEntry[];
  revision_log: RevisionLogEntry[];
  preservation_check: PreservationCheck;
  unresolved_issues: string[];
  reconciliation_log?: ReconciliationEntry[];
  paragraph_function_map?: ParagraphFunctionEntry[];
}

export interface AuditLogEntry {
  timestamp: string;
  event: "capability_complete" | "session_idle" | "chain_complete";
  capability: string;
  mode?: string;
  session_id?: string;
  input_summary?: string;
  outcome: "success" | "degraded" | "failed";
  duration_ms?: number;
  total_tokens?: number;
  total_cost?: number;
  chain_target?: string;
  assumptions_count?: number;
}
