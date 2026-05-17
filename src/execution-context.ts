import { randomUUID } from "node:crypto";

import type {
  AuditArtifact,
  BriefArtifact,
  CritiqueArtifact,
  DraftArtifact,
  ExecutionFinding,
  ExecutionFindingSeverity,
  OutlineArtifact,
  PipelineExecutionCapability,
  PipelineExecutionContext,
  PipelineExecutionContextDelta,
} from "./types.js";

const DEFAULT_MAX_FINDINGS = 6;
const SEVERITY_RANK: Record<ExecutionFindingSeverity, number> = {
  fatal: 0,
  major: 1,
  medium: 2,
  low: 3,
};

export interface InitializePipelineExecutionContextInput {
  runId?: string;
  capability: PipelineExecutionCapability;
  userIntentSummary?: string;
  requestedOperation?: string;
  sourceMaterialRefs?: string[];
  userConstraints?: string[];
  globalInstructions?: string[];
  voice?: PipelineExecutionContext["voice"];
  content?: Partial<PipelineExecutionContext["content"]>;
  findings?: ExecutionFinding[];
  assumptions?: string[];
  stepHistory?: string[];
}

export interface BuildContextBlockOptions {
  maxFindings?: number;
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanList(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map(clean).filter(Boolean))];
}

function listLine(values: string[]): string {
  return values.length ? values.join("; ") : "none";
}

function findingKey(finding: ExecutionFinding): string {
  return [
    finding.step,
    finding.type,
    finding.severity,
    finding.summary,
    finding.location ?? "",
    finding.action ?? "",
  ].join("|");
}

function normalizeFindings(findings: ExecutionFinding[]): ExecutionFinding[] {
  const seen = new Set<string>();
  const normalized: ExecutionFinding[] = [];

  for (const finding of findings) {
    const summary = clean(finding.summary);
    if (!summary) continue;

    const item: ExecutionFinding = {
      step: clean(finding.step) || "unknown",
      type: clean(finding.type) || "finding",
      severity: finding.severity,
      summary,
      location: finding.location ? clean(finding.location) : null,
      action: finding.action ? clean(finding.action) : null,
    };
    const key = findingKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(item);
  }

  return normalized;
}

function sortedFindings(findings: ExecutionFinding[]): ExecutionFinding[] {
  return [...normalizeFindings(findings)].sort((a, b) => {
    const severity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (severity !== 0) return severity;
    return a.step.localeCompare(b.step) || a.summary.localeCompare(b.summary);
  });
}

export function initializePipelineExecutionContext(
  input: InitializePipelineExecutionContextInput,
): PipelineExecutionContext {
  return {
    run_id: input.runId ?? randomUUID(),
    capability: input.capability,
    user_intent_summary: clean(input.userIntentSummary ?? "No intent summary available."),
    requested_operation: clean(input.requestedOperation ?? input.capability),
    source_material_refs: cleanList(input.sourceMaterialRefs),
    user_constraints: cleanList(input.userConstraints),
    global_instructions: cleanList(input.globalInstructions),
    voice: {
      name: input.voice?.name ?? null,
      tone_description: input.voice?.tone_description ? clean(input.voice.tone_description) : null,
      profile_ref: input.voice?.profile_ref ? clean(input.voice.profile_ref) : null,
      key_rules: cleanList(input.voice?.key_rules),
      banned_patterns: cleanList(input.voice?.banned_patterns),
    },
    content: {
      format: input.content?.format ? clean(input.content.format) : null,
      audience: input.content?.audience ? clean(input.content.audience) : null,
      word_count: input.content?.word_count ?? null,
      scope: input.content?.scope ?? "full_document",
      fragment_label: input.content?.fragment_label ? clean(input.content.fragment_label) : null,
      fragment_position: input.content?.fragment_position ? clean(input.content.fragment_position) : null,
      full_document_ref: input.content?.full_document_ref ? clean(input.content.full_document_ref) : null,
      full_document_summary: input.content?.full_document_summary ? clean(input.content.full_document_summary) : null,
    },
    findings: sortedFindings(input.findings ?? []),
    assumptions: cleanList(input.assumptions),
    step_history: cleanList(input.stepHistory),
  };
}

export function mergePipelineExecutionContextDelta(
  context: PipelineExecutionContext,
  delta: PipelineExecutionContextDelta,
): PipelineExecutionContext {
  return initializePipelineExecutionContext({
    runId: context.run_id,
    capability: context.capability,
    userIntentSummary: delta.user_intent_summary ?? context.user_intent_summary,
    requestedOperation: delta.requested_operation ?? context.requested_operation,
    sourceMaterialRefs: [...context.source_material_refs, ...(delta.source_material_refs ?? [])],
    userConstraints: [...context.user_constraints, ...(delta.user_constraints ?? [])],
    globalInstructions: [...context.global_instructions, ...(delta.global_instructions ?? [])],
    voice: {
      ...context.voice,
      ...delta.voice,
      key_rules: [...context.voice.key_rules, ...(delta.voice?.key_rules ?? [])],
      banned_patterns: [...context.voice.banned_patterns, ...(delta.voice?.banned_patterns ?? [])],
    },
    content: {
      ...context.content,
      ...delta.content,
    },
    findings: [...context.findings, ...(delta.findings ?? [])],
    assumptions: [...context.assumptions, ...(delta.assumptions ?? [])],
    stepHistory: [...context.step_history, ...(delta.step_history ?? [])],
  });
}

export function buildContextBlock(
  context: PipelineExecutionContext,
  options: BuildContextBlockOptions = {},
): string {
  const findings = sortedFindings(context.findings)
    .slice(0, options.maxFindings ?? DEFAULT_MAX_FINDINGS)
    .map((finding) => {
      const location = finding.location ? ` (${finding.location})` : "";
      const action = finding.action ? ` -> ${finding.action}` : "";
      return `- ${finding.step}: [${finding.severity}] ${finding.summary}${location}${action}`;
    });

  return [
    "=== PIPELINE CONTEXT ===",
    `Run id: ${context.run_id}`,
    `Capability: ${context.capability} | Requested operation: ${context.requested_operation}`,
    `Intent: ${context.user_intent_summary}`,
    `Voice: ${context.voice.name ?? "none"} | Tone: ${context.voice.tone_description ?? "none"} | Profile ref: ${context.voice.profile_ref ?? "none"}`,
    `Voice rules: ${listLine(context.voice.key_rules)}`,
    `Banned patterns: ${listLine(context.voice.banned_patterns)}`,
    `User constraints: ${listLine(context.user_constraints)}`,
    `Global instructions: ${listLine(context.global_instructions)}`,
    `Format: ${context.content.format ?? "unknown"} | Audience: ${context.content.audience ?? "unknown"} | Scope: ${context.content.scope}`,
    `Word count: ${context.content.word_count ?? "unknown"}`,
    context.content.scope === "fragment"
      ? `Fragment context: ${context.content.fragment_label ?? "fragment"}${context.content.fragment_position ? ` (${context.content.fragment_position})` : ""}`
      : "Document context: full document",
    context.content.full_document_ref ? `Full document ref: ${context.content.full_document_ref}` : null,
    context.content.full_document_summary ? `Full document summary: ${context.content.full_document_summary}` : null,
    `Source refs: ${listLine(context.source_material_refs)}`,
    `Prior findings:\n${findings.length ? findings.join("\n") : "- none"}`,
    `Assumptions: ${listLine(context.assumptions)}`,
    `Step history: ${listLine(context.step_history)}`,
    "=== END PIPELINE CONTEXT ===",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function contextDeltaFromBriefArtifact(brief: BriefArtifact): PipelineExecutionContextDelta {
  return {
    user_intent_summary: brief.objective,
    requested_operation: `draft ${brief.format}`,
    user_constraints: brief.constraints,
    content: {
      audience: brief.audience,
      format: brief.format,
      scope: "full_document",
    },
    voice: {
      tone_description: brief.tone,
    },
    findings: brief.missing_info.map((item) => ({
      step: "brief_intake",
      type: "missing_info",
      severity: "major",
      summary: item,
      action: "Ask for clarification or proceed with explicit caveat.",
    })),
    step_history: ["brief_intake"],
  };
}

export function contextDeltaFromOutlineArtifact(outline: OutlineArtifact): PipelineExecutionContextDelta {
  return {
    content: {
      full_document_summary: outline.thesis,
    },
    findings: outline.risks.map((risk) => ({
      step: "outline",
      type: "risk",
      severity: "medium",
      summary: risk,
      action: "Account for this risk in drafting and audit.",
    })),
    step_history: ["outline"],
  };
}

export function contextDeltaFromDraftArtifact(draft: DraftArtifact): PipelineExecutionContextDelta {
  return {
    content: {
      word_count: draft.word_count,
    },
    assumptions: draft.assumptions ?? [],
    findings: (draft.open_risks ?? []).map((risk) => ({
      step: "draft",
      type: "open_risk",
      severity: "medium",
      summary: risk,
      action: "Resolve before final delivery where possible.",
    })),
    step_history: ["draft"],
  };
}

export function contextDeltaFromCritiqueArtifact(
  critique: CritiqueArtifact,
  pass: number,
): PipelineExecutionContextDelta {
  const findings: ExecutionFinding[] = [
    ...critique.fatal_issues.map((issue) => ({
      step: `critique_pass_${pass}`,
      type: "fatal_issue",
      severity: "fatal" as const,
      summary: issue,
      action: "Revise before audit.",
    })),
    ...critique.revision_instructions.map((instruction) => ({
      step: `critique_pass_${pass}`,
      type: "revision_instruction",
      severity: critique.pass ? "low" as const : "major" as const,
      summary: instruction,
      action: "Apply during revision.",
    })),
  ];

  return {
    findings,
    step_history: [`critique_pass_${pass}`],
  };
}

export function contextDeltaFromAuditArtifact(audit: AuditArtifact): PipelineExecutionContextDelta {
  return {
    findings: [
      ...audit.ai_patterns_remaining.map((pattern) => ({
        step: "audit",
        type: "ai_pattern_remaining",
        severity: "major" as const,
        summary: pattern,
        action: "Remove before delivery.",
      })),
      ...audit.banned_words_remaining.map((word) => ({
        step: "audit",
        type: "banned_word_remaining",
        severity: "fatal" as const,
        summary: word,
        action: "Remove before delivery.",
      })),
      ...audit.style_violations.map((violation) => ({
        step: "audit",
        type: "style_violation",
        severity: "medium" as const,
        summary: violation,
        action: "Revise for style compliance.",
      })),
    ],
    step_history: ["audit"],
  };
}
