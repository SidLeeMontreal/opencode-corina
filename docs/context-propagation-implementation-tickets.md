# Context Propagation Implementation Tickets

Date: 2026-05-14
Status: implementation planning
Scope: convert `docs/CONTEXT-PROPAGATION.md` into implementation-ready work
Depends on: current public tool envelope contract and existing evaluation context helpers

## Objective

Implement Corina's Compiled Execution Envelope pattern incrementally so every internal LLM step receives the same durable facts about user intent, voice, constraints, content shape, and prior findings.

This ticket set intentionally avoids a single broad rewrite. The first tickets build a small typed context layer and apply it to the `draft` pipeline. Later tickets retrofit other capabilities one at a time.

## Non-Goals For This Ticket Set

- Do not introduce a persistent database or long-term memory.
- Do not change the public tool envelope shape.
- Do not implement async OpenWork jobs.
- Do not implement full document retrieval in the first pass.
- Do not replace the existing `EvaluationContext`; bridge to it where useful.

## Implementation Principles

- Use current terminology: the public authoring capability is `draft`, not `write`.
- Keep full artifacts in existing state fields; inject compact context summaries into prompts.
- Make prompt-time context deterministic and unit-testable.
- Treat context as orchestrator-owned state, not model-owned memory.
- Prefer derived context updates in TypeScript over asking models to invent handoff summaries.

---

## Ticket CP-001 - Add Core Execution Context Types And Serializer

**Readiness**
Ready to implement.

**Goal**
Create the typed context object and deterministic serializer without wiring it into live model calls yet.

**Files**
- `src/types.ts`
- new `src/execution-context.ts`
- new `tests/unit/execution-context.test.ts`
- `docs/CONTEXT-PROPAGATION.md`, only if the design example needs terminology cleanup

**Changes**
- Add types:
  - `PipelineExecutionCapability`
  - `ExecutionContentScope`
  - `ExecutionFindingSeverity`
  - `ExecutionVoiceContext`
  - `ExecutionContentMetadata`
  - `ExecutionFinding`
  - `PipelineExecutionContext`
  - `PipelineExecutionContextDelta`
- Implement `initializePipelineExecutionContext(input)`.
- Implement `mergePipelineExecutionContextDelta(ctx, delta)`.
- Implement `buildContextBlock(ctx, options?)`.
- Use `draft` in capability unions instead of stale `write`.
- Add stable sorting/capping for inline findings:
  - severity order: `fatal`, `major`, `medium`, `low`
  - default max inline findings: 6
- Keep serializer ASCII-only.

**Acceptance Criteria**
- Context initialization works with minimal input.
- Context block always includes:
  - capability
  - requested operation
  - intent
  - user constraints
  - global instructions
  - voice
  - content metadata
  - prior findings
  - assumptions
- Empty arrays serialize as `none` or `- none`, not blank sections.
- Findings are capped and sorted deterministically.
- `npm run build` and `npm run test:unit` pass.

**Verification**
```bash
npm run build
npm run test:unit -- tests/unit/execution-context.test.ts
npm run test:unit
```

---

## Ticket CP-002 - Add Execution Context To Draft Workflow State

**Readiness**
Ready after CP-001.

**Goal**
Attach `PipelineExecutionContext` to the `draft` pipeline state and initialize it from the raw brief and early normalized brief artifact.

**Files**
- `src/types.ts`
- `src/pipeline.ts`
- `src/execution-context.ts`
- `tests/unit/execution-context.test.ts`
- optionally `tests/unit/draft-envelope.test.ts` if envelope behavior is touched

**Changes**
- Add `context?: PipelineExecutionContext` to `WorkflowState`.
- Initialize context at the start of `runPipelineWithArtifact()`.
- After `BriefArtifact` is available, merge context fields:
  - `user_intent_summary` from objective
  - `content.audience` from audience
  - `content.format` from format
  - `user_constraints` from constraints
  - `voice.name` or `voice.tone_description` from tone where safely derivable
  - `assumptions` from warnings or conservative inference
- Ensure missing-info degraded responses still include usable context internally.
- Do not inject the context block into prompts in this ticket.

**Acceptance Criteria**
- `WorkflowState` carries initialized context during draft runs.
- Brief-derived constraints and content metadata are merged once brief intake completes.
- Existing draft envelope behavior is unchanged.
- No new live OpenCode dependency is introduced in unit tests.

**Verification**
```bash
npm run build
npm run test:unit
npm run eval:tier1
```

---

## Ticket CP-003 - Inject Draft Pipeline Context Into Step Prompts

**Readiness**
Needs CP-001 and CP-002.

**Goal**
Prepend the compiled context block to draft pipeline LLM prompts so brief, outline, draft, critique, revise, and audit steps share the same operating facts.

**Files**
- `src/pipeline.ts`
- `src/steps.ts`
- `src/execution-context.ts`
- `tests/unit/execution-context.test.ts`
- `tests/helpers/mock-client.ts`, if needed for prompt inspection
- new or existing integration tests only if local OpenCode test harness supports prompt capture

**Changes**
- Update step function signatures to accept `contextBlock?: string`:
  - `runBriefIntake`
  - `runOutline`
  - `runDraft`
  - `runCritique`
  - `runRevise`
- Prepend context blocks to task prompts with clear delimiters.
- For `runBriefIntake`, use the initial context block plus raw brief.
- For downstream steps, rebuild the context block immediately before each call.
- Ensure `runAuditV2()` receives a context block that includes both existing `EvaluationContext` and new execution-context summaries without duplicating large artifacts.
- Keep prompt order stable:
  1. execution context
  2. voice profile or evaluation context if present
  3. artifacts/source text
  4. step-specific instructions

**Acceptance Criteria**
- Every draft pipeline LLM call includes `=== PIPELINE CONTEXT ===`.
- Context block appears before large artifacts.
- Existing schema parsing and delimiters still work.
- Unit tests verify prompt construction for at least outline, draft, revise, and audit prompt builders.
- `npm run eval:tier1` does not regress.

**Verification**
```bash
npm run build
npm run test:unit
npm run eval:tier1
```

---

## Ticket CP-004 - Add Draft Pipeline Context Update Contracts

**Readiness**
Needs CP-003. Ticket is implementation-ready after artifact-to-context mappings are confirmed.

**Goal**
Update execution context after each draft pipeline step so downstream steps see prior decisions and remaining obligations.

**Files**
- `src/execution-context.ts`
- `src/pipeline.ts`
- `src/steps.ts`
- `src/types.ts`
- `tests/unit/execution-context.test.ts`
- possibly `tests/unit/evaluation-registry.test.ts`

**Changes**
- Add small deterministic update helpers:
  - `contextDeltaFromBriefArtifact(brief)`
  - `contextDeltaFromOutlineArtifact(outline)`
  - `contextDeltaFromDraftArtifact(draft)`
  - `contextDeltaFromCritiqueArtifact(critique, pass)`
  - `contextDeltaFromAuditArtifact(audit)`
- Map critique and audit findings into `ExecutionFinding[]`.
- Add `step_history` entries after each major step.
- Add content word count after draft/revision.
- Add audit blockers as `fatal` or `major` findings.
- Avoid dumping full draft, full critique JSON, or full audit JSON into context.

**Acceptance Criteria**
- Failed critique findings appear in the next revise prompt as compact findings.
- Audit context includes prior critique findings and user constraints.
- `step_history` records each major step exactly once per execution.
- Context updates are deterministic and unit-tested from fixture artifacts.
- Existing public tool warnings remain unchanged unless explicitly improved.

**Verification**
```bash
npm run build
npm run test:unit -- tests/unit/execution-context.test.ts
npm run test:unit
npm run eval:tier1
```

---

## Ticket CP-005 - Add Context Observability And Debug Traces

**Readiness**
Ready after CP-003; can run in parallel with CP-004 if file ownership is coordinated.

**Goal**
Make the exact injected context reconstructible without logging full private content by default.

**Files**
- `src/logger.ts`, if new logger event naming is useful
- `src/pipeline.ts`
- `src/steps.ts`
- `docs/LOGGING.md`
- `tests/unit/audit-log.test.ts`, if audit payloads change

**Changes**
- Log a `context_compiled` debug event before each LLM step with:
  - capability
  - step
  - context character count
  - finding count
  - constraint count
  - context hash
- Log full context block only when an explicit debug environment flag is enabled, for example `CORINA_DEBUG_CONTEXT=1`.
- Do not write source text, full draft text, or full artifacts into normal logs.
- Document how to enable context debugging.

**Acceptance Criteria**
- Default logs reveal that context was compiled without leaking content.
- Debug mode can reconstruct the exact context block for a failed run.
- No audit-log schema consumer is broken.
- Logging docs explain the event and privacy behavior.

**Verification**
```bash
npm run build
npm run test:unit
```

---

## Ticket CP-006 - Retrofit Tone Pipeline To Execution Context

**Readiness**
Needs CP-001. Better after CP-003 establishes prompt-injection conventions.

**Goal**
Use the same execution context pattern in `tone` so writer and validator share requested voice, format, audience, constraints, source metadata, and validation findings.

**Files**
- `src/tone-pipeline.ts`
- `src/execution-context.ts`
- `src/types.ts`
- `tests/unit/public-tool-behavior.test.ts`
- new tone-specific context tests if needed

**Changes**
- Initialize context from `ToneRawInput` and normalized input.
- Merge inferred voice, format, audience, profile refs, and tone description into context.
- Inject context block into tone-writer and tone-validator task prompts.
- Add validator findings into context before any retry/fix pass.
- Preserve current public envelope behavior.

**Acceptance Criteria**
- Tone writer prompt includes requested/inferred voice and user constraints.
- Tone validator prompt receives the same voice context as writer.
- Empty-input degraded behavior is unchanged.
- Public `tone` tests still pass.

**Verification**
```bash
npm run build
npm run test:unit
npm run eval:tier1
```

---

## Ticket CP-007 - Retrofit Critique Pipeline To Execution Context

**Readiness**
Needs CP-001. Should follow CP-006 unless critique is higher priority.

**Goal**
Use execution context in `critique` modes so modular evaluators, adjudicators, and chain targets share audience, rubric, voice, constraints, and source provenance.

**Files**
- `src/critique.ts`
- `src/critique-normalizer.ts`
- `src/evaluation-registry.ts`
- `src/execution-context.ts`
- `tests/unit/evaluation-registry.test.ts`
- `tests/unit/public-tool-behavior.test.ts`

**Changes**
- Initialize execution context per normalized critique item.
- Bridge from execution context into existing `EvaluationContext` where possible.
- Inject execution context before evaluator prompts without duplicating full text.
- Convert modular evaluation outputs into compact execution findings for adjudicator prompts and optional chain calls.
- Preserve compare-mode behavior across multiple items.

**Acceptance Criteria**
- Audience mode includes explicit audience context in every evaluator prompt.
- Rubric mode includes rubric id and concise rubric summary/ref in context.
- Compare mode keeps per-item context separate.
- Public `critique` envelope and `should_persist=false` behavior are unchanged.

**Verification**
```bash
npm run build
npm run test:unit
npm run eval:tier1
```

---

## Ticket CP-008 - Retrofit Concise Pipeline Fragment Context

**Readiness**
Needs CP-001 and should follow draft/tone/critique retrofits. Requires extra care because `concise` already has paragraph-window logic.

**Goal**
Use execution context in `concise`, especially full mode, to preserve global constraints and document role while editing paragraph fragments.

**Files**
- `src/concise.ts`
- `src/execution-context.ts`
- `src/types.ts`
- `tests/unit/concise.test.ts`
- `evals/suites/corina-concise.json`

**Changes**
- Initialize context with `capability: "concise"`, requested operation, source word count, and preservation constraints.
- For full mode, set `content.scope = "fragment"` during paragraph revision passes.
- Include paragraph id, neighboring paragraph summary/window, and global document summary in context.
- Convert audit heat-map entries and reconciliation issues into compact findings.
- Avoid adding full-document retrieval in this ticket; use existing paragraph splitting/window data.

**Acceptance Criteria**
- Paragraph revision prompts include both local fragment context and global preservation rules.
- Reconciler prompt receives unresolved issues as compact findings.
- Existing concise unit tests and Tier 1 evals pass.
- No full draft is duplicated unnecessarily beyond what the pass already requires.

**Verification**
```bash
npm run build
npm run test:unit -- tests/unit/concise.test.ts
npm run test:unit
npm run eval:tier1
```

---

## Ticket CP-009 - Add Context Regression Evals

**Readiness**
Ready after at least CP-004. Strongly recommended before retrofitting every capability.

**Goal**
Add focused regression coverage for the failure modes that motivated context propagation.

**Files**
- `evals/corpus/corina-corpus.json`
- `evals/suites/corina-pipeline.json`
- `evals/suites/corina-tone.json`
- `evals/suites/corina-critique.json`
- `evals/suites/corina-concise.json`
- `docs/EVALUATION-PERFORMANCE.md`

**Changes**
- Add eval cases for:
  - user constraint persists to final audit: "never use first person"
  - requested voice persists from writer to validator
  - critique finding appears in revise instruction
  - fragment edit preserves document-level stance
  - no invented evidence after context injection
- Prefer Tier 1 deterministic checks where possible.
- Add Tier 2 judge cases only where behavior cannot be checked deterministically.

**Acceptance Criteria**
- At least one eval fails against a deliberately context-blind implementation or fixture.
- Tier 1 suite remains fast enough for commit checks.
- Eval descriptions name the context propagation behavior they protect.

**Verification**
```bash
npm run eval:tier1
npm run test:regression
```

---

## Ticket CP-010 - Add Reference-Backed Document Context

**Readiness**
Not ready until CP-008 is complete. Needs a short design pass before implementation.

**Goal**
Introduce lightweight references for large documents so prompts can request compact summaries or paragraph windows without repeatedly inlining full artifacts.

**Files**
- new `src/document-context.ts`
- `src/execution-context.ts`
- `src/concise.ts`
- possibly `src/tone-pipeline.ts` and `src/critique.ts`
- new `tests/unit/document-context.test.ts`

**Open Design Questions**
- Should document refs be in-memory per run, filesystem-backed, or derived from existing artifacts only?
- What ref format should be used: `doc://<run_id>/<artifact>` or a local opaque id?
- Which capabilities are allowed to retrieve refs?
- What privacy/logging rules apply to retrieved windows?

**Changes**
- Add document reference registry scoped to a single tool run.
- Store source document, paragraph index, and short summary.
- Provide helper functions:
  - `registerDocumentContext(text, metadata)`
  - `getDocumentSummary(ref)`
  - `getParagraphWindow(ref, paragraphId, radius)`
- Integrate first with `concise` full mode only.

**Acceptance Criteria**
- Long-form fragment prompts can include refs and windows without duplicating entire documents.
- Retrieval is deterministic and unit-tested.
- Refs do not leak across tool runs.
- Debug logs record retrieval metadata, not full content by default.

**Verification**
```bash
npm run build
npm run test:unit -- tests/unit/document-context.test.ts
npm run test:unit
```

---

## Recommended Implementation Order

1. CP-001 - Add core types and serializer.
2. CP-002 - Add context to draft workflow state.
3. CP-003 - Inject context into draft pipeline prompts.
4. CP-004 - Add draft pipeline context update contracts.
5. CP-005 - Add context observability.
6. CP-009 - Add regression evals for draft context behavior.
7. CP-006 - Retrofit tone.
8. CP-007 - Retrofit critique.
9. CP-008 - Retrofit concise fragment context.
10. CP-010 - Add reference-backed document context.

## Definition Of Done

This feature is done when:

- Every LLM step in `draft`, `tone`, `critique`, and `concise` receives a compact execution context block.
- User constraints, requested voice, audience, and prior findings are represented as typed context fields.
- Context updates are deterministic and covered by unit tests.
- Prompt-time context can be reconstructed in debug mode.
- Tier 1 evals include regressions for context-loss failure modes.
- Public tool envelopes remain backward compatible.
