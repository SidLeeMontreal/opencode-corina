import { ModelResolver } from "opencode-model-resolver";

import { DEFAULT_MODEL_CONFIG } from "./model-config.js";
import { runAudit, runBriefIntake, runCritique, runDraft, runOutline, runRevise } from "./steps.js";
import type { OpenCodeClient, PipelineModelConfig, WorkflowState } from "./types.js";
import { validate } from "./validators.js";

function mergeModelConfig(modelConfig?: Partial<PipelineModelConfig>): PipelineModelConfig {
  return {
    ...DEFAULT_MODEL_CONFIG,
    ...modelConfig,
    briefIntake: modelConfig?.briefIntake ?? DEFAULT_MODEL_CONFIG.briefIntake,
    outline: modelConfig?.outline ?? DEFAULT_MODEL_CONFIG.outline,
    draft: modelConfig?.draft ?? DEFAULT_MODEL_CONFIG.draft,
    critique: modelConfig?.critique ?? DEFAULT_MODEL_CONFIG.critique,
    revise: modelConfig?.revise ?? DEFAULT_MODEL_CONFIG.revise,
    audit: modelConfig?.audit ?? DEFAULT_MODEL_CONFIG.audit,
  };
}

export async function runPipeline(
  brief: string,
  client: OpenCodeClient,
  modelConfig?: Partial<PipelineModelConfig>,
): Promise<string> {
  const state: WorkflowState = {
    briefText: brief,
    critiquePasses: 0,
    warnings: [],
  };

  const config = mergeModelConfig(modelConfig);
  const resolver = new ModelResolver();

  const briefResult = await runBriefIntake(
    client,
    brief,
    await resolver.resolveStepModel(config.briefIntake, config.provider),
  );
  state.briefArtifact = briefResult.artifact;
  state.warnings.push(...(briefResult.warnings ?? []));

  const briefValidation = validate("BriefArtifact", state.briefArtifact);
  if (!briefValidation.valid) {
    throw new Error(`BriefArtifact validation failed: ${briefValidation.errors.join("; ")}`);
  }

  if (state.briefArtifact.missing_info.length > 0) {
    return [
      "Corina needs a little more input before writing:",
      ...state.briefArtifact.missing_info.map((item, index) => `${index + 1}. ${item}`),
    ].join("\n");
  }

  let outlineValidation = { valid: false, errors: ["Outline not generated"] };
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const outlineResult = await runOutline(
      client,
      state.briefArtifact,
      await resolver.resolveStepModel(config.outline, config.provider),
    );
    state.outlineArtifact = outlineResult.artifact;
    state.warnings.push(...(outlineResult.warnings ?? []));

    outlineValidation = validate("OutlineArtifact", state.outlineArtifact);
    if (outlineValidation.valid) {
      break;
    }

    if (attempt === 2) {
      throw new Error(`OutlineArtifact validation failed after retry: ${outlineValidation.errors.join("; ")}`);
    }
  }

  const draftResult = await runDraft(
    client,
    state.briefArtifact,
    state.outlineArtifact!,
    await resolver.resolveStepModel(config.draft, config.provider),
  );
  state.draftArtifact = draftResult.artifact;
  state.warnings.push(...(draftResult.warnings ?? []));

  const draftValidation = validate("DraftArtifact", state.draftArtifact);
  if (!draftValidation.valid) {
    throw new Error(`DraftArtifact validation failed: ${draftValidation.errors.join("; ")}`);
  }

  for (let pass = 1; pass <= 2; pass += 1) {
    state.critiquePasses = pass;
    const critiqueResult = await runCritique(
      client,
      state.draftArtifact,
      state.briefArtifact,
      await resolver.resolveStepModel(config.critique, config.provider),
    );
    state.critiqueArtifact = critiqueResult.artifact;
    state.warnings.push(...(critiqueResult.warnings ?? []));

    const critiqueValidation = validate("CritiqueArtifact", state.critiqueArtifact);
    if (!critiqueValidation.valid) {
      throw new Error(`CritiqueArtifact validation failed: ${critiqueValidation.errors.join("; ")}`);
    }

    if (state.critiqueArtifact.pass) {
      break;
    }

    const revisionResult = await runRevise(
      client,
      state.draftArtifact,
      state.critiqueArtifact,
      await resolver.resolveStepModel(config.revise, config.provider),
    );
    state.draftArtifact = revisionResult.artifact;
    state.warnings.push(...(revisionResult.warnings ?? []));

    const revisedDraftValidation = validate("DraftArtifact", state.draftArtifact);
    if (!revisedDraftValidation.valid) {
      throw new Error(`Revised DraftArtifact validation failed: ${revisedDraftValidation.errors.join("; ")}`);
    }
  }

  const auditResult = await runAudit(
    client,
    state.draftArtifact,
    state.briefArtifact,
    await resolver.resolveStepModel(config.audit, config.provider),
  );
  state.auditArtifact = auditResult.artifact;
  state.warnings.push(...(auditResult.warnings ?? []));

  const auditValidation = validate("AuditArtifact", state.auditArtifact);
  if (!auditValidation.valid) {
    throw new Error(`AuditArtifact validation failed: ${auditValidation.errors.join("; ")}`);
  }

  if (state.auditArtifact.approved_for_delivery && state.auditArtifact.final_content) {
    return state.auditArtifact.final_content;
  }

  return [
    state.draftArtifact.content,
    "",
    "[Corina warning]",
    state.auditArtifact.publishability_note,
    ...state.warnings.map((warning) => `- ${warning}`),
  ].join("\n");
}
