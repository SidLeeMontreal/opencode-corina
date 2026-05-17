# OpenCode Operational Discipline Ticket Readiness Audit

Date: 2026-05-17
Audited document: `docs/opencode-operational-discipline-tickets-2026-05-17.md`
Status: critical readiness review

## Verdict

The remediation ticket set is directionally correct and mostly safe to implement, but it is not uniformly implementation-ready.

Use this readiness classification:

| Ticket | Readiness | Reason |
| --- | --- | --- |
| OCD-001 | Ready with one schema/config verification step | The policy decision is now clear, but implementation must validate the exact OpenCode permission shape used in hosted config before merging. |
| OCD-002 | Ready, high priority | The codebase already has a resolver, and the remaining work is concrete: route every caller-controlled path through it and pass the active execution root explicitly. |
| OCD-003 | Ready after config/schema verification | The Chrome DevTools MCP decision is resolved: it has been removed from Corina's default hosted config. Remaining work is explicit permission policy and regression coverage. |
| OCD-004 | Ready after config/schema verification | The provider-free discovery path is now specified using documented OpenCode server endpoints. Live tool smoke remains opt-in because it requires provider credentials. |
| OCD-005 | Ready after OCD-004 exists | The skill layout and frontmatter contract are now clear, but `opencode-smoke` depends on a real `smoke:opencode` command that does not exist yet. |
| OCD-006 | Ready with scope clarification | The binary/text policy is clear for local file paths. It should explicitly say current implementation covers path-like inputs, not true multimodal attachment payloads. |

Overall recommendation: implement OCD-001 and OCD-002 first, then OCD-004 provider-free discovery smoke, then finish OCD-003, OCD-006, and OCD-005.

## Grounding Against Current Codebase

Current code confirms the tickets describe real gaps:

- `.opencode/agents/corina.md` currently has `permission.edit: allow`, so OCD-001 is justified.
- `deploy/openwork-server/opencode.jsonc` has no top-level `permission` block. Its inherited Chrome DevTools MCP entries have now been removed from Corina's default hosted config, so OCD-003 should focus on explicit permissions and future MCP regression coverage.
- `src/file-input.ts` already performs root, realpath, size, directory, and symlink-escape checks, so OCD-002 should extend existing code instead of introducing a second resolver.
- `.opencode/tools/tone.ts` creates an OpenCode client with `context.directory`, but the downstream source runner still calls `resolveTextOrFileInput()` without receiving that directory. OCD-002 correctly needs execution-root propagation, not just resolver hardening.
- `src/tone-pipeline.ts`, `src/critique-rubric.ts`, and `src/critique-normalizer.ts` still contain direct path lookup/read behavior for tone/profile/rubric paths.
- `package.json` has no `smoke:opencode` script today, so OCD-004 and OCD-005 must add test harness and skill content in that order. OCD-004 should use OpenCode server endpoints for provider-free discovery and keep model-invoking checks opt-in.
- There is no `.opencode/skills` directory today, so OCD-005 is additive and low-risk once the smoke command exists.

## External OpenCode Contract Check

The ticket direction matches current OpenCode documentation:

- OpenCode project config uses `opencode.json` and `.opencode` directories, including `.opencode/agents`, `.opencode/plugins`, `.opencode/skills`, and `.opencode/tools`.
- OpenCode supports a top-level `permission` config. The documented default is permissive unless changed.
- The `edit` permission controls file-modifying tools, including `edit`, `write`, and `apply_patch`.
- Agent permissions support `read`, `edit`, `glob`, `grep`, `list`, `bash`, `task`, `external_directory`, `lsp`, and `skill` as shorthand actions or pattern maps.
- Skills are discovered at `.opencode/skills/<name>/SKILL.md`, require `name` and `description` frontmatter, and the `name` must match the directory with the regex `^[a-z0-9]+(-[a-z0-9]+)*$`.

Implementation should still validate the repository's actual installed OpenCode version before depending on new schema behavior.

References:

- OpenCode config discovery and permissions: https://open-code.ai/en/docs/config
- OpenCode server endpoints for `/global/health`, `/config`, `/agent`, `/experimental/tool/ids`, `/mcp`, `/session`, and `/session/:id/message`: https://opencode.ai/docs/server/
- OpenCode tool permissions and `edit`/`write` relationship: https://opencode.ai/docs/tools/
- OpenCode agent permission keys and pattern behavior: https://opencode.ai/docs/agents/
- OpenCode skill layout, frontmatter, naming, and `permission.skill`: https://opencode.ai/docs/skills

## Critical Findings

### 1. OCD-003 Chrome MCP decision is resolved

The inherited Chrome DevTools MCP entries were part of the original OpenWork server scaffold, not Corina's editorial implementation. They have been removed from Corina's default hosted config.

OCD-003 is now implementation-ready with this policy:

- no hosted MCP tools by default
- future hosted MCP tools must be explicitly justified
- future hosted MCP tools must be version-pinned
- future hosted MCP tools must have permission rules and smoke coverage

### 2. OCD-004 discovery path is resolved

The ticket asks smoke tests to verify registered agents/tools through OpenCode. The documentation now names the provider-free server endpoints to use.

Provider-free discovery smoke should:

- start `opencode serve` from the repo root
- call `GET /global/health`
- call `GET /config`
- call `GET /agent`
- call `GET /experimental/tool/ids`
- call `GET /mcp`
- optionally call `GET /doc` as a fallback schema/contract diagnostic
- assert Corina, subagents, hosted config, and tool IDs from those responses

Live tool smoke should be separate and opt-in:

- create a session with `POST /session`
- send prompts through `POST /session/:id/message`
- set `agent: "corina"`
- require provider credentials
- verify shared envelope behavior for `draft`, `tone`, `detect`, `critique`, and `concise`

Do not implement provider-free discovery by reading `.opencode` files directly. File reads can be supplemental diagnostics after server endpoint checks fail, but they are not the smoke-test authority.

### 3. OCD-002 is ready, but should force a single execution-root contract

The ticket says to use the OpenCode tool context directory where available. That is correct, but implementation should make this non-optional at wrapper boundaries.

Recommended implementation contract:

- `.opencode/tools/*` passes `context.directory` into source-level runners.
- Source-level runners accept an options/context object containing `allowedRoot`.
- `resolveTextOrFileInput()` uses that root.
- `process.cwd()` remains fallback only for direct unit/source calls.

This protects Docker/OpenWork session workdirs and local plugin workspaces at the same time.

### 4. OCD-006 should distinguish path-like inputs from true attachments

The current code accepts string inputs. It can reject `diagram.png` when the user passes a path string, but it does not appear to have a typed attachment input model for raw image/PDF payloads.

Before implementation, clarify:

- current scope: local file paths and text inputs
- out of scope: binary attachment payloads supplied by a future client protocol

This prevents an implementer from inventing a new attachment API inside a safety ticket.

### 5. OCD-001 needs Docker/headless behavior tested before allowing hosted `ask`

The ticket now says hosted Docker should use `edit: deny` unless approval is verified. That is the right default.

Do not implement hosted `edit: ask` until there is a smoke test proving that OpenWork approval prompts can be answered or fail fast through the API. Otherwise explicit save requests could hang hosted calls.

## Test Readiness

Tests must be updated. The minimum test set for implementation readiness is:

- Config contract tests:
  - local agent `edit` is not `allow`
  - hosted config has explicit `permission`
  - hosted config has no `@latest` MCP packages
  - subagents remain hidden and non-mutating

- File resolver tests:
  - relative workspace file
  - absolute workspace file
  - outside-workspace absolute path
  - traversal path
  - symlink escape
  - trusted rubric/profile path
  - Docker/OpenWork-style session root
  - local plugin workspace root

- Tool wrapper/root propagation tests:
  - `tone`, `detect`, and `critique` pass the active execution root into source-level file resolution
  - source-level direct calls still work with `process.cwd()` fallback

- Binary/text policy tests:
  - reject `.png`, `.jpg`, `.pdf`, `.zip`, `.docx`, `.pptx`
  - reject binary content with fake `.txt`
  - accept `.txt`, `.md`, `.json`
  - accept UTF-8 source/config text such as `.ts`, `.html`, `.yaml`, and extensionless text

- OpenCode smoke tests:
  - provider-free discovery/config smoke using `/global/health`, `/config`, `/agent`, `/experimental/tool/ids`, and `/mcp`
  - opt-in live tool smoke
  - Docker/OpenWork health and no-hang smoke where feasible

- Skill tests:
  - directory name matches frontmatter `name`
  - `description` is present and non-empty
  - skill names match `^[a-z0-9]+(-[a-z0-9]+)*$`
  - hosted `permission.skill` enumerates project skills once added

## Docker vs Local Plugin Risk

The ticket set should not inherently harm Docker or local plugin use if implemented with the updated distinctions.

The two highest-risk mistakes are:

- applying interactive `edit: ask` to hosted/headless Docker without proving approvals work
- binding file resolution to the wrong root, especially using repo root when the active OpenWork session directory should be authoritative

The visual policy is a moderate compatibility risk only if implemented as a strict extension allowlist. The current ticket avoids that by allowing any safe UTF-8 text after sniffing, which preserves normal code-repo plugin use.

## Readiness Gate

Before starting implementation, resolve these gates:

1. Confirm the installed OpenCode version accepts the planned `permission` shapes for hosted config and agent frontmatter.
2. Clarify in OCD-006 that the initial implementation covers path-like local file inputs, not raw multimodal attachment payloads.

After those gates, the tickets are ready to implement in the proposed order:

1. OCD-001
2. OCD-002
3. OCD-004 provider-free discovery smoke
4. OCD-003
5. OCD-006
6. OCD-005
