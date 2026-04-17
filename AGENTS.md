# AGENTS.md — Corina Writing Agent

## System Overview

Corina is a primary OpenCode agent and editorial writing system.
Distributed as an npm package (`opencode-corina`) and as a local plugin via `.opencode/plugins/corina.ts`.

Orchestration model:

```
User
→ Corina (primary agent — conversational orchestrator)
→ .opencode/tools/ (standalone callable tools)
→ src/ execution layer (TypeScript, opencode-corina npm)
→ .opencode/agents/ subagents (spawned via Task tool)
```

## Agent Roster

| Agent | Mode | Role |
|---|---|---|
| corina | primary | Front-facing writer. Owns conversation. Delegates to tools and subagents. |
| prose-evaluator | subagent | Universal prose-quality evaluator for critique and audit runs. |
| voice-evaluator | subagent | Voice-alignment evaluator for critique and audit runs. |
| evidence-evaluator | subagent | Evidence-integrity evaluator for critique and audit runs. |
| format-auditor | subagent | Deterministic formatting evaluator for audit runs. |
| critic-adjudicator | subagent | Aggregates modular evaluator findings into final quality, audience, rubric, or compare critique output. |
| auditor-adjudicator | subagent | Aggregates modular evaluator findings into final audit output. |
| detector | subagent | LLM-based AI detection judge (Layer 2). Invoked by the `detect` tool. |
| tone-writer | subagent | Voice application. Invoked by the `tone` tool. |
| tone-validator | subagent | Validates tone rewrite quality. Invoked by the `tone` tool. |
| concise-auditor | subagent | Document orchestrator for `/corina-concise` Pass A. |
| concise-reviser | subagent | Paragraph-window reviser for `/corina-concise` Pass B. |
| concise-stitcher | subagent | Stitch pass for `/corina-concise` Pass C. |
| concise-reconciler | subagent | Reconciliation pass for `/corina-concise` Pass D. |

All subagents are hidden (not in @autocomplete). They are invoked programmatically via the Task tool only.

## Tool Roster

| Tool | File | Description |
|---|---|---|
| `draft` | `.opencode/tools/draft.ts` | Full 5-step gated editorial pipeline with structured public envelope |
| `tone` | `.opencode/tools/tone.ts` | Voice/tone rewriter (11 voices) |
| `detect` | `.opencode/tools/detect.ts` | AI-pattern detector (Layer 1 + Layer 2) |
| `critique` | `.opencode/tools/critique.ts` | Quality / audience / rubric / compare modes |
| `concise` | `.opencode/tools/concise.ts` | Text concision — removes fluff, preserves substance (quick + full modes) |

Tools are standalone files. They load independently of the plugin.
The plugin (`src/index.ts`) observes all tool calls via `tool.execute.after` for logging and audit.

## Plugin Role (`src/index.ts`)

The plugin is observability infrastructure only. It does **not** implement tools.

Responsibilities:
- `server.connected` → log `plugin_loaded`
- `tool.execute.after` → log `tool_complete`, write capability audit entry for `draft`/`tone`/`detect`/`critique` tools
- `session.idle` → write `session_idle` audit entry
- Future: `tool.execute.before` for guardrails and quota enforcement

## Local dev setup

`npm install` runs `preinstall` (`scripts/ensure-opencode-deps.mjs`), which clones `opencode-model-resolver`, `opencode-text-tools`, and `opencode-eval-harness` into `deps/` and builds them so `file:deps/…` resolves. **Git** must be available. To skip cloning (you already maintain `deps/`): `SKIP_OPENCODE_DEPS=1`. For OpenCode’s `.opencode/` tooling, run `npm install` from the repo root first so those paths exist. Details: `README.md` (local plugin section).

## Prompt Governance

All prompts live in `prompts/` (versioned in repo):
- `prompts/base/` — core persona and system behavior
- `prompts/tasks/` — task-specific instructions
- `prompts/voices/` — 11 voice profiles

Overrides: `.corina-local/prompts/` (gitignored, not committed)
Loader: `src/prompt-loader.ts` (checks override dir first, falls back to bundled)

**Never hardcode prompt text in TypeScript source files.**

## Orchestration Rules

1. Corina does not write content directly — she always calls a tool.
2. For authoring requests, Corina routes through `draft`.
3. In public tool responses, `artifact` is canonical, `rendered` is presentation, `outcome` is authoritative, and `should_persist` governs persistence.
4. Tools execute synchronously today — async job support is planned for OpenWork integration.
5. Chain calls (`--chain`) are handled inside the tool execution layer.
6. Subagents are spawned per-session; they do not share state.
7. `corina.md` declares `permission.task` to control which subagents can be invoked.

## Subagent Invocation (Task tool)

Corina can spawn subagents via the built-in `Task` tool. `permission.task` in `corina.md`
controls which subagents are accessible. Subagent names map to `.opencode/agents/*.md` filenames.

Current allowed subagents: prose-evaluator, voice-evaluator, evidence-evaluator, format-auditor, critic-adjudicator, auditor-adjudicator, detector, tone-writer, tone-validator, concise-auditor, concise-reviser, concise-stitcher, concise-reconciler

To add a new invocable subagent:
1. Create `.opencode/agents/your-agent.md` with `mode: subagent` and `hidden: true`
2. Add it to the `permission.task` allowlist in `corina.md`
3. Document it in the Agent Roster table above

## Never-Fail Rule

Every tool must return output for every valid input.
- Never ask clarifying questions when input is complete.
- Infer missing parameters from context.
- Degrade gracefully with a note — never silently fail or return empty output.

## Adding a New Capability

1. Write the TypeScript execution layer: `src/your-capability.ts`
2. Create the standalone tool file: `.opencode/tools/your-tool-name.ts`
3. Create agent `.md` files if new subagents are needed: `.opencode/agents/`
4. Add prompts: `prompts/tasks/` or `prompts/voices/`
5. Write Tier 1 eval cases: `evals/suites/`
6. Run: `npm run build && npm run test:unit && npm run eval:tier1`
7. Update this file: agent roster, tool roster

## Future: OpenWork Integration

When async job execution is added:
- `draft`, `tone`, `detect`, `critique`, `concise` tools gain `submit_*_job` / `get_*_job_status` variants
- Tools return a job receipt immediately; result is fetched when ready
- Plugin gains a `job.status.updated` event handler to surface results
- Standalone tool files make this swap possible without touching the plugin

## Eval Coverage

| Suite | Command | Count | When to run |
|---|---|---|---|
| Unit tests | `npm run test:unit` | 53 | Every commit |
| Tier 1 eval | `npm run eval:tier1` | 22 | Every commit |
| Integration | `npm run test:integration` | 16 | Before releases |
| Tier 2 eval | `npm run eval:tier2` | — | Before releases (slow) |
