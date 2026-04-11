import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import AjvModule, { type ErrorObject } from "ajv";

const SCHEMAS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "schemas");

const Ajv = AjvModule as unknown as new (options?: Record<string, unknown>) => {
  compile: (schema: Record<string, unknown>) => {
    (data: unknown): boolean;
    errors?: ErrorObject[] | null;
  };
};
const ajv = new Ajv({ allErrors: true, strict: false });

function loadSchema(filename: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, filename), "utf8")) as Record<string, unknown>;
}

const validators = {
  BriefArtifact: ajv.compile(loadSchema("BriefArtifact.json")),
  OutlineArtifact: ajv.compile(loadSchema("OutlineArtifact.json")),
  DraftArtifact: ajv.compile(loadSchema("DraftArtifact.json")),
  EvaluationFinding: ajv.compile(loadSchema("EvaluationFinding.json")),
  ModuleOutput: ajv.compile(loadSchema("ModuleOutput.json")),
  CritiqueArtifact: ajv.compile(loadSchema("CritiqueArtifact.json")),
  CritiqueReport: ajv.compile(loadSchema("CritiqueReport.json")),
  AudienceCritiqueReport: ajv.compile(loadSchema("AudienceCritiqueReport.json")),
  RubricReport: ajv.compile(loadSchema("RubricReport.json")),
  ComparisonReport: ajv.compile(loadSchema("ComparisonReport.json")),
  AuditArtifact: ajv.compile(loadSchema("AuditArtifact.json")),
  ToneInputArtifact: ajv.compile(loadSchema("ToneInputArtifact.json")),
  ToneOutputArtifact: ajv.compile(loadSchema("ToneOutputArtifact.json")),
  ToneValidationArtifact: ajv.compile(loadSchema("ToneValidationArtifact.json")),
  PersonalVoiceProfile: ajv.compile(loadSchema("PersonalVoiceProfile.json")),
  BrandProfile: ajv.compile(loadSchema("BrandProfile.json")),
  Layer2Analysis: ajv.compile(loadSchema("Layer2Analysis.json")),
  DetectionReport: ajv.compile(loadSchema("DetectionReport.json")),
  ConciseArtifact: ajv.compile(loadSchema("ConciseArtifact.json")),
} as const;

export type SchemaName = keyof typeof validators;

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  if (!errors?.length) {
    return [];
  }

  return errors.map((error) => {
    const path = error.instancePath || "/";
    return `${path} ${error.message ?? "validation error"}`.trim();
  });
}

export function validate(schemaName: string, data: unknown): { valid: boolean; errors: string[] } {
  const validator = validators[schemaName as SchemaName];

  if (!validator) {
    return {
      valid: false,
      errors: [`Unknown schema: ${schemaName}`],
    };
  }

  const valid = validator(data);
  return {
    valid: Boolean(valid),
    errors: formatErrors(validator.errors),
  };
}
