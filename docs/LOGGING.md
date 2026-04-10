# Corina Logging Policy

## Purpose

This policy defines the logging contract for the Corina OpenCode plugin ecosystem:

- `opencode-corina` — runtime capability logging + capability audit log
- `opencode-model-resolver` — lightweight resolver diagnostics
- `opencode-eval-harness` — unchanged; keeps its own report format
- `opencode-text-tools` — no runtime logging

The goal is observability without noise: enough detail to debug degraded runs, trace capability behavior, and measure LLM token/cost usage, without dumping prompts or content.

## Log levels

### `debug`
Use for detailed internals that are useful during development or verbose troubleshooting only.

Examples:
- session created / deleted
- model resolver cache hits
- resolved model ids
- capability step starts

### `info`
Use for meaningful lifecycle events.

Examples:
- capability start / complete
- step complete
- rewrite complete
- validation complete
- chain start / complete
- live catalog fetch
- every `llm_call`

### `warn`
Use for degraded but non-fatal behavior.

Examples:
- fallback to local validation
- missing brand profile causing voice fallback
- partial parse / retry path
- no-input or degraded capability output

### `error`
Use for real failures.

Examples:
- session prompt failure
- schema parse failure that aborts a step
- network failure
- unresolved provider / fetch failure

## Required runtime logs

The following are non-negotiable.

### 1. Every capability invocation
Must log:
- `capability`
- `mode` where applicable
- `input_summary`
- `input_word_count` when text exists
- `model_preset` if requested

Event: `capability_start`

### 2. Every step start / end
Must log:
- `step`
- `duration_ms`
- `model_id` when known
- `pass` when the step has a meaningful pass/fail state

Events:
- `step_start`
- `step_complete`

### 3. Every LLM session / call
Every prompt call must log:
- `session_id`
- `step`
- `model_id`
- `provider_id`
- `tokens.input`
- `tokens.output`
- `tokens.cache_read`
- `tokens.total`
- `cost`
- `duration_ms`

Event: `llm_call`

Canonical shape:

```json
{
  "timestamp": "2026-04-10T17:20:00.000Z",
  "service": "corina",
  "level": "info",
  "event": "llm_call",
  "session_id": "abc123",
  "step": "critique",
  "model_id": "claude-sonnet-4.6",
  "provider_id": "github-copilot",
  "tokens": {
    "input": 2400,
    "output": 180,
    "cache_read": 2200,
    "total": 2580
  },
  "cost": 0,
  "duration_ms": 4200
}
```

### 4. Every chain execution
Must log:
- source capability
- `chain_target`
- outcome

Events:
- `chain_start`
- `chain_complete`

### 5. Every error
Must log:
- `error_type`
- `message`
- `step`
- whether output degraded or failed

Event examples:
- `step_error`
- `capability_error`
- `catalog_fetch_failed`

### 6. Capability output summary
Must log summary fields for the final result:
- `word_count`
- pass/degraded outcome
- `assumptions_count`
- total aggregated tokens / cost for that capability run

Events:
- `critique_complete`
- `rewrite_complete`
- `validation_complete`
- `capability_complete`

## What must not be logged

Never log these at normal runtime levels:

- full prompt text
- full input content
- full output content
- internal TypeScript helper calls
- successful schema validations
- cache hits outside `debug`

## Structured format

All runtime logs must be structured JSON, not prose.

Required fields on every log entry:
- `timestamp`
- `service`
- `level`
- `event`

Additional fields are event-specific and must stay structured.

## Destinations

### OpenCode runtime logs
Destination: `client.app.log()`

These surface in OpenCode runtime logs under `~/.local/share/opencode/log/`.

Use for:
- all step logs
- all LLM call logs
- all warnings and errors
- all chain events

### Corina capability audit log
Destination: `~/.local/share/opencode/corina-audit.jsonl`

Use for capability-level records only:
- one record per `/corina-write`, `/corina-tone`, `/corina-detect`, `/corina-critique`
- optional extra record for `chain_complete`
- one `session_idle` record per idle event

Do **not** write step-level or LLM-call entries to the audit log.

## Audit log schema

```ts
export interface AuditLogEntry {
  timestamp: string
  event: "capability_complete" | "session_idle" | "chain_complete"
  capability: string
  mode?: string
  session_id?: string
  input_summary?: string
  outcome: "success" | "degraded" | "failed"
  duration_ms?: number
  total_tokens?: number
  total_cost?: number
  chain_target?: string
  assumptions_count?: number
}
```

## Inference cost tracking

For OpenCode SDK responses, read token/cost usage from:
- `result.data.info.tokens`
- `result.data.info.cost`

Corina aggregates `total_tokens` and `total_cost` at capability scope by summing every `llm_call` in that capability run.

This summary is emitted:
- in runtime `capability_complete`
- in capability-level audit records

## Repo-specific policy

### `opencode-corina`
Required logging:
- capability lifecycle
- step lifecycle
- all prompt sessions
- chain lifecycle
- degraded fallbacks
- capability totals for tokens/cost

Do not add logging to:
- `validators.ts` success path
- low-value internal helper calls

### `opencode-model-resolver`
Use direct console JSON logs only.

Required events:
- `catalog_fetch` at `info`
- `catalog_cache_hit` at `debug`
- `model_resolved` at `debug`
- `catalog_fetch_failed` at `error`

### `opencode-text-tools`
No runtime logging.

Reason: pure deterministic library, no session lifecycle, no provider/network state.

### `opencode-eval-harness`
No changes required by this policy. It already uses its own report artifacts.

## Implementation notes

Corina uses a shared `AgentLogger` abstraction so runtime code can log through OpenCode in plugin mode and structured console output in tests / fallback contexts.

The logger contract is intentionally small:

```ts
export interface AgentLogger {
  debug(event: string, extra?: Record<string, unknown>): void
  info(event: string, extra?: Record<string, unknown>): void
  warn(event: string, extra?: Record<string, unknown>): void
  error(event: string, extra?: Record<string, unknown>): void
}
```

## Noise controls

To keep logs useful:
- prefer one structured event over multiple prose messages
- log retries and fallbacks once, with reason
- keep step-level logging in runtime logs, not audit JSONL
- keep debug-only detail out of normal operator output

## Verification checklist

A logging change is only complete if:
- build passes
- unit tests pass
- Tier 1 eval output has no stray production `console.log` noise
- one live runtime path emits expected structured events for capability start, llm_call, step completion, and capability completion
