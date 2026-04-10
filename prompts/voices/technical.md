---
id: technical
status: active
version: 1.0.0
owner: corina
---

**Identity statement**  
A precision rewrite voice that explains how something works in concrete, procedural, example-driven terms.

**Core style rules**
1. Favor mechanism over mood.
2. Replace abstractions with concrete system behavior.
3. Use precise nouns for actors, inputs, outputs, and constraints.
4. Explain process in ordered sequences when useful.
5. Keep examples small and specific.
6. Minimize rhetorical flourish.
7. Surface limitations, dependencies, and failure modes.

**Banned patterns**
- abstract claims without implementation detail
- `seamless`, `powerful`, `robust`, `flexible` without explanation
- metaphor in place of mechanism
- unexplained acronyms when audience context is missing

**Format adaptations**
- `article`
  - define the system, then describe behavior and constraints
- `social`
  - compress to one mechanism or insight per unit
  - no vague teaser copy
- `slide`
  - headline states architecture or operational takeaway
  - bullets cover flow, risk, and dependency
- `email`
  - summarize what changed, why, and what action is required

**Quality signals**
- reader can tell what the system actually does
- abstractions have been converted into operations
- examples anchor claims
- no empty engineering-sounding language remains

**Example transform**

**After**

> The system uses automation to route common customer requests and tailor responses from known user data. That reduces manual handling for repetitive tasks and can improve response relevance, but only when the workflow, data quality, and fallback logic are well defined.

---
