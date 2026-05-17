# OpenCode Operational Discipline Ticket Readiness Audit

Date: 2026-05-17
Audited document: `docs/opencode-operational-discipline-tickets-2026-05-17.md`
Status: critical readiness review

## Verdict

The remediation ticket set is directionally correct and now mostly implementation-ready as a specification. The remaining gaps are not missing ticket intent; they are version/schema checks, runtime-target decisions, and a few implementation details that must be resolved while coding.

Use this readiness classification:

| Ticket | Readiness | Reason |
| --- | --- | --- |
| OCD-001 | Ready with validation gates | The policy decision is clear, but implementation must validate the exact OpenCode permission shape and must not use hosted `edit: ask` until approval behavior is proven non-hanging. |
| OCD-002 | Ready, high priority, with root-policy caveat | The codebase already has a resolver, and the remaining work is concrete. Implementation must reconcile trusted config directories with hosted `external_directory` denial. |
| OCD-003 | Ready after config/schema verification | The Chrome DevTools MCP decision is resolved: it has been removed from Corina's default hosted config. Remaining work is explicit permission policy and regression coverage. |
| OCD-004 | Ready with smoke-target caveats | The provider-free discovery path is specified using documented OpenCode server endpoints. Implementation must handle experimental endpoint drift and keep live tool smoke opt-in because it depends on model/tool-routing behavior. |
| OCD-005 | Ready as a specification | The skill layout and frontmatter contract are clear. The `opencode-smoke` skill must reference the `smoke:opencode` command contract defined by OCD-004 and should be implemented after that command exists in `package.json`. |
| OCD-006 | Ready as a specification | The scope is now explicit: current implementation covers inline text and path-like local file inputs, while raw multimodal attachment payloads are deferred to a future dedicated capability. |

Overall recommendation: implement OCD-001 and OCD-002 first, then OCD-004 provider-free discovery smoke, then finish OCD-003, OCD-006, and OCD-005.

## Grounding Against Current Codebase

Current code confirms the tickets describe real gaps:

- `.opencode/agents/corina.md` currently has `permission.edit: allow`, so OCD-001 is justified.
- `deploy/openwork-server/opencode.jsonc` has no top-level `permission` block. Its inherited Chrome DevTools MCP entries have now been removed from Corina's default hosted config, so OCD-003 should focus on explicit permissions and future MCP regression coverage.
- `src/file-input.ts` already performs root, realpath, size, directory, and symlink-escape checks, so OCD-002 should extend existing code instead of introducing a second resolver.
- `.opencode/tools/tone.ts` creates an OpenCode client with `context.directory`, but the downstream source runner still calls `resolveTextOrFileInput()` without receiving that directory. OCD-002 correctly needs execution-root propagation, not just resolver hardening.
- `src/tone-pipeline.ts`, `src/critique-rubric.ts`, and `src/critique-normalizer.ts` still contain direct path lookup/read behavior for tone/profile/rubric paths.
- `package.json` has no `smoke:opencode` script today, so OCD-004 must add the test harness before `opencode-smoke` can be implemented. OCD-004 should use OpenCode server endpoints for provider-free discovery and keep model-invoking checks opt-in.
- There is no `.opencode/skills` directory today, so OCD-005 is additive and low-risk. Its specification is ready now, but implementation should follow the `smoke:opencode` command added by OCD-004.

## External OpenCode Contract Check

The ticket direction matches current OpenCode documentation:

- OpenCode project config uses `opencode.json` and `.opencode` directories, including `.opencode/agents`, `.opencode/plugins`, `.opencode/skills`, and `.opencode/tools`.
- OpenCode supports a top-level `permission` config. The documented default is permissive unless changed.
- The `edit` permission controls file-modifying tools, including `edit`, `write`, and `apply_patch`.
- Agent permissions support `read`, `edit`, `glob`, `grep`, `list`, `bash`, `task`, `external_directory`, `lsp`, and `skill` as shorthand actions or pattern maps.
- Skills are discovered at `.opencode/skills/<name>/SKILL.md`, require `name` and `description` frontmatter, and the `name` must match the directory with the regex `^[a-z0-9]+(-[a-z0-9]+)*$`.

Implementation should still validate the repository's actual installed OpenCode version before depending on new schema behavior.

Current repo/runtime facts:

- `opencode` is not installed on this local machine's PATH during this audit.
- `package-lock.json` currently resolves `@opencode-ai/sdk` and `@opencode-ai/plugin` to `1.4.3`.
- `npm view` reports current `opencode-ai`, `@opencode-ai/sdk`, and `@opencode-ai/plugin` as `1.15.3` on 2026-05-17.
- `deploy/openwork-server/Dockerfile` installs `opencode-ai@${OPENCODE_VERSION}`, and the default value is currently `latest`.

This means the repo can drift across OpenCode versions unless implementation pins and verifies the runtime version used for local/plugin and Docker/hosted mode.

References:

- OpenCode config discovery and permissions: https://open-code.ai/en/docs/config
- OpenCode server endpoints for `/global/health`, `/config`, `/agent`, `/experimental/tool/ids`, `/mcp`, `/session`, and `/session/:id/message`: https://opencode.ai/docs/server/
- OpenCode tool permissions and `edit`/`write` relationship: https://opencode.ai/docs/tools/
- OpenCode agent permission keys and pattern behavior: https://opencode.ai/docs/agents/
- OpenCode skill layout, frontmatter, naming, and `permission.skill`: https://opencode.ai/docs/skills

## Resolved Decisions

### 1. OCD-003 Chrome MCP decision is resolved

The inherited Chrome DevTools MCP entries were part of the original OpenWork server scaffold, not Corina's editorial implementation. They have been removed from Corina's default hosted config.

OCD-003 is now implementation-ready with this policy:

- no hosted MCP tools by default
- future hosted MCP tools must be explicitly justified
- future hosted MCP tools must be version-pinned
- future hosted MCP tools must have permission rules and smoke coverage

### 2. OCD-004 provider-free discovery path is resolved

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

### 3. OCD-006 scope is resolved

OCD-006 now explicitly covers inline text and path-like local file inputs only. Raw multimodal attachment payloads, OCR, screenshot inspection, image/PDF upload handling, and binary payload parsing are deferred to a future dedicated capability.

## Remaining Gaps

### 1. OpenCode schema/version verification is still required

The tickets rely on current OpenCode behavior for:

- top-level `permission` config
- Markdown agent frontmatter permissions
- `permission.task` allowlists
- `permission.skill` rules
- wildcard/pattern permission behavior for future MCP tools
- server endpoints used by OCD-004

The OpenCode docs support these concepts, but implementation still needs a repo-local verification step against the installed OpenCode version used in local plugin mode and hosted Docker mode. Do not merge the permission/config changes on documentation confidence alone.

Accessible version of the decision:

> We need to confirm that the exact OpenCode version we run understands the permission settings we plan to write. Documentation says the settings exist, but the container currently installs `latest`, so tomorrow's runtime could behave differently from today's tests.

Recommended decision:

- Pin the hosted OpenCode CLI version instead of using `latest`.
- Use one verified OpenCode version for the first implementation pass.
- Prefer aligning CLI, SDK, and plugin package versions in the same implementation ticket or a small prerequisite ticket.
- Treat the version as supported only after the smoke harness proves that OpenCode loads the planned permission shapes through its own server endpoints.

Minimum verification recipe:

1. Pick a target OpenCode version, for example the current npm version at implementation time.
2. Install or run that exact version locally and in the Docker image.
3. Start `opencode serve` from the repo root.
4. Call `GET /global/health` and record the reported version.
5. Call `GET /config` and confirm the hosted/project config accepted the top-level `permission` block.
6. Call `GET /agent` and confirm Corina and subagents expose the expected permission metadata from agent frontmatter.
7. Confirm these expected shapes are visible:
   - primary Corina local/plugin: `edit: ask`, `bash: deny`, explicit `task` allowlist
   - hosted/headless config: `edit: deny` unless approval is proven, `bash: deny`, no broad `external_directory`
   - subagents: `edit: deny`, `bash: deny`, hidden/non-mutating
   - skills, once added: explicit `permission.skill` allowlist/denylist
8. Add a config contract test or smoke assertion so future version upgrades fail loudly if the shape changes.

Decision outcome:

- If OpenCode loads and reports the expected permission metadata, proceed with OCD-001/OCD-003 implementation on that pinned version.
- If OpenCode rejects or drops any permission shape, do not guess. Adjust the ticket to the supported schema for that version, or upgrade/pin OpenCode to a version that supports the intended policy.
- If the endpoint response omits enough metadata to prove the policy, add a lower-level config parsing/lint test as supplemental coverage, but keep OpenCode server smoke as the authority for runtime compatibility.

### 2. OCD-002 must reconcile trusted config directories with hosted `external_directory: deny`

OCD-002 permits documented trusted config directories such as `~/.config/opencode/corina/rubrics` and `~/.config/opencode/corina/profiles`. OCD-001 and OCD-003 correctly prefer `external_directory: deny` in hosted mode.

Implementation must make this mode-specific:

- local plugin mode may allow narrow user config directories after resolver validation
- hosted/headless mode should default to workspace-only reads unless a per-session trusted config directory is explicitly mounted and permissioned
- any trusted directory outside the workspace must be narrow, documented, and tested against OpenCode `external_directory` behavior

Without this reconciliation, implementation could either break legitimate local config files or weaken hosted file isolation.

### 3. OCD-002 should force a single execution-root contract

The ticket says to use the OpenCode tool context directory where available. That is correct, but implementation should make this non-optional at wrapper boundaries.

Recommended implementation contract:

- `.opencode/tools/*` passes `context.directory` into source-level runners.
- Source-level runners accept an options/context object containing `allowedRoot`.
- `resolveTextOrFileInput()` uses that root.
- `process.cwd()` remains fallback only for direct unit/source calls.

This protects Docker/OpenWork session workdirs and local plugin workspaces at the same time.

### 4. OCD-004 uses an experimental tool endpoint

OCD-004 uses `GET /experimental/tool/ids`, which is documented but explicitly experimental. Implementation should:

- treat `/experimental/tool/ids` as the preferred provider-free tool discovery endpoint
- also inspect `GET /doc` in the smoke harness so failures can report whether the endpoint disappeared or changed shape
- fail with a clear compatibility message when the endpoint is unavailable, rather than silently falling back to direct file inspection
- keep the OpenCode version used during validation in the smoke-test output

### 5. Live tool smoke can be flaky unless it is explicitly opt-in and bounded

OCD-004 live smoke relies on a model choosing the expected registered tool through `POST /session/:id/message`. That is useful end-to-end validation, but it can be affected by provider availability, model behavior, latency, and prompt routing.

Implementation should:

- make provider-free discovery smoke the default required smoke
- keep live tool smoke behind `OPENCODE_LIVE_TOOL_SMOKE=1`
- add explicit timeouts
- use narrow prompts that strongly require the target capability
- distinguish "provider unavailable", "model did not route", and "tool envelope failed" in failure messages
- avoid making live smoke mandatory in PR CI unless provider credentials and stability are guaranteed

### 6. Docker/OpenWork smoke target must be specified at implementation time

OCD-004 asks for Docker/OpenWork smoke coverage, but the target can differ by deployment layer:

- external nginx/OpenWork surface on `8443`
- local gateway/internal OpenCode surface on `3001`
- per-session OpenCode server ports managed by the orchestrator

Implementation must specify which layer each smoke case targets. Recommended split:

- hosted health/API smoke against the external container surface
- OpenCode discovery smoke against a direct `opencode serve` process in local tests
- optional Docker internal smoke only when the test harness can discover or request the active session server safely

### 7. Implementation order is inconsistent between documents

The ticket document's "Suggested Implementation Order" lists OCD-003 before OCD-004, while this readiness document recommends OCD-004 provider-free discovery smoke before finishing OCD-003.

Recommended resolution:

- Keep OCD-001 and OCD-002 first.
- Implement the provider-free part of OCD-004 before completing OCD-003 so hosted permission/config changes have a regression harness.
- Complete OCD-003 after that harness exists.
- Then implement OCD-006 and OCD-005.

The ticket document should be updated to match this order or explicitly explain why it differs.

### 8. OCD-001 still needs Docker/headless behavior tested before allowing hosted `ask`

The ticket says hosted Docker should use `edit: deny` unless approval is verified. That is the right default.

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
  - trusted rubric/profile path when hosted `external_directory` is denied
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
  - compatibility failure path when `/experimental/tool/ids` is unavailable or changes shape
  - opt-in live tool smoke
  - live smoke timeout and skipped-provider behavior
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

OCD-006 is now scoped tightly enough for implementation: reject unsafe visual/binary paths and binary-looking files in the existing string/file resolver path, but do not invent a new attachment ingestion API in this ticket.

## Readiness Gates

Before implementation starts, resolve these gates:

1. Confirm the installed OpenCode version accepts the planned `permission` shapes for hosted config and agent frontmatter.
2. Decide the hosted trusted-config-directory policy for OCD-002: workspace-only by default, or narrow per-session mounted config directories with matching OpenCode permission behavior.
3. Align the implementation order between the ticket document and this readiness document, or explicitly document that OCD-004 provider-free smoke is a prerequisite for completing OCD-003.
4. Specify Docker/OpenWork smoke targets: external nginx/OpenWork surface, gateway/internal OpenCode surface, direct `opencode serve`, or a staged combination.

During implementation, enforce these gates:

1. Treat `/experimental/tool/ids` as preferred but version-sensitive; use `/doc` for compatibility diagnostics.
2. Keep live tool smoke opt-in, timed, and separate from provider-free discovery smoke.
3. Keep raw multimodal attachment ingestion out of OCD-006.
4. Do not enable hosted `edit: ask` unless approval behavior is proven non-hanging.

After those gates, the tickets are ready to implement in the proposed order:

1. OCD-001
2. OCD-002
3. OCD-004 provider-free discovery smoke
4. OCD-003
5. OCD-006
6. OCD-005
