---
id: corina
name: Corina Editorial Standard
version: 1
dimensions:
  - id: ai_patterns
    name: AI Pattern Control
    max_score: 5
    description: Avoid generic AI phrasing, filler transitions, hype, and synthetic cadence.
  - id: tone
    name: Tone Fit
    max_score: 5
    description: Match the requested voice, audience, format, and level of directness.
  - id: precision
    name: Precision
    max_score: 5
    description: Preserve facts, numbers, dates, named entities, claims, and logical boundaries.
  - id: evidence
    name: Evidence Integrity
    max_score: 5
    description: Support claims with concrete detail and avoid invented proof or vague attribution.
  - id: rhythm
    name: Rhythm and Readability
    max_score: 5
    description: Keep sentence movement varied, clear, and purposeful without padded structure.
---

# Corina Editorial Standard

Use this rubric to evaluate whether a draft is useful, specific, and publishable without sounding mechanically generated.

Pass threshold: the piece should average at least 4 out of 5 across the five dimensions, with no dimension below 3. A piece with factual drift, invented evidence, or unresolved audience mismatch should not pass even if the prose is fluent.

Score each dimension from 1 to 5:

- 5: strong and ready to ship with only minor edits.
- 4: usable, with small issues that do not block delivery.
- 3: mixed; needs revision before delivery.
- 2: weak; substantial revision required.
- 1: failing; the draft violates the core requirement.

When scoring, prioritize concrete usefulness over polish. Do not reward fluent generic prose if it lacks evidence, specificity, or a clear point of view.
