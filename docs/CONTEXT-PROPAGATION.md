# Context Propagation in Corina Multi-Agent Pipelines

## 1. Executive Summary

Corina’s current orchestration model keeps most durable state in a TypeScript `WorkflowState` object inside `src/pipeline.ts`, but each LLM step only sees whatever text the step-specific prompt happened to include. That means intent, tone parameters, user constraints, upstream decisions, and document-level context are easy to lose between agents. The result is predictable drift: validators do not always know the original requested voice, auditors can miss prior critique findings, and fragment editing steps can operate without enough surrounding context.

The recommended design is a **Compiled Execution Envelope** pattern: a typed `PipelineExecutionContext` owned by the orchestrator, updated after every step, and injected into every downstream agent as a compact structured context block. This is paired with **artifact references for large inputs**, **lightweight decision summaries instead of raw artifacts**, and **on-demand retrieval for full-document context**. In practice, this keeps every agent grounded in the same operating contract without forcing the whole workflow history into every prompt.

This recommendation fits Corina’s architecture because OpenCode sessions are currently created fresh for each step (`session.create` → `session.prompt` → `session.delete`). Session-local persistence therefore does not solve cross-step propagation. The orchestrator must own the durable execution context and deliberately compile the right slice into each prompt.

The design goal is reliability first: the final gate agent should always know the original user intent, active voice parameters, non-negotiable constraints, document shape, and relevant upstream findings. Token efficiency comes from treating full artifacts as external state and injecting only the high-signal summary that the next step actually needs.

---

## 2. Research Summary

### 2.1 Anthropic guidance on multi-agent systems

Anthropic’s **Building Effective Agents** argues for starting with the simplest viable pattern, then adding multi-step workflows only when single-call prompting is insufficient. The important distinction they draw is between:

- **workflows**: predefined code paths that orchestrate LLM/tool calls
- **agents**: model-directed systems that decide their own process and tool use

For Corina, most capability pipelines are better understood as **workflows**, not autonomous agents. That matters because context propagation should be engineered explicitly rather than left to emergent multi-turn behavior.

Anthropic recommends several composable patterns:

1. **Prompt chaining** — decompose work into fixed sequential subtasks; each call processes the previous output.
2. **Routing** — classify input, then send to specialized downstream prompts.
3. **Parallelization** — split independent subtasks or gather multiple votes.
4. **Orchestrator-workers** — a central model dynamically delegates subtasks and synthesizes results.
5. **Evaluator-optimizer** — one model drafts while another evaluates and provides refinement feedback in a loop.

Two points are especially relevant to Corina:

- Prompt chaining works best when the task decomposes cleanly into fixed subtasks.
- Orchestrator-worker systems are useful when you cannot predict subtasks ahead of time, but they require strong synthesis and observability.

Anthropic also emphasizes transparency, explicit planning, and careful tool / agent-computer interface design. In the context propagation problem, that translates into: **make the state carrier explicit, inspectable, and structured**.

Their prompting guidance adds two direct implementation cues:

- for long-context inputs, place longform data high in the prompt, structure it clearly, and ground outputs in relevant quoted context when needed;
- for context hydration in long or agentic systems, prefer deliberate context injection, tool-based retrieval, or compaction rather than relying on vague conversational carryover.

### 2.2 OpenCode session and agent architecture

OpenCode’s docs show that agents are configured assistants with custom prompts, permissions, and models. It supports both primary agents and subagents, but sessions remain first-class runtime containers. The JS/TS SDK exposes:

- `session.create()`
- `session.prompt()`
- `session.messages()`
- `session.delete()`

A session can absolutely carry context **within that same session** across multiple prompts. The SDK also supports `session.prompt({ noReply: true })` for injecting context without triggering a response. However, that persistence is scoped to the session ID.

That is decisive for Corina: if each pipeline step creates a fresh session and deletes it after the prompt, **no runtime context persists between steps unless the orchestrator re-injects it**.

OpenCode also distinguishes between:

- **sessions**: conversation containers with messages, status, summaries, children, and event streams
- **subagent invocations**: child-session work launched from a parent agent/session through task-style delegation

This means “session threading” is available in principle, but not in Corina’s current one-session-per-step architecture. If Corina keeps the present design, the orchestrator must remain the authoritative state owner.

OpenCode’s plugin/compaction model is also revealing. Its compaction hooks explicitly talk about generating continuation prompts for multi-agent sessions. That aligns with the same core design principle found elsewhere: **durable state should be richer than any single prompt, and prompts should be compiled views over that state**.

### 2.3 Established agentic context patterns

The broader literature converges on the same few patterns:

- **shared state graphs** in LangGraph, where nodes read and update a typed state object through reducers;
- **memory protocols** in AutoGen, where memory can be queried and then injected into model context immediately before a step;
- **stateful-agent architectures** in Letta, which distinguish persistent state from the limited context window;
- **context engineering / compiled context** in Google’s ADK writing, which treats working context as a computed view over sessions, memories, and artifacts.

Among these, Google’s formulation is especially close to what Corina needs: **separate storage from presentation**. Store full workflow state durably; compile a minimal per-call view for each invocation.

### 2.4 Key insights from the research

1. **Do not confuse state with prompt text.** Durable execution state and per-call prompt context should be separate layers.
2. **The orchestrator should own shared truth.** In stateless or per-step fresh-session pipelines, the orchestrator is the only reliable continuity layer.
3. **Large context should usually move by reference, not by repeated inline inclusion.** Artifacts, handles, document refs, and retrieval beats prompt stuffing.
4. **Prompt chaining is strongest when handoffs are explicit.** Every downstream agent should receive a compact statement of prior decisions, constraints, and remaining obligations.
5. **Shared scratchpads improve continuity but can reduce discipline.** They help collaboration, but without schema and summarization they sprawl quickly.
6. **Context distillation is not optional in long pipelines.** Without periodic compression, token cost and signal dilution both grow.
7. **Debuggability improves when the exact injected context is serialized and inspectable.** If you cannot reconstruct what an agent saw, you cannot reliably debug its output.

---

## 3. Pattern Comparison Table

| Pattern | Mechanism | Pros | Cons | Reliability | Token Cost | Debuggability | Composability | Failure Recovery | Best For | Worst For |
|---|---|---|---|---|---|---|---|---|---|---|
| Execution Envelope | Orchestrator maintains typed context object; injects structured summary block into every step | Deterministic, inspectable, consistent across agents, easy to test | Requires disciplined schema design and update logic | High | Low-Medium | High | High | Good; state survives step failures | Fixed pipelines, auditable systems, brand/tone enforcement | Fully autonomous open-ended exploration without schema discipline |
| Prompt Chaining with Explicit Handoff | Each step emits a “what next agent needs” handoff summary | Simple, local, easy to layer onto existing prompts | Handoff quality can drift; summaries may omit key facts | Medium | Medium | Medium | Medium | Medium; depends on handoff completeness | Sequential workflows with strong local transitions | Large pipelines where omitted context compounds |
| Shared Scratchpad / Working Memory | Agents read/write a shared document or state store | Shared visibility, rich collaboration, good for parallel teams | Sprawl, race conditions, stale notes, harder to bound token use | Medium | Medium-High | Medium | Medium-High | Good if store is durable | Research swarms, iterative collaboration | Tight token budgets, high-discipline production gating |
| Session Threading | Reuse same OpenCode session across turns so prior messages persist | Natural continuity, low orchestration overhead | Hidden prompt growth, harder to guarantee what survives, weaker per-step isolation | Medium-High within one session | High over time | Low-Medium | Medium | Medium; session corruption can affect many steps | Conversational or interactive single-agent threads | Corina’s current fresh-session-per-step architecture |
| Tool-Retrieved Context | Agent calls tool or retrieval layer to fetch relevant context just-in-time | Keeps default prompts lean; scales to large artifacts | Requires good retrieval heuristics and tool-use reliability | Medium-High | Low baseline, variable at use time | High if retrieval logs are kept | High | Good; retrieval can be retried | Full-document context, profile lookup, archival inputs | Tiny workflows where direct injection is simpler |
| Orchestrator-Mediated Context | App code chooses which fields/artifacts to include in each prompt | Practical, central control, fits current system | Can devolve into ad-hoc prompt assembly if untyped | Medium-High | Medium | High | Medium-High | Good | Existing Corina architecture | Systems with many teams adding fields informally |
| Context Distillation | Summarize prior outputs/findings before passing them onward | Controls token growth; keeps salient signal | Distillation errors can hide nuance | Medium-High if schema-bound | Low | Medium-High | High | Good if raw artifact is still retained elsewhere | Long pipelines and repeated review loops | Edge cases requiring raw evidence every step |

### 3.1 Pattern inventory with examples

#### A. Execution Envelope

**Mechanism:** A typed object, owned by the orchestrator, carries normalized intent, constraints, voice config, document metadata, and summarized findings. Before each agent step, the orchestrator serializes the relevant fields into a compact prompt block.

**Pros:** Strongest balance of reliability, cost control, and observability. Every agent receives the same core truth.

**Cons:** Requires a maintained schema and step-update contracts.

**Best for:** Production workflows with multiple fixed steps, especially tone, critique, audit, and rewrite pipelines.

**Worst for:** Highly exploratory agent swarms where fields cannot be known in advance.

**Example:**
A tone-validator receives:
- `voice.name = journalist`
- `voice.tone_description = dry, evidence-first`
- `user_constraints = [never use first person]`
- `findings = [rewrite resolved headline jargon; paragraph 3 evidence still weak]`

#### B. Prompt Chaining with Explicit Handoff

**Mechanism:** Each agent emits an explicit downstream handoff section, e.g. “Next agent must verify X, preserve Y, fix Z.”

**Pros:** Easy retrofit. Encourages agents to think in terms of downstream consumers.

**Cons:** Lossy if agents summarize badly. Can create inconsistency when different steps invent different handoff styles.

**Best for:** Draft → validator → reviser loops.

**Worst for:** Multi-branch pipelines with many parallel joins.

**Example:**
Critique step outputs: “For auditor: paragraph 3 has weak evidence, intro overstates certainty, first-person violation not found.”

#### C. Shared Scratchpad / Working Memory

**Mechanism:** Agents write findings, open questions, and decisions into a shared artifact or store.

**Pros:** Useful for many-agent collaboration and later inspection.

**Cons:** Can become noisy and internally inconsistent without schema and compaction.

**Best for:** Parallel research, analysis swarms, long-running multi-agent collaboration.

**Worst for:** Tight deterministic writing pipelines where every token matters.

**Example:**
A scratchpad section records:
- decision: requested voice = journalist
- unresolved: paragraph 4 unsupported claim
- constraint: avoid first person globally

#### D. Session Threading

**Mechanism:** Keep one live OpenCode session and continue prompting into it, allowing prior turns to remain in context.

**Pros:** Minimal explicit plumbing.

**Cons:** Hidden token growth, unclear what the model pays attention to, weaker auditability of exact effective context.

**Best for:** Interactive manual sessions.

**Worst for:** Corina’s current isolated-step pipeline.

**Example:**
A single session contains outline, draft, critique, revise, audit turns. Later steps may see prior messages if the session is reused.

#### E. Tool-Retrieved Context

**Mechanism:** The agent gets compact base context plus tools/handles to fetch extra inputs only when needed.

**Pros:** Excellent for large documents, profile libraries, research inputs, and evidence packs.

**Cons:** Depends on tool reliability and good instructions about when to retrieve.

**Best for:** Fragment editing and large source packs.

**Worst for:** Small steps where retrieval overhead exceeds the benefit.

**Example:**
The prompt includes `full_document_ref: doc://strategy-article-2026-04-10` and a line: “If you need wider argument flow, request the document summary or paragraph-neighbor window from the document context tool.”

#### F. Orchestrator-Mediated Context

**Mechanism:** The app decides what to include for each step based on workflow state.

**Pros:** This is already how Corina partially works. Easy to evolve.

**Cons:** If left ad hoc, step prompts diverge and context omissions become invisible bugs.

**Best for:** Current system migration path.

**Worst for:** Unowned prompt templates spread across many modules.

**Example:**
`runAudit()` gets `draft + brief`, but today may miss explicit critique findings unless added manually.

#### G. Context Distillation

**Mechanism:** Convert verbose artifacts into concise structured findings before passing them onward.

**Pros:** Best token-control mechanism after references/handles.

**Cons:** Summaries can flatten nuance unless source artifact is still accessible by reference.

**Best for:** Review loops and gate agents.

**Worst for:** Cases where downstream steps need raw evidence excerpts, not summaries.

**Example:**
Instead of injecting a full critique JSON, pass:
- `P3 weak evidence (major)`
- `hedging acceptable`
- `voice fit 7/10`
- `fix: add supporting example or remove claim`

---

## 4. Recommended Design

### 4.1 Recommended pattern name

**Compiled Execution Envelope**

This name is deliberate. “Execution envelope” signals a durable, typed, workflow-level state carrier. “Compiled” signals that the prompt for any one agent is not the source of truth; it is a derived view assembled from richer state, references, and findings just before invocation.

This combines the best parts of three patterns:

- execution envelope for reliability,
- orchestrator-mediated context for practical fit with current architecture,
- tool-retrieved context for large documents and profiles.

### 4.2 Core design principles

1. **One authoritative context object per pipeline run.**
2. **Every step receives a context block, even if small.**
3. **Full artifacts stay out of the block unless strictly required.**
4. **Findings travel as typed summaries, not freeform prose where possible.**
5. **Large content moves by reference and retrieval.**
6. **Prompt-time context is reconstructible for debugging.**

### 4.3 `PipelineExecutionContext` interface

```ts
export type PipelineMode =
  | "write"
  | "rewrite"
  | "tone"
  | "detect"
  | "critique"
  | "concise";

export type ContentScope = "full_document" | "fragment";
export type FindingSeverity = "low" | "medium" | "major" | "fatal";

export interface ExecutionVoiceContext {
  name: string | null;
  tone_description: string | null;
  profile_ref?: string | null;
  key_rules: string[];
  banned_patterns: string[];
}

export interface ExecutionContentMetadata {
  format: string | null;
  audience: string | null;
  word_count: number | null;
  scope: ContentScope;
  fragment_label?: string | null;
  fragment_position?: string | null;
  full_document_ref?: string | null;
  full_document_summary?: string | null;
}

export interface ExecutionFinding {
  step: string;
  type: string;
  severity: FindingSeverity;
  summary: string;
  location?: string | null;
  action?: string | null;
}

export interface PipelineExecutionContext {
  run_id: string;
  capability: PipelineMode;
  user_intent_summary: string;
  requested_operation: string;
  source_material_refs: string[];
  user_constraints: string[];
  global_instructions: string[];
  voice: ExecutionVoiceContext;
  content: ExecutionContentMetadata;
  findings: ExecutionFinding[];
  assumptions: string[];
  step_history: string[];
}
```

### 4.4 Why this interface works

This schema solves the actual propagation problems:

- **Voice problem:** `voice.name`, `voice.tone_description`, `voice.profile_ref`, and `voice.key_rules` travel to every step.
- **Fragment problem:** `content.scope`, `full_document_ref`, and `full_document_summary` preserve document-level grounding without re-inlining the whole source each time.
- **Decision trail:** `findings[]` carries a concise version of prior critiques, validations, and audits.
- **Custom constraints:** `user_constraints[]` and `global_instructions[]` are shared invariant inputs for every agent.
- **WorkflowState gap:** the context is a first-class field, not hidden app memory.

### 4.5 Prompt injection template

Every agent prompt should include a stable structured block near the top of the user message or in a dedicated injected section after system instructions.

Example human-readable form:

```text
=== PIPELINE CONTEXT ===
Capability: tone | Requested operation: rewrite paragraph in requested voice
Intent: rewrite this paragraph to match the requested journalist voice while preserving meaning
Voice: journalist | Tone: dry, evidence-first | Profile ref: voices/journalist.txt
Voice rules: short declarative sentences; precise claims; no hype
User constraints: never use first person
Global instructions: preserve facts; do not invent evidence
Format: article | Audience: policy readers | Scope: fragment
Fragment context: paragraph 3 of a 2400-word strategy article
Full document ref: doc://strategy-article-2026-04-10
Full document summary: argument about AI procurement risk, evidence-led, analytical tone
Prior findings:
- critique: P3 weak evidence (major) → add support or soften claim
- tone-validator: voice fit drifted toward promotional phrasing (medium)
Assumptions:
- audience inferred from source terminology
=== END PIPELINE CONTEXT ===
```

Recommended serializer rules:

- Prefer short labeled lines over raw JSON for main prompts.
- Keep ordering stable across capabilities.
- Sort findings by severity, then recency.
- Limit findings shown inline; expose full artifacts separately by ref.

### 4.6 `buildContextBlock(ctx)` design

```ts
export function buildContextBlock(ctx: PipelineExecutionContext): string {
  const findings = ctx.findings
    .slice(0, 6)
    .map((f) => `- ${f.step}: ${f.summary}${f.action ? ` → ${f.action}` : ""}`)
    .join("\n");

  return [
    "=== PIPELINE CONTEXT ===",
    `Capability: ${ctx.capability} | Requested operation: ${ctx.requested_operation}`,
    `Intent: ${ctx.user_intent_summary}`,
    `Voice: ${ctx.voice.name ?? "none"} | Tone: ${ctx.voice.tone_description ?? "none"} | Profile ref: ${ctx.voice.profile_ref ?? "none"}`,
    `Voice rules: ${ctx.voice.key_rules.length ? ctx.voice.key_rules.join("; ") : "none"}`,
    `User constraints: ${ctx.user_constraints.length ? ctx.user_constraints.join("; ") : "none"}`,
    `Global instructions: ${ctx.global_instructions.length ? ctx.global_instructions.join("; ") : "none"}`,
    `Format: ${ctx.content.format ?? "unknown"} | Audience: ${ctx.content.audience ?? "unknown"} | Scope: ${ctx.content.scope}`,
    ctx.content.scope === "fragment"
      ? `Fragment context: ${ctx.content.fragment_label ?? "fragment"}${ctx.content.fragment_position ? ` (${ctx.content.fragment_position})` : ""}`
      : `Document context: full document`,
    ctx.content.full_document_ref ? `Full document ref: ${ctx.content.full_document_ref}` : null,
    ctx.content.full_document_summary ? `Full document summary: ${ctx.content.full_document_summary}` : null,
    `Prior findings:\n${findings || "- none"}`,
    `Assumptions: ${ctx.assumptions.length ? ctx.assumptions.join("; ") : "none"}`,
    "=== END PIPELINE CONTEXT ===",
  ]
    .filter(Boolean)
    .join("\n");
}
```

### 4.7 What changes in `src/pipeline.ts`

The minimum structural change is to make context explicit inside workflow state.

#### Current

`WorkflowState` carries artifacts and warnings but not a shared LLM-visible context.

#### Recommended change

```ts
export interface WorkflowState {
  briefText: string;
  context: PipelineExecutionContext;
  briefArtifact?: BriefArtifact;
  outlineArtifact?: OutlineArtifact;
  draftArtifact?: DraftArtifact;
  critiqueArtifact?: CritiqueArtifact;
  auditArtifact?: AuditArtifact;
  critiquePasses: number;
  warnings: string[];
}
```

#### Initialization

At pipeline start, build `context` from:

- the raw user brief / tool args,
- inferred capability and requested operation,
- initial voice / profile inputs,
- user constraints parsed from args or brief,
- source material refs,
- document metadata if available.

Pseudo-flow:

```ts
const state: WorkflowState = {
  briefText: brief,
  context: initializePipelineExecutionContext(input),
  critiquePasses: 0,
  warnings: [],
};
```

#### Update after each step

Each step should return both its normal artifact and a small **context delta** or derivable finding set.

Examples:

- `runBriefIntake()` updates `user_intent_summary`, `requested_operation`, `content.format`, `content.audience`, `assumptions`
- `runOutline()` may add a finding like “outline prioritized 3-part argument structure” only if downstream relevant
- `runCritique()` adds structured findings for issues and revision directions
- `runAudit()` consumes prior findings and may add final gate findings

Use pure update helpers:

```ts
state.context = applyContextDelta(state.context, {
  findings: [
    {
      step: "critique",
      type: "evidence",
      severity: "major",
      summary: "P3 weak evidence",
      location: "paragraph 3",
      action: "add supporting example or soften claim",
    },
  ],
  step_history: ["critique:fail"],
});
```

This keeps `WorkflowState` as the durable runtime carrier while making the LLM-visible subset explicit and reproducible.

### 4.8 What changes in prompt construction

Every step constructor should stop assembling context ad hoc. Instead:

1. start with the agent-specific task instructions,
2. inject `buildContextBlock(state.context)`,
3. inject the exact local materials required for the step,
4. inject any referenced summaries or excerpts.

Pattern:

```ts
const prompt = [
  buildContextBlock(state.context),
  stepSpecificInstructions,
  localInputBlock,
].join("\n\n");
```

Local input still matters. The context block is not a substitute for the actual text being rewritten, critiqued, or audited. It is the **shared contract** that keeps the step grounded.

### 4.9 Token budget management

Target budget for the context block: **500–800 tokens maximum**.

#### Always include

- capability + requested operation
- one-line user intent summary
- active voice name and tone description
- top user constraints
- global instructions like preserve facts / do not invent
- content format / audience / scope
- full document ref when scope is fragment
- top 3–6 findings
- essential assumptions

#### Include conditionally

- `voice.key_rules` only when a voice is active
- `full_document_summary` only for fragment editing or when the source is long
- `source_material_refs` only when multiple sources matter
- `step_history` only in debug mode or when needed for loop control

#### Never inject by default

- full critique JSON
- entire brand profiles
- full earlier drafts
- long raw evidence packs
- complete session history

#### Distillation policy

- cap findings at 6 inline items,
- compress older findings into a single synthesis finding,
- deduplicate repeated constraint/finding language,
- store raw artifacts externally and link by reference.

### 4.10 Solution to the fragment document problem

This is the place where most pipelines get wasteful.

#### Recommendation

Use a **three-layer approach**:

1. **Always pass the fragment itself** — the exact paragraph or section under edit.
2. **Always pass document metadata + short document summary** — purpose, audience, argument arc, stance, and where the fragment sits.
3. **Pass the full document only on demand or in one targeted retrieval window** — not in every prompt.

#### Concretely

When editing a paragraph from a long article:

- in `PipelineExecutionContext`, set:
  - `scope = "fragment"`
  - `fragment_label = "paragraph 3"`
  - `full_document_ref = "doc://..."`
  - `full_document_summary = "2400-word strategy article arguing for evidence-led AI adoption governance"`

- inject with the fragment:
  - previous paragraph + next paragraph **or**
  - a short local neighborhood window summary

- allow retrieval of the full document or larger slices only if:
  - the agent needs to validate continuity,
  - evidence dependencies cross sections,
  - the fragment’s claims depend on earlier definitions.

#### Why this is correct

It minimizes default token load while preserving enough macro-context to avoid local rewrites that break document logic.

### 4.11 Answers to the five specific system questions

#### 1. The voice problem

The auditor should not infer the requested voice from upstream prose. It should receive the same normalized `voice` object as every prior step through the execution envelope.

Best mechanism:
- `context.voice.name = "journalist"`
- `context.voice.tone_description = "dry, evidence-first"`
- `context.voice.key_rules = [...]`
- optional `profile_ref` for full prompt file or brand profile

This means the auditor validates against the requested voice, not merely the draft it sees.

#### 2. The fragment problem

Do not pass the whole document into every prompt. Pass:
- the fragment,
- a short document summary,
- the fragment’s position in document,
- a ref to retrieve more context,
- optionally neighboring paragraphs.

Use full-document retrieval only where the step genuinely needs it.

#### 3. The decision trail

Convert prior agent outputs into `findings[]` entries inside `PipelineExecutionContext`. Preserve the raw critique artifact separately, but only inject the concise findings unless a later step explicitly needs the full artifact.

#### 4. Custom user constraints

Treat them as invariant pipeline policy, not ephemeral prompt text. Store them in `user_constraints[]`, inject them into every step, and include explicit validation responsibility in validator/auditor prompts.

Example: `never use first person` must appear in writer, validator, and auditor context blocks.

#### 5. The `WorkflowState` gap

The minimal reliable solution is:
- add `context: PipelineExecutionContext` to `WorkflowState`
- build it once at initialization
- update it after every step
- inject `buildContextBlock(context)` into every step prompt

This is enough to close the continuity gap without introducing a full shared-memory subsystem.

---

## 5. Migration Path

### 5.1 Phase 1 — Add explicit context object

- Add `PipelineExecutionContext` types to `src/types.ts`
- Add `context` field to `WorkflowState`
- Add `initializePipelineExecutionContext(input)` helper
- Add `buildContextBlock(ctx)` helper

### 5.2 Phase 2 — Define update contracts per step

Every step should produce either:
- a `contextDelta`, or
- enough structured artifact fields for the orchestrator to derive deltas deterministically.

Example contract:

```ts
interface StepContextDelta {
  assumptions?: string[];
  findings?: ExecutionFinding[];
  content?: Partial<ExecutionContentMetadata>;
  voice?: Partial<ExecutionVoiceContext>;
  step_history?: string[];
}
```

### 5.3 Phase 3 — Retrofit existing capabilities

#### `write`
- initialize user intent, audience, format, and source refs
- record outline decisions only if downstream relevant
- propagate critique and audit findings explicitly

#### `tone`
- always normalize voice into `context.voice`
- persist user constraints like “never use first person”
- validator and auditor consume same voice contract

#### `detect`
- carry content metadata and prior transformations if detection follows rewrite/tone
- keep raw evidence external; pass only top signals in findings

#### `critique`
- write structured issue findings into `context.findings`
- propagate fix directions to reviser/auditor

#### `concise`
- preserve global constraints and source refs
- mark compression obligations in requested operation and findings

### 5.4 Phase 4 — Add reference-backed document context

Introduce a document context service or lightweight internal helper that can:
- store/retrieve full document by ref,
- produce document summaries,
- return neighboring paragraph windows,
- log retrievals for debugging.

### 5.5 Phase 5 — Observability and tests

Persist the exact built context block for each step in logs or debug traces.

Test categories:
- unit tests for context initialization,
- unit tests for context update / merge semantics,
- snapshot tests for `buildContextBlock()` output,
- integration tests that verify downstream prompts include required voice and constraints,
- regression tests for token-budget limits,
- fragment-edit tests proving continuity without full-doc stuffing.

---

## 6. Open Questions

1. **Should Corina eventually reuse sessions within a capability run?**
   The recommended design does not require it, but a hybrid model could reduce prompt assembly overhead for some pipelines.

2. **Where should full documents and large artifacts live?**
   Options include filesystem refs, in-memory store per run, or a lightweight artifact registry.

3. **Should context updates be generated by code or by LLM-produced handoff objects?**
   Best default: code derives what it can, LLM emits structured deltas only for subjective findings.

4. **How much of `step_history` should be visible to agents vs only to logs?**
   Probably minimal in prompts, fuller in debug traces.

5. **Should brand profiles be embedded inline or referenced?**
   Best default: inject short normalized rules inline, keep full profile by ref.

6. **What is the exact serialization budget by capability?**
   The 500–800 token target is good globally, but each capability may need tighter caps.

7. **Should a separate context-distiller step exist for long evaluator loops?**
   Likely yes for critique-heavy or multi-pass writing runs.

---

## 7. References

### Official sources

- Anthropic — Building Effective Agents  
  https://www.anthropic.com/research/building-effective-agents
- Anthropic Claude Docs — Prompting best practices / prompt chaining / long context guidance  
  https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/chain-prompts
- Anthropic Claude Docs — Tool use guidance  
  https://docs.anthropic.com/en/docs/build-with-claude/tool-use
- Anthropic Claude Docs — Define tools  
  https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools
- OpenCode Docs — Agents  
  https://opencode.ai/docs/agents/
- OpenCode Docs — SDK  
  https://opencode.ai/docs/sdk/
- OpenCode Docs — Plugins  
  https://opencode.ai/docs/plugins/
- OpenCode Docs — Tools  
  https://opencode.ai/docs/tools/
- OpenCode Docs — Commands  
  https://opencode.ai/docs/commands/

### Engineering and framework references

- Google Developers Blog — Architecting efficient context-aware multi-agent framework for production  
  https://developers.googleblog.com/architecting-efficient-context-aware-multi-agent-framework-for-production/
- AutoGen Docs — Memory and RAG  
  https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/memory.html
- Letta Blog — Stateful Agents: The Missing Link in LLM Intelligence  
  https://www.letta.com/blog/stateful-agents
- LangGraph documentation and tutorials on shared state / multi-agent collaboration  
  https://langchain-ai.github.io/langgraph/

---

## Appendix A — Practical recommendation in one sentence

For Corina, the right design is: **keep full workflow state outside the model, compile a compact typed execution envelope into every prompt, pass large artifacts by reference, and propagate upstream decisions downstream as structured findings rather than hoping later agents infer them from local prompts.**
