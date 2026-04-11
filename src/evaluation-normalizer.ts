import type {
  EvaluationFinding,
  EvaluationModuleFamily,
  EvaluationModuleId,
  EvaluationSeverity,
  ModuleOutput,
} from "./types.js";
import { validate } from "./validators.js";

const VALID_RULE_PREFIXES = ["prose.", "voice.", "evidence.", "format.", "system."] as const;
const SEVERITY_RANK: Record<EvaluationSeverity, number> = {
  minor: 1,
  major: 2,
  blocking: 3,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

function normalizeSeverity(value: unknown): EvaluationSeverity | null {
  return value === "blocking" || value === "major" || value === "minor" ? value : null;
}

function normalizeScoreImpact(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }

  return Math.max(-3, Math.min(0, value));
}

export function normalizeExcerpt(excerpt: string): string {
  const trimmed = excerpt.trim();
  if (trimmed.length <= 80) {
    return trimmed;
  }

  return `${trimmed.slice(0, 77)}...`;
}

export function validateRuleId(rule_id: string): boolean {
  return VALID_RULE_PREFIXES.some((prefix) => rule_id.startsWith(prefix)) && rule_id.includes(".", rule_id.indexOf(".") + 1);
}

export function normalizeEvaluationFinding(raw: unknown, module: EvaluationModuleFamily): EvaluationFinding | null {
  const record = asRecord(raw);
  if (!record) {
    return null;
  }

  const rule_id = asString(record["rule_id"]);
  const severity = normalizeSeverity(record["severity"]);
  const excerpt = asString(record["excerpt"]);
  const explanation = asString(record["explanation"]);
  const fix_hint = asString(record["fix_hint"]);
  if (!rule_id || !severity || !excerpt || !explanation || !fix_hint || !validateRuleId(rule_id)) {
    return null;
  }

  const finding: EvaluationFinding = {
    module,
    rule_id,
    severity,
    location: asString(record["location"]),
    excerpt: normalizeExcerpt(excerpt),
    explanation: explanation.trim(),
    score_impact: normalizeScoreImpact(record["score_impact"]),
    fix_hint: fix_hint.trim(),
    duplicate_key: asString(record["duplicate_key"]),
  };

  const validation = validate("EvaluationFinding", finding);
  return validation.valid ? finding : null;
}

function degradedOutput(module_id: EvaluationModuleId, message: string): ModuleOutput {
  return {
    module_id,
    status: "degraded",
    skipped: false,
    findings: [],
    summary: message,
    errors: [message],
  };
}

export function normalizeModuleOutput(raw: unknown, moduleId: EvaluationModuleId): ModuleOutput {
  const record = asRecord(raw);
  if (!record) {
    return degradedOutput(moduleId, `Invalid ${moduleId} output: expected an object.`);
  }

  const status = record["status"] === "ok" || record["status"] === "skipped" || record["status"] === "degraded"
    ? record["status"]
    : "degraded";
  const moduleFamily = moduleId === "prose-evaluator"
    ? "prose"
    : moduleId === "voice-evaluator"
      ? "voice"
      : moduleId === "evidence-evaluator"
        ? "evidence"
        : moduleId === "format-auditor"
          ? "format"
          : "system";

  const findings = Array.isArray(record["findings"])
    ? record["findings"]
        .map((item) => normalizeEvaluationFinding(item, moduleFamily))
        .filter((item): item is EvaluationFinding => Boolean(item))
    : [];

  const metricsRecord = asRecord(record["metrics"]);
  const output: ModuleOutput = {
    module_id: moduleId,
    status,
    skipped: record["skipped"] === true || status === "skipped",
    findings,
    summary: asString(record["summary"])?.trim() || `${moduleId} returned ${status}.`,
    errors: asStringArray(record["errors"]),
    warnings: asStringArray(record["warnings"]),
    metrics: metricsRecord
      ? {
          total_tokens: typeof metricsRecord["total_tokens"] === "number" ? metricsRecord["total_tokens"] : undefined,
          total_cost: typeof metricsRecord["total_cost"] === "number" ? metricsRecord["total_cost"] : undefined,
          duration_ms: typeof metricsRecord["duration_ms"] === "number" ? metricsRecord["duration_ms"] : undefined,
          model_id: asString(metricsRecord["model_id"]) ?? undefined,
          provider_id: asString(metricsRecord["provider_id"]) ?? undefined,
        }
      : undefined,
  };

  const validation = validate("ModuleOutput", output);
  if (!validation.valid) {
    return degradedOutput(moduleId, `Invalid ${moduleId} output after normalization: ${validation.errors.join("; ")}`);
  }

  return output;
}

function dedupeKey(finding: EvaluationFinding): string {
  return finding.duplicate_key?.trim() || [finding.module, finding.rule_id, finding.location ?? "", finding.excerpt].join("|");
}

export function deduplicateFindings(findings: EvaluationFinding[]): EvaluationFinding[] {
  const deduped = new Map<string, EvaluationFinding>();

  for (const finding of findings) {
    const key = dedupeKey(finding);
    const existing = deduped.get(key);
    if (!existing || SEVERITY_RANK[finding.severity] > SEVERITY_RANK[existing.severity]) {
      deduped.set(key, finding);
    }
  }

  return [...deduped.values()];
}
