# Evaluation Performance

## Expected LLM call count

### Critique
- Quick quality critic path: prose + voice + critic-adjudicator = **3 calls**
- Persuasive / executive / brand / journalist quality path: prose + voice + evidence + critic-adjudicator = **4 calls**

### Audit
- Minimal audit path without evidence or format: prose + voice + auditor-adjudicator = **3 calls**
- Full persuasive audit path: prose + voice + evidence + format + auditor-adjudicator = **5 calls**

## Parallel execution savings

The evaluator phase runs in parallel and the adjudicator runs after aggregation.

Example full audit latency:
- sequential: prose (1x) + voice (1x) + evidence (1x) + format (1x) + adjudicator (1x)
- parallel: max(prose, voice, evidence, format) + adjudicator

In practice, the savings are strongest when evidence and voice are the long poles. The prompt overhead is worth it as soon as at least two evaluator calls would otherwise run back to back.

## Token cost estimates per module

These are planning estimates, not guarantees.

- prose-evaluator: moderate prompt + draft + compact findings envelope
- voice-evaluator: moderate prompt + draft + voice profile block
- evidence-evaluator: moderate prompt + draft + brief text
- format-auditor: cheapest evaluator; mostly deterministic structural checks
- critic-adjudicator: compact findings array + module status + brief/voice context
- auditor-adjudicator: compact findings array + original draft text

Rough relative cost profile:
- cheapest: format-auditor
- low-medium: prose-evaluator, critic-adjudicator, auditor-adjudicator
- medium: voice-evaluator
- highest: evidence-evaluator when the brief is long

## Chosen defaults
- prose-evaluator: `balanced @ 0.2`
- voice-evaluator: `quality @ 0.3`
- evidence-evaluator: `balanced @ 0.1`
- format-auditor: `fast @ 0.1`
- critic-adjudicator: `balanced @ 0.1`
- auditor-adjudicator: `fast @ 0.1`

## Caching recommendation for format-auditor

Cache `format-auditor` on:
- exact draft text hash
- requested format

That module is mostly deterministic, so it is the safest cache candidate.

Do **not** cache:
- evidence-evaluator across changed briefs
- voice-evaluator across changed voice profiles

## Logging requirement

Real cost analysis should come from `llm_call` events using `extractLlmMetrics`.
If metrics are missing, treat the numbers above as assumptions rather than measured truth.
