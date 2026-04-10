# Tiered Concision Pipeline — Analysis & Design Notes

> **Source:** External design analysis — inspiration for `/corina-concise` capability.
> **Status:** Reference only. Do not use as-is. Adapt into Corina's prompt architecture.
> **Related ticket:** COR-253
> **Context:** This is the architectural reasoning behind the 4-pass pipeline design.

---

The core issue is that current prompts are good at local editing but not yet designed for document-scale orchestration.

What you want is not "one concision agent for a whole article."

What you want is a tiered concision pipeline:
1. global diagnosis
2. localized revision in sliding context
3. document-level reconciliation pass
4. substance-preservation check against original

That is the right shape.

## What is correct in your intuition

The strongest part of your thinking is this:
- concision should happen paragraph by paragraph
- but paragraph edits cannot be blind
- each paragraph needs adjacent context
- and the system needs a final pass to ensure the whole piece still works

Because concision errors happen at two different levels:
- **local inefficiency**: throat-clearing, redundancy, weak verbs, padded sentences
- **global distortion**: removing setup, breaking transitions, collapsing nuance, flattening voice

## The real design problem

How do I let the model make local cuts without accidentally damaging global meaning, rhythm, or argument structure?

That requires three things not yet explicitly enforced:

**1. Stable unit of revision**
- target paragraph is editable
- adjacent paragraphs are reference context unless explicitly marked editable

**2. Rolling updated context**
As each paragraph is revised, the next pass must use the latest accepted version of prior paragraphs.

**3. End-stage reconciliation**
A final pass whose only job is: compare original vs revised, detect lost nuance/dropped facts/transition breaks, restore what matters.

## Best orchestration model

### Pass A — Full-document audit
Input: full draft
Output: audit table + paragraph function map + revision priority order + local vs bridge vs global classification

### Pass B — Local revision loop
For each paragraph in order:
Input: original full draft + current working draft + target paragraph index + previous/target/next paragraphs + relevant audit rows
Output: revised target paragraph + optional bridge edits + preservation notes

### Pass C — Stitch pass
Input: full revised draft + original draft + global and bridge issues from audit
Output: cleaner transitions + resolved repetition + restored rhythm and flow

### Pass D — Loss check
Input: original draft + revised draft
Output: list of lost facts/nuance/voice + surgical fixes only

## Core principles

- Brevity is not the goal. **Improved information density is the goal.**
- Do not shorten if shortening reduces clarity, voice, or substance.
- Leave already-efficient material alone.
- Do not force the system to revise every paragraph — some are already doing their job.

## What to preserve explicitly

For every revision pass, preserve:
- factual content
- argument logic
- nuance
- named entities
- chronology
- evidence
- meaningful tone/voice
- intentional ambiguity

Target removal of:
- repetition
- filler
- throat-clearing
- abstract vagueness
- over-explanation
- bloated transitions
- weak phrasing
- duplicated framing

## The hidden failure mode

The biggest failure mode is not "it misses a redundant phrase."
It is: **the model learns that concision means compression at all costs.**
That is where nuance dies.
