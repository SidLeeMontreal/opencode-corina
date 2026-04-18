# Corina Tool Contract Implementation Tickets

Date: 2026-04-17
Status: implementation planning
Scope: implement the approved tool-contract surface spec
Depends on: `docs/tool-contract-surface-spec.md`

## Objective

Implement the approved public contract changes for Corina:

- replace public `write` with `draft`
- make the public tool envelope structured-by-default
- add minimal prompt and tool-boundary enforcement
- update contract-sensitive tests and docs

This ticket set assumes no backward-compatibility requirement at the public tool surface.

---

## Ticket 1 — Replace the public `write` tool with `draft`

**Goal**
Create `draft` as the only public authoring tool and remove `write` from the public tool boundary.

**Files**
- `.opencode/tools/write.ts`
- `.opencode/tools/draft.ts` (new)
- `README.md`
- `AGENTS.md`

**Changes**
- Delete or remove `.opencode/tools/write.ts` from the public tool surface.
- Add `.opencode/tools/draft.ts` as the new public authoring wrapper around the existing pipeline path.
- Ensure the public capability name surfaced by the tool is `draft`, not `write` and not `pipeline`.
- Update docs so all authoring examples and tool roster entries use `draft`.

**Acceptance criteria**
- There is no public `write` tool in the repo surface.
- `draft` exists as the sole public first-draft authoring tool.
- README and AGENTS do not refer to `write` as the public authoring action.

**Verification**
- repo search for public-facing `write` tool references returns none except historical docs if intentionally preserved
- tool roster and usage examples show `draft`

---

## Ticket 2 — Introduce the universal public tool envelope

**Goal**
Make the caller-facing response structured-by-default for the new public authoring tool.

**Files**
- `src/capability-output.ts`
- `src/types.ts`
- `src/pipeline.ts`

**Changes**
- Define a shared public envelope type, including:
  - `agent`
  - `capability`
  - `outcome`
  - `should_persist`
  - `artifact`
  - `rendered`
  - `warnings`
  - `metrics`
  - optional metadata fields already supported internally
- Extend or replace current output shaping in `src/capability-output.ts` so the public envelope can be built directly.
- Add shared `ToolOutcome` typing.
- Add or formalize `DraftArtifact` typing if needed.

**Acceptance criteria**
- The shared envelope type exists in code.
- `outcome` and `should_persist` are top-level fields, not implicit behavior.
- `artifact` can be `null` on failure.
- `warnings` is normalized as a top-level array.

**Verification**
- typecheck/build succeeds
- envelope builder can represent success, degraded, and failed outputs

---

## Ticket 3 — Re-shape pipeline output as public `draft` output

**Goal**
Map existing pipeline behavior onto the new public draft contract without rewriting the pipeline internals.

**Files**
- `src/pipeline.ts`
- `src/capability-output.ts`
- `src/types.ts`

**Changes**
- Change public output capability from internal `pipeline` semantics to external `draft` semantics.
- Map pipeline completion states onto top-level envelope values:
  - `success`
  - `degraded`
  - `failed`
- Set `should_persist` explicitly.
- Surface normalized `warnings` from existing pipeline warnings and delivery caveats.
- Ensure `artifact.final_content` is canonical for persistence.
- Ensure callers never need to recover canonical content from `rendered`.

**Acceptance criteria**
- Public draft output uses `capability: "draft"`.
- Successful and degraded authoring runs return valid `artifact.final_content` and `should_persist = true`.
- Failed runs return `artifact = null` and `should_persist = false`.
- `rendered` may differ from canonical content, but canonical content remains in `artifact.final_content`.

**Verification**
- targeted unit coverage for success/degraded/failed shaping
- manual sample output inspection confirms top-level fields are sufficient for an orchestrator

---

## Ticket 4 — Add minimal tool-boundary enforcement in the primary agent

**Goal**
Prevent ambiguous direct authoring behavior at the primary-agent boundary with the minimum justified enforcement.

**Files**
- `.opencode/agents/corina.md`
- `.opencode/tools/draft.ts`
- `AGENTS.md`

**Changes**
- Add a hard rule block to `.opencode/agents/corina.md`:
  - authoring requests must use `draft`
  - first-draft prose must not be composed directly in chat when `draft` is applicable
  - drafting language is distinct from file creation
  - `artifact`, `rendered`, `outcome`, and `should_persist` semantics are authoritative
- Make the `draft` tool description explicitly say it drafts human-readable content and does not write files.
- Reflect the same boundary in `AGENTS.md`.

**Acceptance criteria**
- The primary agent prompt clearly routes authoring through `draft`.
- The tool description itself disambiguates content drafting from filesystem writing.
- Repo docs no longer rely on AGENTS-only inference for this boundary.

**Verification**
- prompt review shows explicit rule block present
- draft tool description contains the authoring-vs-file distinction

---

## Ticket 5 — Update contract-sensitive unit tests for the new envelope

**Goal**
Lock the public contract in place so regressions are caught immediately.

**Files**
- `tests/unit/chaining.test.ts`
- any existing unit tests that mock authoring outputs
- optionally add `tests/unit/capability-output.test.ts` or `tests/unit/draft-envelope.test.ts`

**Changes**
- Update mocks that still use public `pipeline` capability labels.
- Assert the new public envelope fields exist and carry correct values.
- Add focused unit coverage for:
  - successful `draft` output
  - degraded `draft` output
  - failed `draft` output
  - chain behavior preserving top-level envelope semantics where applicable

**Acceptance criteria**
- Unit tests assert `capability: "draft"` where appropriate.
- Unit tests assert top-level `outcome`, `should_persist`, `artifact`, `rendered`, and `warnings` behavior.
- At least one test covers `artifact = null` on failure.

**Verification**
- `npm run test:unit`

---

## Ticket 6 — Update README and AGENTS to the new public contract

**Goal**
Bring repo-facing documentation into line with the implementation surface.

**Files**
- `README.md`
- `AGENTS.md`

**Changes**
- Replace all public authoring references from `write` to `draft`.
- Document the universal envelope.
- State explicitly:
  - `artifact` is canonical
  - `rendered` is presentation
  - `outcome` is top-level
  - callers should never infer state from prose
  - `should_persist` controls persistence decisions
- Remove or correct any wording that suggests prose-first tool usage.
- Correct stale `tool.execute.after` wording if touched in the same pass.

**Acceptance criteria**
- README examples use `draft`.
- AGENTS documents the new tool vocabulary and contract rules.
- No public docs imply that raw rendered prose is the authoritative output.

**Verification**
- repo search for public-tool docs matches spec language

---

## Ticket 7 — Add contract-level integration coverage for `draft`

**Goal**
Verify the public draft surface, not just internal pipeline behavior.

**Files**
- new integration test, likely `tests/integration/draft.e2e.test.ts`
- existing integration harness setup if needed

**Changes**
- Add an integration test focused on the public `draft` contract.
- Assert at minimum:
  - `agent = "corina"`
  - `capability = "draft"`
  - `outcome` is present
  - `should_persist` is present
  - `artifact.final_content` exists for success/degraded cases
  - `rendered` exists but is not treated as canonical
  - `warnings` is always present as an array

**Acceptance criteria**
- A dedicated integration test covers the public contract for authoring output.
- The test is written against the public surface, not only internal helper shape.

**Verification**
- targeted vitest run for the new integration file

---

## Ticket 8 — Normalize public tool serialization behavior

**Goal**
Remove prose-first default behavior at the tool wrapper level.

**Files**
- `.opencode/tools/draft.ts`
- later: `.opencode/tools/critique.ts`
- later: `.opencode/tools/tone.ts`
- later: `.opencode/tools/detect.ts`
- later: `.opencode/tools/concise.ts`

**Changes**
- For `draft`, make the structured envelope the default returned tool payload.
- Do not require `format: "json"` to get canonical machine-readable output.
- If alternate human-display formatting remains supported, it must not replace the default public contract.

**Acceptance criteria**
- Default tool invocation returns the structured envelope.
- Canonical artifact access no longer depends on opt-in JSON behavior.

**Verification**
- direct tool inspection or integration test confirms default return path is structured

---

## Ticket 9 — Phase 2 follow-up: normalize the rest of the public tools

**Goal**
Extend the same contract to non-draft public tools after Phase 1 lands.

**Files**
- `.opencode/tools/critique.ts`
- `.opencode/tools/tone.ts`
- `.opencode/tools/detect.ts`
- `.opencode/tools/concise.ts`
- `src/critique.ts`
- `src/tone-pipeline.ts`
- `src/detect.ts`
- any tests tied to their public output shape

**Changes**
- Move each public tool to the same default envelope.
- Set explicit `outcome`, `should_persist`, and `warnings` semantics per tool.
- Clarify whether `concise` is canonical rewrite output or advisory-only output.

**Acceptance criteria**
- all public tools share the same caller-facing envelope shape
- persistence semantics are explicit across the full tool surface

**Verification**
- integration coverage for each normalized tool

---

## Recommended implementation order

1. Ticket 2 — universal envelope types and builder
2. Ticket 3 — pipeline-to-draft public shaping
3. Ticket 1 — replace public `write` with `draft`
4. Ticket 4 — prompt/tool-boundary enforcement
5. Ticket 5 — contract-sensitive unit tests
6. Ticket 6 — docs refresh
7. Ticket 7 — public draft integration coverage
8. Ticket 8 — serialization cleanup confirmation
9. Ticket 9 — broader tool normalization

---

## Definition of done for Phase 1

Phase 1 is done when all of the following are true:

- public authoring tool is `draft`, not `write`
- `draft` returns a structured envelope by default
- top-level `outcome` and `should_persist` exist and are authoritative
- `artifact` is canonical and `rendered` is presentation-only
- the primary agent prompt routes authoring through `draft`
- contract-sensitive unit and integration coverage exists
- README and AGENTS match the shipped public surface
