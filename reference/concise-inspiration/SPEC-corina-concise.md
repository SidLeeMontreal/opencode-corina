# `/corina-concise` — Consolidated Capability Spec

> Consolidated design for COR-253.
> Synthesizes the v1 two-stage concision workflow with the v2 tiered document pipeline.

---

## Overview

`/corina-concise` is a revision capability for tightening existing prose without stripping away what makes it valuable. It improves information density, clarity, momentum, and readability by diagnosing inefficiency, applying bounded revisions, and—when needed—reconciling the full draft after local edits. The governing rule is simple: **information density matters more than raw brevity**. The system must never cut for the sake of cutting, and must not sacrifice facts, nuance, evidence, argument logic, chronology, tone, or voice simply to hit a shorter output.

Within the Corina capability ecosystem, `/corina-concise` sits alongside:
- `detect` — analyzes whether a draft reads as AI-like or otherwise mechanically weak
- `critique` — identifies broader quality issues and editorial opportunities
- `tone` — rewrites for voice, register, or audience fit
- `pipeline` — generates new content from a brief

`/corina-concise` is specifically for **editing existing text**. It does not replace `pipeline`, and it should preserve more than it invents.

---

## Modes

### `quick`
A compact 2-pass flow based on the v1 architecture:
1. diagnostic audit
2. revision pass

Use for short content, typically **<= 500 words**. This mode favors speed and lower orchestration cost:
- one LLM round-trip for audit
- one LLM round-trip for rewrite

Best for:
- short LinkedIn posts
- bios
- intros/outros
- short memos
- compact marketing or product copy
- short opinion fragments where document-scale stitching is unnecessary

### `full`
A document-safe 4-pass flow based on the v2 architecture:
1. document orchestrator
2. paragraph-window revision loop
3. stitch pass
4. reconciliation pass

Use for **> 500 words**, especially articles, essays, op-eds, explainers, and any text where paragraph-to-paragraph coherence matters. This mode is explicitly built to avoid the core long-form failure mode: local edits that improve individual paragraphs while degrading the whole piece.

### Default behavior
Default mode is `auto`:
- **<= 500 words -> `quick`**
- **> 500 words -> `full`**

Implementation may still allow explicit override (`mode: "quick" | "full"`) if the caller wants either a cheaper fast pass or a safer document-scale pass.

---

## Core Operating Principles

1. **Information density > brevity**
   - Shorter is only better when meaning, force, and readability improve.

2. **Remove fluff, not substance**
   - Target filler, repetition, over-explanation, bloated transitions, weak phrasing, and low-information language.

3. **Preserve what carries value**
   - Facts
   - Nuance
   - Argument logic
   - Chronology
   - Named entities
   - Evidence
   - Distinctive tone/voice
   - Purposeful ambiguity
   - Rhetorical force

4. **Do not revise everything by default**
   - Already-efficient material should remain untouched.

5. **Local editing needs global protection**
   - Paragraph-level editing must be constrained, contextual, and followed by a document-level integrity check.

6. **Never fail silently**
   - Always return a valid artifact, even when the input is empty, already concise, or only lightly editable.

---

## Canonical Tag Taxonomy (23 Tags)

The 23-tag taxonomy is shared across both modes. `quick` uses it for diagnostic + revision. `full` uses it for orchestration, paragraph routing, stitch decisions, and reconciliation.

### Structural / Global

| Tag | Name | Definition |
|---|---|---|
| `LEDE` | Weak or delayed opening | The piece starts too slowly, with setup or abstraction that delays the main idea, argument, or conflict. |
| `NUT` | Missing or scattered core premise | The central thesis, argument, or purpose is unclear, buried, or diffused across too many places. |
| `KICKER` | Weak ending | The close lacks payoff, resonance, memorability, or a clean landing. |
| `FLOW` | Weak macro progression | The document's scene/idea order, progression, or pacing feels jumpy, muddy, or structurally inefficient. |
| `TRANS` | Weak transition | Movement between sections or paragraphs feels clunky, over-explained, abrupt, or mechanically glued together. |
| `FOCUS` | Digression or off-topic drift | Material may be locally fine but weakens the piece by pulling attention away from the core line. |
| `HEAD` | Weak headline/title | The title or headline is vague, bloated, generic, or underpowered relative to the content. |
| `WHITE` | Inefficient paragraphing/spacing | Paragraph chunking, whitespace, or block structure hurts pacing, emphasis, or readability. |

### Sentence-Level

| Tag | Name | Definition |
|---|---|---|
| `THROAT` | Throat-clearing/filler entry | Empty opener language, framing clutter, or warm-up phrasing delays substance. |
| `DENSITY` | Low-information language | Abstract, vague, jargon-heavy, or fluffy phrasing says little for the space it occupies. |
| `REDUND` | Redundancy/repetition | Repeated claims, duplicate structure, or restated ideas add bulk without adding meaning. |
| `QUOTE` | Padded quotation/dialogue | Quoted material wanders, repeats itself, or contains trim-able padding. |
| `RHYTHM` | Flat cadence | Sentence patterning is monotonous, overly uniform, or mechanically paced. |
| `HEDGE` | Excessive qualification | Too many hedges, qualifiers, or softeners weaken force without preserving meaningful nuance. |

### Creative-Specific

| Tag | Name | Definition |
|---|---|---|
| `VERB` | Weak verb construction | Verb-noun constructions or weak predicates dilute action and can be compressed into stronger verbs. |
| `IMAGE` | Abstract over concrete | The prose names mood or meaning abstractly when a concrete image would convey more with less. |
| `LAYER` | Single-purpose passage | A sentence or paragraph could carry action, insight, atmosphere, or implication more efficiently at once. |
| `ICEBERG` | Over-explanation | The draft spells out what readers can already infer, mistrusting implication and wasting words. |
| `EMO` | Emotional redundancy | Feelings are repeated, named too explicitly, or doubled in a way that reduces force. |
| `FIG` | Missed figurative compression | Metaphor or figurative phrasing could say more cleanly in fewer words, if it fits the voice. |

### Contextual / Journalistic

| Tag | Name | Definition |
|---|---|---|
| `DATA` | Weak/missing/misused informational support | A statistic, datum, or sharper factual anchor could replace bloated explanation—or current data use is inefficient. |
| `CONTEXT` | Mismatch to audience needs | The piece over-explains, under-explains, or calibrates detail at the wrong level for the intended reader. |
| `VOICE` | Voice at risk / voice dilution | Cuts or phrasing choices flatten style, personality, tonal bite, or the original texture of the prose. |

### Severity Scale

- `Minor` — polish-level inefficiency; does not materially damage understanding
- `Moderate` — noticeable drag on clarity, force, pacing, or focus
- `Major` — meaning, structure, readability, or payoff is materially compromised

---

## Mode-Level Workflow Summary

### Quick mode (`quick`)
1. **Pass A-lite: Diagnostic audit**
   - Analyze full short text
   - Return audit rows using the canonical tag taxonomy
   - Produce heat map summary
2. **Pass B: Revision pass**
   - Use original text + audit output
   - Produce revised draft, revision log, heat map, preservation check, unresolved issues

### Full mode (`full`)
1. **Pass A: Document orchestrator**
2. **Pass B: Paragraph-window revision loop**
3. **Pass C: Stitch pass**
4. **Pass D: Reconciliation**

---

## Pass A — Document Orchestrator (`full` mode only)

### Purpose
Pass A analyzes the whole document without rewriting it. Its job is to produce a safe revision plan for later paragraph-by-paragraph work.

### Input
- complete original document
- optional title/headline
- optional user constraints (brand voice, max compression, preserve quotes, etc.)

### Output
Pass A must produce:
1. **Document overview**
   - overall concision opportunity
   - primary global risks
   - recommended intensity (`light`, `moderate`, `heavy` concision)
2. **Paragraph function map**
3. **Concision audit table**
4. **Revision sequence**
5. **Heat map summary**
6. **Revision routing summary**

### Paragraph function map requirements
Each paragraph entry must contain:
- `paragraph` — paragraph ID (e.g. `P1`)
- `function` — best-fit role in the document
- `compression_priority` — `High | Medium | Low | None`
- `revision_risk` — `Low risk | Medium risk | High risk`
- `preservation_constraints` — what the reviser must not lose
- optional internal note explaining why the paragraph is or is not a good compression target

Common paragraph functions include:
- lede / opening
- nut / thesis / premise
- context
- evidence
- example
- transition
- turn
- escalation
- counterpoint
- conclusion
- kicker

### Scope classification: local vs bridge vs global
Every audit row must be routed into one of three scopes:

- **Local**
  - Fixable primarily inside the target paragraph
  - Typical tags: `THROAT`, `HEDGE`, `VERB`, `REDUND`, some `DENSITY`

- **Bridge**
  - Requires awareness of paragraph boundaries or adjacency
  - Typical tags: `TRANS`, some `FLOW`, some `WHITE`, repeated framing between neighboring paragraphs

- **Global**
  - Belongs to document-scale planning or end-stage repair
  - Typical tags: `LEDE`, `NUT`, `KICKER`, macro `FLOW`, large `FOCUS`, headline problems, full-piece repetition patterns

### Compression priority logic
Priority reflects both available improvement and safety:
- `High` — strong payoff and reasonably safe to edit
- `Medium` — worthwhile but should be handled carefully
- `Low` — some inefficiency exists, but paragraph is structurally delicate or already near efficient
- `None` — do not revise unless later passes prove it necessary

### Revision risk logic
Risk reflects how likely compression is to damage value:
- `Low risk` — mostly local clutter; paragraph can be revised safely
- `Medium risk` — some local gains are available, but framing or continuity matters
- `High risk` — paragraph carries delicate logic, transition, evidence framing, voice, or tonal function

### Preservation constraints
For any revisable paragraph, Pass A must explicitly capture what matters most, for example:
- key statistic
- named entity
- chronology of events
- contrast with adjacent paragraph
- emotional ambiguity
- quote language
- tonal bite
- scene-setting image
- legal or factual nuance
- evidence framing

### Pass A output schema expectations
At minimum, Pass A must return structured data sufficient to populate:
- `heat_map`
- `paragraph_function_map`
- routed audit rows by paragraph and scope
- ordered revision sequence
- document-level risk notes

Pass A must **not** rewrite the document.

---

## Pass B — Paragraph Window Reviser (both modes; looped in `full` mode)

### Purpose
Pass B is the editing engine. It makes bounded revisions that improve concision while protecting the paragraph's role in the larger document.

In `quick` mode, Pass B can operate over the short text as a single revision job informed by the diagnostic audit.

In `full` mode, Pass B runs paragraph by paragraph, using a sliding context window.

### Input format
Pass B must receive structured input containing:
- **original full text**
- **current working draft**
- **target paragraph ID**
- **previous paragraph** (`[NONE]` if not present)
- **target paragraph**
- **next paragraph** (`[NONE]` if not present)
- **relevant audit rows** for the target plus any bridge issues touching neighbors
- **paragraph function**
- **compression priority**
- **revision risk**
- **preservation constraints**

### Editing boundary rules

#### Editable zone
- The target paragraph is fully editable.

#### Reference zone
- The previous and next paragraphs are context by default.
- They are not open rewrite targets.

#### Optional bridge edits
- Minimal sentence-edge changes to previous/next paragraphs are allowed only if required for continuity.
- These are for:
  - transition repair
  - referential clarity
  - rhythm at the join
  - opening/closing compatibility after target revision
- They must never become opportunistic rewrites of surrounding content.

### Solution moves table
Pass B should use the following canonical tag-to-move mapping.

| Tag | Solution move | Description |
|---|---|---|
| `LEDE` | Front-load the core | Move the main idea, argument, or conflict forward so the reader reaches substance faster. |
| `NUT` | Clarify the heart | Consolidate the central premise into a clearer, more focused claim or framing sentence/paragraph. |
| `FOCUS` | Kill the darling | Remove or relocate digressions that weaken momentum even if they are individually attractive. |
| `FLOW` | Thread the scenes | Reorder or clarify movement so the progression of ideas or scenes feels logical and cumulative. |
| `KICKER` | Land the punch | Tighten or restore the ending so it leaves resonance, clarity, or payoff. |
| `HEAD` | Sharpen the hook | Replace vague or padded title/headline language with something tighter and more specific. |
| `WHITE` | Re-block for flow | Re-chunk paragraphing/spacing to improve pacing, readability, and emphasis. |
| `THROAT` | Cut the warm-up | Remove filler entry language, warm-up phrasing, or empty scene-setting that delays the point. |
| `HEDGE` | Commit to the claim | Reduce unnecessary qualifiers while preserving nuance that genuinely matters. |
| `DENSITY` | Densify with facts or images | Replace vague, abstract, or low-information phrasing with sharper detail, fact, or image. |
| `REDUND` | Merge or delete | Remove repeated ideas, duplicated framing, or redundant syntax while keeping the strongest version. |
| `RHYTHM` | Break the monotony | Improve cadence through sentence-length variation, tighter pacing, or better internal contrast. |
| `QUOTE` | Tighten quotation/dialogue | Trim padding in quoted material while preserving what is revealing, necessary, or tonally important. |
| `VERB` | Strengthen the action | Replace weak verb constructions with more direct, vivid, compressed verbs. |
| `IMAGE` | Concrete over abstract | Use concrete sensory detail or image where abstraction is wasting words or flattening force. |
| `LAYER` | Layer efficiently | Let a sentence do more than one job at once—action, meaning, implication, or character—without becoming bloated. |
| `ICEBERG` | Leave it implied | Remove explanation the reader can infer; trust implication when clarity survives. |
| `EMO` | Show, don't tell | Convey feeling through action, gesture, contrast, or detail instead of explicit emotional labeling. |
| `FIG` | Say more with less | Use figurative compression when it genuinely heightens precision, force, or texture. |
| `CONTEXT` | Right-size the load | Tune explanatory depth up or down so the draft matches the intended audience. |
| `VOICE` | Preserve the grain | Protect the original personality, tonal bite, rhythm, and texture during compression. |
| `TRANS` | Tighten the glue | Simplify or sharpen connective language between paragraphs, ideas, or beats. |
| `DATA` | Anchor with a stat | Use a precise datum or factual anchor when it can replace verbose explanation. |

### Output requirements
Pass B must return:
1. **revised paragraph**
2. **optional bridge edits**
   - previous paragraph: change or `No change`
   - next paragraph: change or `No change`
3. **revision log**
4. **preservation check**
5. **unresolved issues** for later pass(es)

### Revision log requirements
Each log entry should include:
- unique `id`
- `original_excerpt`
- `tags`
- `solution_move`
- `new_text`
- `scope` (`Target | Previous bridge | Next bridge`)

### Preservation check requirements
Pass B must explicitly verify preservation of:
- facts
- nuance
- argument function
- evidence
- tone / voice
- chronology
- optional notes if any element is partially at risk

### Unresolved issue handling
If a problem cannot be solved safely within the local window, Pass B must flag it instead of forcing an overreach. Typical unresolved issues:
- distant repetition across non-adjacent paragraphs
- document-wide pacing issue
- ending weakness dependent on later structure
- thesis placement problem beyond the local window
- cross-pass phrasing collision not visible inside the current window

---

## Pass C — Stitch Pass (`full` mode only)

### Purpose
Pass C is a document-level stitch pass that smooths the seams created by isolated paragraph revisions. It is not another freeform compression pass.

### What Pass C targets
Pass C should focus on:
- `FLOW` issues visible only after multiple local edits
- `TRANS` problems between revised paragraphs
- `WHITE` / paragraph block awkwardness after edits
- paragraph openings and closings that no longer connect cleanly
- repeated framing introduced by separate local revisions
- cross-pass rhythm mismatch
- duplicated signposting or connective phrases

### What Pass C must not do
Pass C must **not**:
- reopen the whole document for aggressive re-compression
- broadly rewrite paragraphs that already work
- introduce new ideas
- re-litigate every sentence-level choice
- optimize stylistic preferences unrelated to seam repair

### Input
- original full text
- current revised full draft after Pass B loop
- document audit summary
- unresolved issues passed forward from Pass B
- optional paragraph function map

### Output
Pass C must return:
- stitched full draft
- list/log of seam repairs performed
- any unresolved issues still requiring reconciliation

### Typical stitch operations
- tighten or restore a transition sentence
- trim repeated setup language between adjacent revised paragraphs
- adjust paragraph opening so references still make sense
- restore a dropped hinge phrase needed for logic
- rebalance paragraph chunking after cuts

Pass C is conservative by design.

---

## Pass D — Reconciliation (`full` mode only)

### Purpose
Pass D is the final integrity pass. It compares the original document against the revised full draft and makes only the smallest necessary repairs so the final piece is both concise and intact.

### What Pass D must detect
Pass D should compare original vs revised and check for:
- lost facts
- lost nuance
- weakened or broken argument logic
- damaged chronology
- weakened evidence or examples
- voice flattening / tonal damage
- overcompression that makes meaning too thin
- cross-pass artifacts (repetition, contradiction, rhythm mismatch)
- weak ending or setup/payoff breakage
- title/headline damage, if applicable

### Repair philosophy
Pass D is **surgical restoration only**:
- restore what must survive
- smooth what broke
- leave successful edits alone
- do not re-edit the whole piece

### Input
- original full text
- revised full draft after Pass C
- document audit summary
- unresolved issues from local/stitch passes
- preservation priorities, if provided

### Output
Pass D must return:
1. **reconciled draft**
2. **reconciliation log**
3. **preserved vs restored summary**
4. **remaining acceptable tradeoffs**
5. **final integrity assessment**

### Reconciliation log requirements
Each log entry should include:
- `id`
- `location`
- `issue_type`
- `what_changed`
- `reason`

---

## Typed Artifact: `ConciseArtifact`

The capability should normalize both modes into one output envelope.

```typescript
interface ConciseArtifact {
  mode: "quick" | "full"
  original_word_count: number
  revised_word_count: number
  compression_ratio: number  // revised/original, e.g. 0.72
  revised_draft: string
  heat_map: HeatMapEntry[]
  revision_log: RevisionLogEntry[]
  preservation_check: PreservationCheck
  unresolved_issues: string[]
  reconciliation_log?: ReconciliationEntry[]  // full mode only
  paragraph_function_map?: ParagraphFunctionEntry[]  // full mode only
}

interface HeatMapEntry {
  tag: string
  severity: "Minor" | "Moderate" | "Major"
  count: number
}

interface RevisionLogEntry {
  id: string
  original_excerpt: string
  tags: string[]
  solution_move: string
  new_text: string
  scope: "Target" | "Previous bridge" | "Next bridge"
}

interface PreservationCheck {
  facts: boolean
  nuance: boolean
  argument_function: boolean
  evidence: boolean
  tone_voice: boolean
  chronology: boolean
  notes?: string
}

interface ReconciliationEntry {
  id: string
  location: string
  issue_type: string
  what_changed: string
  reason: string
}

interface ParagraphFunctionEntry {
  paragraph: string
  function: string
  compression_priority: "High" | "Medium" | "Low" | "None"
  revision_risk: "Low risk" | "Medium risk" | "High risk"
  preservation_constraints: string
}
```

### Artifact notes
- `heat_map` is required in both modes.
- `revision_log` is required in both modes.
- `preservation_check` is required in both modes.
- `unresolved_issues` must always be present, even if empty.
- `paragraph_function_map` is included only for `full` mode.
- `reconciliation_log` is included only for `full` mode.

---

## Subagent Roster

The implementation should use four focused subagents/tasks:

- `concise-auditor`
  - Runs Pass A
  - In `quick` mode, this role can emit the lightweight diagnostic audit instead of the full orchestrator package

- `concise-reviser`
  - Runs Pass B
  - In `full` mode, loops over paragraph windows
  - In `quick` mode, performs the revision pass from original + audit

- `concise-stitcher`
  - Runs Pass C
  - Only used in `full` mode

- `concise-reconciler`
  - Runs Pass D
  - Only used in `full` mode

### Mode usage
- `quick`: `concise-auditor` + `concise-reviser`
- `full`: `concise-auditor` -> `concise-reviser` -> `concise-stitcher` -> `concise-reconciler`

---

## Prompt Files Needed

These prompt/task files should live under `prompts/tasks/` and be adapted from the reference materials.

- `concise-auditor.md`
  - Adapted from `v2-pass-a-document-orchestrator.md`
  - Must produce structured audit/orchestration JSON

- `concise-reviser.md`
  - Adapted from `v2-pass-b-paragraph-reviser.md`
  - Must produce structured paragraph-revision JSON suitable for accumulation into `ConciseArtifact`

- `concise-stitcher.md`
  - Adapted from the stitch responsibilities synthesized across `tiered-pipeline-analysis.md` and the v2 routing logic
  - Must perform seam repair only, not open-ended recompression

- `concise-reconciler.md`
  - Adapted from `v2-pass-c-reconciliation.md`
  - Must produce full-draft repair JSON plus `reconciliation_log`

### Important adaptation note
These prompts should **not** be copied verbatim from the inspiration files. They must be adapted into Corina's prompt architecture and produce structured JSON compatible with `ConciseArtifact`.

---

## Never-Fail Rule

`/corina-concise` must always produce output.

### Required behavior
- If input is empty, return a valid artifact with:
  - empty or unchanged `revised_draft`
  - empty `heat_map`
  - empty `revision_log`
  - populated `preservation_check`
  - explanatory `unresolved_issues` only if needed

- If input is extremely short, preserve unless there is an obvious safe gain.

- If a paragraph has no meaningful issues, preserve it verbatim.

- If the document is already highly concise, return:
  - minimal audit
  - unchanged draft
  - explicit note that no safe compression gains were found

The system must never fail simply because it found nothing to change.

---

## Eval Strategy

### Tier 1: correctness / safety gates
Write tests for:
- never-fail behavior on empty input
- never-fail behavior on very short input
- schema validity for `ConciseArtifact`
- compression ratio is computed and within reasonable bounds
- `preservation_check` fields are always populated
- quick/full mode selection behaves correctly at the word-count threshold
- already-concise input returns original text cleanly

### Tier 2: editorial quality dimensions
Evaluate for:
- improved information density
- preserved voice and tonal character
- no fabrication or fact drift
- maintained coherence across paragraphs
- preserved argument logic and chronology
- no obvious seam artifacts after full-mode stitching

---

## Integration with Existing Capabilities

### With `detect`
- `detect` can suggest `/corina-concise` when AI-score or machine-like verbosity is high.
- Good chain: detect -> concise when the issue is bloated, repetitive, or over-explained prose.

### With `tone`
- `/corina-concise` can run before `tone`.
- Recommended sequence when both are needed: **concise first, then tone rewrite**.
- Reason: tightening structure before tone transfer reduces the amount of text the tone model needs to reshape.

### With `pipeline`
- `/corina-concise` does **not** replace `pipeline`.
- `pipeline` is for generating text from a brief.
- `concise` is for editing existing text safely.

---

## Recommended Execution Notes

1. Use `auto` mode unless the caller explicitly requests `quick` or `full`.
2. Carry forward the original full text throughout the pipeline; every later pass needs it as a preservation anchor.
3. In `full` mode, the working draft must roll forward after each accepted paragraph revision.
4. Reconciliation should compare against the original, not merely the prior pass output.
5. Preserve unchanged paragraphs exactly where possible; do not churn text without gain.

---

## Final Design Summary

`/corina-concise` should be implemented as a dual-mode capability:
- **`quick`** for short-form, low-overhead diagnostic + rewrite
- **`full`** for long-form, document-safe orchestration with bounded local editing and final integrity repair

This combined design keeps the elegance of the v1 two-stage workflow while adopting the v2 pipeline required to make long-form concision trustworthy.
