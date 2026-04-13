# Voice Creation Guide

Use this guide to create new voice files that are consistent, useful, and easy to maintain.

A voice file defines how writing should sound and behave stylistically. It does not define agent workflow, task routing, or reply/thread logic.

---

## Purpose of a voice file

A voice file should answer questions like:

- What does this voice sound like?
- What does it emphasize?
- What does it avoid?
- How does it reshape writing?
- What makes output feel recognizably “in voice”?

A voice file should not answer questions like:

- What should the agent do first?
- When should it ask a clarifying question?
- How should it behave in a reply thread?
- How should it route between scenarios?
- What tools should it use?

If a rule mainly helps run the agent, it does not belong in the voice file.

---

## Canonical template

Use this structure:

```markdown
---
id: <voice_id>
status: active
version: 1.0.0
owner: corina
---

**Identity statement**
A one-sentence definition of the voice: how it sounds, what it optimizes for, and what it avoids.

**Primary goal**
A short statement of what this voice is trying to achieve in the writing.

**Rule priority**
1. <highest-level stylistic priority>
2. <next priority>
3. <next priority>
4. <next priority>
5. <next priority>

**Core style rules**
1. <main stylistic behavior>
2. <main stylistic behavior>
3. <main stylistic behavior>
4. <main stylistic behavior>
5. <main stylistic behavior>

**Explicit rewrite behaviors**
- <specific rewriting move this voice tends to make>
- <specific rewriting move this voice tends to make>
- <specific rewriting move this voice tends to make>
- <specific rewriting move this voice tends to make>

**Avoid**
- <common stylistic drift>
- <common stylistic drift>
- <common stylistic drift>
- <common stylistic drift>

**Allowed**
- <what the voice may preserve or use without breaking>
- <what the voice may preserve or use without breaking>
- <what the voice may preserve or use without breaking>

**Do not**
- <hard stylistic boundary>
- <hard stylistic boundary>
- <hard stylistic boundary>
- <hard stylistic boundary>

**Format adaptations**
- `article`
  - <how the voice behaves in article form>
- `social`
  - <how the voice behaves in social form>
- `slide`
  - <how the voice behaves in slide form>
- `email`
  - <how the voice behaves in email form>

**Quality checks**
A strong output should meet these checks:
- <signal of success>
- <signal of success>
- <signal of success>
- <signal of success>

**Failure modes to avoid**
- <voice failure mode>
- <voice failure mode>
- <voice failure mode>
- <voice failure mode>

**Transformation guidance**
When rewriting:
1. <stylistic step>
2. <stylistic step>
3. <stylistic step>
4. <stylistic step>
5. <stylistic step>

**Example transform**

**Before**
> <source example>

**After**
> <rewritten example>
```

---

## Section-by-section guidance

### 1. id

Choose a short, durable, descriptive name.

Good:

- plain_language
- brand
- professional_email
- commercial_email
- work_chat

Avoid vague names like:

- strong
- premium
- modern
- smart

The name should tell you what kind of writing behavior the voice represents.

---

### 2. Identity statement

Write one sentence that defines the voice clearly.

A strong identity statement usually includes:

- the voice’s tone or posture
- what it is trying to do
- what it avoids

Good example:

> A plain-language voice that rewrites content so a general reader can understand it quickly and easily, without unnecessary complexity, assumed context, or avoidable jargon.

Weak example:

> A good voice for clear writing.

That is too vague to guide rewriting.

---

### 3. Primary goal

This section states the voice’s main function in the writing.

It should be short and concrete.

Good examples:

- Make the text clearer and easier to follow without changing the meaning.
- Make the message sound recognizably on-brand without drifting into generic marketing language.
- Make the communication fast, readable, and natural in live workplace chat.

This section helps anchor the voice before rules start adding nuance.

---

### 4. Rule priority

Use this section when the voice must balance competing values.

This is where you define what wins when tensions appear.

Common tensions:

- clarity vs nuance
- brevity vs warmth
- character vs readability
- persuasion vs credibility
- simplicity vs precision

Good example:

1. Preserve factual meaning.
2. Improve clarity.
3. Reduce ambiguity.
4. Keep necessary nuance and tone.
5. Make the text as concise as possible without making it abrupt, flat, or incomplete.

This section should stay about writing judgment, not workflow.

---

### 5. Core style rules

These are the main stylistic behaviors of the voice.

They should describe things like:

- sentence behavior
- diction
- clarity
- posture
- emphasis
- rhythm
- directness
- warmth
- rhetorical restraint

Good examples:

- Use clear, direct sentences.
- Prefer common words when they are equally accurate.
- Keep one main point in focus at a time.
- Use direct human phrasing.
- Keep paragraphs focused and reasonably short.

Bad examples:

- Ask for clarification when context is missing.
- Reply point by point when the user asks multiple questions.
- Use this voice only in client work.

Those are not style rules.

---

### 6. Explicit rewrite behaviors

This section translates the voice into repeatable rewrite moves.

It is one of the most useful sections because it turns abstract style into action.

Examples:

- Replace unclear pronouns when the reference is ambiguous.
- Break overloaded sentences into shorter ones.
- Replace vague value language with more concrete wording.
- Bring the main point closer to the start.
- Keep dates, names, and responsibilities explicit.

These are still voice-level because they describe how the writing changes.

They should not become process instructions like:

- First analyze the audience.
- If missing context, ask the user.
- Compare against previous thread messages.

---

### 7. Avoid

Use this section for patterns that weaken the voice but are not always absolute violations.

Think of this as “common drift.”

Examples:

- vague references
- decorative wording that hides the point
- stacked qualifiers
- newsletter sprawl
- fake warmth
- overly polished corporate phrasing

This section is softer than Do not.

---

### 8. Allowed

Use this section to prevent overcorrection.

This is especially useful when a voice could become too rigid.

Examples:

- light figurative language if it does not reduce clarity
- technical terms when necessary and briefly explained
- some rhythm variation to keep the writing natural
- warmth and brand character as long as the meaning stays clear

This section tells the writer what the voice can keep without breaking.

---

### 9. Do not

Use this section for hard stylistic boundaries.

These are stronger than Avoid.

Examples:

- Do not simplify by changing the claim.
- Do not strip out all personality from the writing.
- Do not exaggerate urgency or impact.
- Do not make the writing sound childish.
- Do not turn neutral work communication into sales copy.

If something would seriously distort the voice, put it here.

---

### 10. Format adaptations

This section explains how the same voice behaves across formats.

It should stay stylistic.

Good:

- in slides, the voice becomes tighter and more explicit
- in email, it leads with the purpose and keeps the tone direct but human
- in social, it compresses while keeping the point clear

Bad:

- in email, answer the latest thread item first
- in social, optimize for engagement
- in article, use a 3-part argument arc

Those become strategy or task instructions.

The key question is:

How does the voice express itself in this format?

Not:

How should the agent execute the task in this format?

---

### 11. Quality checks

This section defines what good output looks like.

These should be reviewable signals, not vague aspirations.

Good examples:

- The main point is easy to understand on first read.
- The output feels human and direct.
- The brand posture is recognizable without becoming theatrical.
- The rewrite feels simpler, not thinner.
- One CTA stands out clearly.

Write these so a reviewer can actually use them.

---

### 12. Failure modes to avoid

Use this section when the voice has obvious ways it can go wrong.

Examples:

- becoming flat, rigid, or mechanical
- sounding polished but generic
- removing too much nuance
- overusing approved vocabulary
- sounding like email pasted into chat

This section is useful because many voices fail in predictable ways.

---

### 13. Transformation guidance

This section is allowed as long as it stays stylistic.

It should describe how the voice tends to transform writing.

Good:

1. Identify the core meaning.
2. Make the main point clear early.
3. Replace unnecessary complexity with simpler wording.
4. Remove ambiguity and hidden context.
5. Read the result for flow, not just simplicity.

Bad:

1. Determine whether the user is replying.
2. Ask for missing information.
3. Route to another voice if needed.

That is no longer about voice.

---

### 14. Example transform

Always include at least one strong example.

Best practice:

- show a meaningful “Before”
- show a clear “After”
- choose a source with enough friction to prove the voice matters

A weak example is too easy and does not reveal much.

A strong example includes something the voice must actively reshape:

- jargon
- vagueness
- stiffness
- abstraction
- generic marketing language
- overloaded sentence structure

Examples are often the most concrete part of the whole file.

---

## Required vs recommended vs optional sections

### Required

- Identity statement
- Primary goal
- Core style rules
- Format adaptations
- Quality checks
- Example transform

### Strongly recommended

- Rule priority
- Explicit rewrite behaviors
- Avoid
- Do not
- Failure modes to avoid

### Optional

- Allowed
- Transformation guidance

Not every voice needs the same depth, but every added section must remain voice-pure.

---

## Voice-purity test

Before saving a voice file, test every rule with this question:

Would this still help a human writer who knows nothing about the agent system?

If yes, it probably belongs.

If the rule mainly helps with:

- workflow
- orchestration
- thread handling
- task routing
- tools
- runtime decisions

it does not belong.

---

## How to create a new voice

Use this sequence.

### Step 1: Define the writing behavior

Describe the voice in plain terms.

Ask:

- What kind of writing is this?
- What makes it distinct from the other voices?
- What does it optimize for?
- What does it avoid?

### Step 2: Write the identity statement

Turn that into one clear sentence.

### Step 3: Set the primary goal

State what the voice is trying to improve or produce.

### Step 4: Define the main tensions

Ask what this voice must balance:

- clarity vs texture
- brevity vs warmth
- brand character vs readability
- directness vs tact

Use those to write Rule priority.

### Step 5: Write the core style rules

Keep these focused on tone, rhythm, clarity, diction, and posture.

### Step 6: Add explicit rewrite behaviors

List the most characteristic rewrite moves of the voice.

### Step 7: Define boundaries

Fill in:

- Avoid
- Allowed
- Do not

These sections prevent drift and overcorrection.

### Step 8: Write format adaptations

Describe how the same voice behaves in article, social, slide, and email forms.

### Step 9: Define review criteria

Write quality checks and failure modes.

### Step 10: Add a real example

Choose a source passage and rewrite it in the voice.

---

## Questions to ask while writing a voice

Use these prompts to develop the file:

- What does this voice make more clear?
- What does it tend to simplify, sharpen, soften, or foreground?
- What kind of phrasing would immediately feel wrong in this voice?
- What is the most common overcorrection risk?
- What should stay intact even after rewriting?
- What would a reviewer point to and say, “yes, that feels right”?

---

## Common mistakes

### 1. Making the voice too vague

Bad:

- clear
- strong
- good tone

That is not enough to guide rewriting.

### 2. Mixing voice with workflow

Bad:

- if replying, answer the latest message first
- ask for clarification if context is missing
- escalate to another voice if the tone is formal

That is agent logic.

### 3. Making the voice too rigid

A voice should guide the writing, not trap it.

Use Allowed to prevent overcorrection.

### 4. Banning the wrong things

Do not ban grammar labels just because they sound technical.
Ban actual failure patterns.

Better:

- sentences that require rereading to identify the subject or action

Worse:

- subordinate clauses

### 5. Writing quality checks that are too vague

Bad:

- it sounds better

Better:

- the main point is easier to understand on first read

### 6. Using weak examples

If the example is too easy, it does not teach the voice.

---

## Recommended review checklist

Before saving a voice file, check:

- Is the identity statement clear and specific?
- Does the primary goal anchor the voice well?
- Are the core rules all stylistic?
- Do the rewrite behaviors reflect real moves the voice makes?
- Do the boundaries prevent obvious drift?
- Do the format adaptations stay about expression, not execution?
- Are the quality checks usable in review?
- Are the failure modes real and specific?
- Does the example prove the voice?

If yes, the file is likely ready.

---

## Recommended naming principles

Use names that describe the writing behavior clearly.

Good:

- plain_language
- brand
- commercial_email
- professional_email
- work_chat

Avoid vague or aspirational names that do not imply actual writing behavior.

---

## Final rule

A good voice file can be rich, as long as it stays about the voice.

It can describe:

- how the writing sounds
- how it transforms text
- what it avoids
- what good output feels like

It should not become a hidden operating manual for the agent.
