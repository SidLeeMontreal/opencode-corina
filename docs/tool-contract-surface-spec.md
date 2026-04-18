# Corina Tool Contract Surface Spec

Date: 2026-04-17
Status: Design/spec pass only
Scope: public tool contract and authoring tool surface

## Exact files inspected

- `.opencode/tools/write.ts`
- `.opencode/tools/critique.ts`
- `.opencode/tools/tone.ts`
- `.opencode/tools/detect.ts`
- `.opencode/agents/corina.md`
- `.opencode/plugins/corina.ts`
- `src/capability-output.ts`
- `src/pipeline.ts`
- `src/critique.ts`
- `src/types.ts`
- `src/audit-log.ts`
- `src/index.ts`
- `AGENTS.md`
- `README.md`
- `docs/LOGGING.md`
- `tests/integration/critique.e2e.test.ts`
- `tests/integration/tone.e2e.test.ts`
- `tests/integration/chaining.e2e.test.ts`
- `tests/unit/chaining.test.ts`
- `tests/unit/audit-log.test.ts`

## Summary

The repo already contains much of the underlying structure needed for a deployable tool contract: typed artifacts, capability envelopes, audit outcome concepts, and structured pipeline output. The failure is at the public tool surface. The default UX still returns prose-first results, hides canonical output behind optional JSON behavior, and uses the overloaded verb `write`.

This spec defines the correct public contract now, with no backward-compatibility design constraint.

---

## 1. Proposed external contract

All public Corina tools should return the same structured-by-default envelope.

```ts
type ToolOutcome = "success" | "degraded" | "failed";

interface CorinaToolEnvelope<TArtifact> {
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
  version?: string;
  timestamp?: string;
  input_summary?: string;
  chained_to?: string;
  chain_result?: unknown;
}
```

### Field semantics

#### `agent`
- Constant: `"corina"`
- Public provenance field for all tool outputs.

#### `capability`
- Public tool name, for example `draft`, `critique`, `detect`, `tone`, `concise`.
- Must reflect the external tool surface, not an internal implementation detail such as `pipeline`.

#### `outcome`
Allowed values:
- `success` = valid artifact returned, suitable for normal downstream use
- `degraded` = valid artifact returned, but with meaningful quality, delivery, or confidence caveats
- `failed` = no valid artifact available for downstream use

Rules:
- `outcome` is always top-level and mandatory.
- Callers must never infer outcome from prose in `rendered`.

#### `should_persist`
- Explicit signal for downstream callers.
- `true` only when the returned artifact contains canonical output intended to be persisted for the tool's public purpose.
- `false` for diagnostics, advisory output, or failed runs.

Rules:
- Callers must never infer persistence from prose.
- `should_persist = false` whenever `outcome = "failed"`.

#### `artifact`
- Canonical machine-readable output.
- Source of truth for downstream systems.
- May be `null` only when `outcome = "failed"`.

Rules:
- Callers persist or consume `artifact`, never `rendered`.
- Public capability-specific artifact schemas remain tool-specific under the shared envelope.

#### `rendered`
- Presentation output for humans or chat surfaces.
- Always present.
- May include headings, explanatory framing, warnings, or display formatting.
- May differ from the canonical content stored in `artifact`.

#### `warnings`
- Top-level normalized warning list.
- Must surface degradation and important caveats without requiring callers to parse prose or inspect nested artifact internals.
- Empty array when no warnings apply.

#### `metrics`
- Always present as an object.
- Carries transport-safe usage metadata.
- Fields remain optional.

#### `version`, `timestamp`, `input_summary`
- Recommended public metadata.
- Already aligned with existing internal Corina envelope patterns.

#### `chained_to`, `chain_result`
- Present only when a tool chains into another capability.
- Must follow the same public contract discipline and not force the caller to inspect raw prose.

### Global contract rules

- `artifact` is canonical machine output.
- `rendered` is presentation output.
- `outcome` is explicit and authoritative.
- `should_persist` is explicit and authoritative.
- Callers should never infer `success`, `degraded`, or `failed` from prose.
- Callers should never infer persistence from prose.
- If `outcome = "failed"`, then:
  - `artifact = null`
  - `should_persist = false`
- If `should_persist = true`, callers persist canonical content from `artifact`, not `rendered`.

### Persistence by tool type

#### `draft`
- `should_persist = true` when `outcome` is `success` or `degraded` and canonical drafted content exists.

#### `tone` / future `adapt`
- `should_persist = true` when the returned artifact contains canonical rewritten content.

#### `critique`
- `should_persist = false` by default.
- It is evaluative, not authoring output.

#### `detect`
- `should_persist = false` by default.
- It is diagnostic, not authoring output.

#### `concise`
- `should_persist = true` when `outcome` is `success` or `degraded` and the concise artifact contains canonical rewritten copy.
- Canonical concise content is consumed from the artifact, not from `rendered`.

---

## 2. Draft surface definition

## Public tool name

- `draft`

## Exact meaning of `draft`

`draft` means: generate human-readable content through Corina's editorial pipeline and return a canonical authoring artifact plus presentation output.

`draft` does not mean:
- write a file
- write to disk
- use filesystem tools
- persist content anywhere
- invoke a file-write command

Persistence is a caller responsibility, guided by `should_persist` and the artifact contract.

## Why `draft` replaces `write`

`write` is overloaded in agentic coding environments because it strongly collides with file-writing semantics. `draft` is a better public authoring verb because it is specific to language generation and low ambiguity at the tool boundary.

## Draft-specific envelope

```ts
interface DraftArtifact {
  final_content: string;
  audit: {
    approved_for_delivery: boolean;
    ai_patterns_remaining: string[];
    banned_words_remaining: string[];
    style_violations: string[];
    publishability_note: string;
    final_content: string | null;
    degraded?: boolean;
    findings?: unknown[];
    module_status?: Record<string, "ok" | "skipped" | "degraded">;
  };
}

type DraftEnvelope = CorinaToolEnvelope<DraftArtifact>;
```

## Draft-specific rules

### `artifact.final_content`
- Canonical content to persist when `should_persist = true`.
- Primary machine-facing authored output.

### `artifact.audit`
- Quality and delivery metadata.
- Must not be the only place where callers discover degradation.
- Supports downstream inspection, but top-level `outcome` remains authoritative.

### `rendered`
- Human-facing display text.
- May equal `artifact.final_content`.
- May also include warnings or display framing.
- Must not be scraped by callers to recover canonical content.

### `warnings`
- Normalized top-level warning list sourced from pipeline warnings and delivery caveats.
- Exists so callers do not need to parse audit notes or prose warnings.

## Outcome mapping for `draft`

### `success`
- Valid `DraftArtifact`
- `artifact.final_content` present
- `should_persist = true`
- Caller persists `artifact.final_content`

### `degraded`
- Valid `DraftArtifact`
- `artifact.final_content` present
- Quality or delivery caveats exist
- `should_persist = true`
- Caller may persist `artifact.final_content`, but should surface `warnings` and preserve outcome state

### `failed`
- `artifact = null`
- `should_persist = false`
- Caller must not persist anything from `rendered`

## Caller persistence behavior for `draft`

- On `success`: persist `artifact.final_content`
- On `degraded`: persist `artifact.final_content` only if the caller accepts degraded-but-usable authoring output; never recover content from `rendered`
- On `failed`: persist nothing

---

## 3. Minimal repo change plan

## Phase 1

### `.opencode/tools/write.ts`
- Change needed: remove from the public surface and replace with `.opencode/tools/draft.ts`
- Why: eliminate the overloaded authoring verb at the public boundary
- Phase: 1

### `.opencode/tools/draft.ts` (new)
- Change needed: create the public wrapper around the existing pipeline execution path
- Why: establish `draft` as the sole public authoring tool
- Phase: 1

### `src/capability-output.ts`
- Change needed: extend or replace current capability-output shaping so it can build the universal public envelope with:
  - `outcome`
  - `should_persist`
  - `warnings`
  - nullable `artifact`
- Why: current envelope already includes `agent`, `capability`, `artifact`, `rendered`, `timestamp`, `metrics`, and `input_summary`, but it does not make outcome or persistence top-level caller-facing guarantees
- Phase: 1

### `src/pipeline.ts`
- Change needed: shape public draft output as:
  - `capability: "draft"`
  - top-level `outcome`
  - top-level `should_persist`
  - top-level `warnings`
  - canonical draft artifact
- Why: current implementation computes enough internal state already, but the default tool surface still returns prose-first output and uses internal capability language (`pipeline`)
- Phase: 1

### `src/types.ts`
- Change needed: add shared public envelope type and shared `ToolOutcome` type; add or formalize public `DraftArtifact` typing if needed
- Why: make the external contract explicit and reusable
- Phase: 1

### `AGENTS.md`
- Change needed:
  - replace public tool name `write` with `draft`
  - document artifact/rendered/outcome/persistence rules
  - correct stale description of plugin observation hooks if touched during this pass
- Why: current file documents the wrong public authoring verb and understates the caller-facing contract
- Phase: 1

### `README.md`
- Change needed:
  - replace `write` usage with `draft`
  - document the universal envelope
  - document that `artifact` is canonical and `rendered` is presentation
  - document persistence rules
- Why: current README is directionally correct about pipeline behavior but underspecified at the deployable tool surface
- Phase: 1

### `.opencode/agents/corina.md`
- Change needed: update primary-agent instructions so authored content routes through `draft`, explicitly distinguishing drafting from file creation
- Why: reinforce the clean public boundary for the deployable agent
- Phase: 1

### `tests/unit/chaining.test.ts`
- Change needed: update mocks and assertions if capability labels or output envelope fields change from public `pipeline`/legacy shaping to `draft`/universal shaping
- Why: this is the right place to pin contract-level regressions
- Phase: 1

## Phase 2

### `.opencode/tools/critique.ts`
- Change needed: return the same universal envelope by default
- Why: unify public contract across tools
- Phase: 2

### `.opencode/tools/tone.ts`
- Change needed: return the same universal envelope by default
- Why: unify public contract across tools
- Phase: 2

### `.opencode/tools/detect.ts`
- Change needed: return the same universal envelope by default
- Why: unify public contract across tools
- Phase: 2

### `.opencode/tools/concise.ts`
- Change needed: normalize to the same envelope and explicitly set persistence semantics
- Why: complete tool-surface normalization
- Phase: 2

### `src/critique.ts`
- Change needed: normalize top-level `outcome`, `warnings`, and `should_persist` for public-facing critique outputs
- Why: critique already tracks much of this internally, but not as the proposed universal tool contract
- Phase: 2

### `src/tone-pipeline.ts`
- Change needed: same envelope normalization for rewritten-content flows
- Phase: 2

### `src/detect.ts`
- Change needed: same envelope normalization for diagnostic flows
- Phase: 2

## Optional later cleanup

### `src/index.ts`
- Change needed: only if the team decides to either implement actual tool-completion hooks or clean up stale documentation references
- Why: not required for the draft contract itself
- Phase: later

### `docs/LOGGING.md`
- Change needed: clarify the boundary between runtime/audit logging and caller-facing tool contract
- Why: useful for operator clarity, not required for Phase 1 correctness
- Phase: later

### Internal naming cleanup
- Change needed: optionally align internal implementation labels such as `pipeline` with the external `draft` capability language
- Why: reduces long-term confusion, but not required to ship the correct public surface
- Phase: later

---

## 4. Enforcement plan

## Minimum clean enforcement

The minimum clean enforcement is:
1. use `draft` as the only public first-draft authoring tool
2. encode the contract in the agent prompt and tool descriptions
3. keep runtime enforcement lightweight unless prompt leakage persists in practice

## Agent prompt wording

In `.opencode/agents/corina.md`, add a hard rule block:

- For requests to create human-readable content, Corina must call `draft`.
- Corina must not compose first-draft prose directly in chat when `draft` can satisfy the request.
- `draft`, `revise`, `polish`, `adapt`, `summarize`, and `critique` refer to language operations only.
- They do not mean file creation, writing to disk, or filesystem tool usage unless file creation is explicitly requested.
- When a tool returns an envelope:
  - `artifact` is canonical
  - `rendered` is presentation
  - `outcome` is authoritative
  - `should_persist` controls whether downstream callers should persist canonical content

## Tool description wording

For `draft`, the public description should say, in substance:

- Draft human-readable content through Corina's editorial pipeline.
- Returns a structured envelope by default.
- `artifact` is canonical output.
- `rendered` is presentation output.
- `should_persist` indicates whether callers should persist `artifact.final_content`.
- This tool does not write files.

This matters because tool descriptions are part of the effective deployable interface, not just docs.

## Lightweight runtime guard

Recommended minimum guard:
- Expose `draft` as the only public authoring tool for first-draft generation.
- Rely on prompt-level tool routing first.
- Do not add a heavy interceptor in Phase 1.

Optional later guard, only if still needed:
- before allowing the primary agent to emit a long authored draft directly, require evidence that `draft` was called in the turn for authoring-class requests

## Policy vs enforcement

### Should remain policy
- preferred tool vocabulary beyond the core public surface
- whether a given product flow auto-persists degraded drafted output
- whether evaluative tools ever become persistable in special product contexts

### Should become enforcement
- first-draft authoring requests route through `draft`
- the public tool contract is structured by default
- drafting is not conflated with file writing
- callers receive explicit `outcome` and `should_persist`

---

## 5. Rollout plan

## Phase 1: smallest safe implementation of the correct surface

- introduce `draft` as the only public authoring tool
- remove `write` from the public surface
- keep the underlying pipeline implementation with minimal internal churn
- return the universal structured envelope by default from `draft`
- add explicit top-level:
  - `outcome`
  - `should_persist`
  - `warnings`
- update:
  - `.opencode/agents/corina.md`
  - `AGENTS.md`
  - `README.md`
  - contract-sensitive unit tests

This delivers the correct deployable surface without forcing a broad internal rewrite.

## Phase 2: broader normalization

- move `critique`, `tone`, `detect`, and `concise` onto the same universal envelope by default
- normalize persistence semantics across tools
- reduce remaining contract differences between authoring, rewrite, and diagnostic tools

## Optional later cleanup

- align internal implementation labels with external capability names if desired
- clean up or implement plugin hook claims in docs and code
- tighten chain-result typing under the same universal contract

---

## Places where the feedback was directionally right but factually overstated

## Directionally right
- the default tool UX is too prose-heavy
- the current authoring surface is easy for orchestrators to misuse
- `write` is a poor public verb in an agentic coding environment
- the distinction between degraded output and failure is too hidden at the tool boundary

## Factually overstated
- the repo does not lack structured output entirely; it already has a substantial internal typed envelope in `src/capability-output.ts`
- the repo does not lack success/degraded/failed concepts entirely; those already exist internally in pipeline, critique, detect, audit, and logging paths
- the repo does not lack any documented rule against direct writing; `AGENTS.md` already says Corina does not write content directly and always calls a tool

## Narrower actual problem
- the structure already exists internally or behind optional JSON behavior
- the default public tool UX still makes callers infer too much from prose
- enforcement at the primary-agent boundary is weak enough that documented intent is not reliably operationalized
