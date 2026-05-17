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
| OCD-002 | Ready, high priority | The codebase already has a resolver, and the remaining work is concrete. The trusted-config policy is now mode-specific: local plugin mode may use narrow user config roots, while hosted/headless mode defaults to workspace-only reads. |
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
- `package.json` now has a provider-free `smoke:opencode` script that verifies OpenCode `1.15.3`, planned permission shapes, and repo agent/tool discovery through OpenCode server endpoints.
- There is no `.opencode/skills` directory today, so OCD-005 is additive and low-risk. Its `opencode-smoke` skill can now reference the existing `smoke:opencode` command.

## External OpenCode Contract Check

The ticket direction matches current OpenCode documentation:

- OpenCode project config uses `opencode.json` and `.opencode` directories, including `.opencode/agents`, `.opencode/plugins`, `.opencode/skills`, and `.opencode/tools`.
- OpenCode supports a top-level `permission` config. The documented default is permissive unless changed.
- The `edit` permission controls file-modifying tools, including `edit`, `write`, and `apply_patch`.
- Agent permissions support `read`, `edit`, `glob`, `grep`, `list`, `bash`, `task`, `external_directory`, `lsp`, and `skill` as shorthand actions or pattern maps.
- Skills are discovered at `.opencode/skills/<name>/SKILL.md`, require `name` and `description` frontmatter, and the `name` must match the directory with the regex `^[a-z0-9]+(-[a-z0-9]+)*$`.

Implementation should keep validating the repository's installed OpenCode version before depending on new schema behavior during future upgrades.

Current repo/runtime facts:

- `opencode` is installed on this local machine's PATH at `/opt/homebrew/bin/opencode`.
- `opencode --version` reports `1.15.3`.
- `package-lock.json` currently resolves `@opencode-ai/sdk` and `@opencode-ai/plugin` to `1.15.3`.
- `npm view` reports current `opencode-ai`, `@opencode-ai/sdk`, and `@opencode-ai/plugin` as `1.15.3` on 2026-05-17.
- `deploy/openwork-server/Dockerfile` now defaults `OPENCODE_VERSION` to `1.15.3`.
- `deploy/openwork-server/entrypoint.sh` now falls back to `opencode-ai@1.15.3` if `opencode` is missing at runtime.

This pins the first implementation pass to OpenCode `1.15.3`. Future OpenCode upgrades should update the CLI pin, SDK/plugin packages, lockfile, and smoke expectations together.

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

### 4. OCD-002 trusted config policy is resolved

The hosted trusted-config-directory decision is now explicit:

- Local OpenCode plugin mode may allow narrow user-owned config roots such as `~/.config/opencode/corina/rubrics` and `~/.config/opencode/corina/profiles`.
- Those local plugin config paths must still pass realpath/root validation, symlink checks, file-type checks, and size limits.
- Hosted/headless Docker mode defaults to workspace-only file reads because hosted `external_directory` is denied.
- Hosted/headless mode must not read `~/.config/opencode/corina/...` from the container or host by default.
- Hosted custom rubrics/profiles must be provided as inline text, stored inside the active workspace, or placed in a per-session mounted config root that is explicitly allowed by hosted OpenCode permission policy.
- Any future hosted non-workspace config root must be narrow, per-session where possible, documented, permissioned, and covered by smoke/unit tests.

This preserves local plugin ergonomics without weakening hosted isolation.

## Implementation Caveats

### 1. OpenCode schema/version verification is confirmed for 1.15.3

The tickets rely on current OpenCode behavior for:

- top-level `permission` config
- Markdown agent frontmatter permissions
- `permission.task` allowlists
- `permission.skill` rules
- wildcard/pattern permission behavior for future MCP tools
- server endpoints used by OCD-004

The OpenCode docs support these concepts, and the repo now has a provider-free smoke command that verifies them against OpenCode `1.15.3`.

Accessible version of the decision:

> We need to confirm that the exact OpenCode version we run understands the permission settings we plan to write. Documentation says the settings exist, but the container currently installs `latest`, so tomorrow's runtime could behave differently from today's tests.

Resolved decision:

- Hosted OpenCode is pinned to `1.15.3` instead of `latest`.
- Root `@opencode-ai/sdk` and `@opencode-ai/plugin` are aligned to `1.15.3`.
- `.opencode/package.json` pins `@opencode-ai/sdk` and `@opencode-ai/plugin` to `1.15.3` for local plugin dependency installation.
- `npm run smoke:opencode` verifies that OpenCode `1.15.3` accepts the planned permission shapes through its own server endpoints.

Current verification command:

```bash
npm run smoke:opencode
```

What the smoke verifies:

1. `opencode --version` is `1.15.3`.
2. A temporary permission fixture starts with `opencode serve`.
3. `GET /global/health` reports version `1.15.3`.
4. `GET /config` exposes the planned top-level `permission` block.
5. `GET /agent` exposes the planned agent-frontmatter permission metadata.
6. The fixture proves these expected shapes are visible:
   - primary Corina local/plugin: `edit: ask`, `bash: deny`, explicit `task` allowlist
   - hosted/headless config: `edit: deny` unless approval is proven, `bash: deny`, no broad `external_directory`
   - subagents: `edit: deny`, `bash: deny`, hidden/non-mutating
   - skills, once added: explicit `permission.skill` allowlist/denylist
7. The repo discovery phase verifies Corina and the `draft`, `tone`, `detect`, `critique`, and `concise` tools are visible through OpenCode server endpoints.

Future decision rule:

- If a future OpenCode upgrade rejects or drops any permission shape, do not guess. Adjust the ticket to the supported schema for that version, or pin OpenCode to a version that supports the intended policy.
- If endpoint responses stop exposing enough metadata to prove the policy, add a lower-level config parsing/lint test as supplemental coverage, but keep OpenCode server smoke as the authority for runtime compatibility.

### 2. OCD-002 should force a single execution-root contract

The ticket says to use the OpenCode tool context directory where available. That is correct, but implementation should make this non-optional at wrapper boundaries.

Recommended implementation contract:

- `.opencode/tools/*` passes `context.directory` into source-level runners.
- Source-level runners accept an options/context object containing `allowedRoot`.
- `resolveTextOrFileInput()` uses that root.
- `process.cwd()` remains fallback only for direct unit/source calls.

This protects Docker/OpenWork session workdirs and local plugin workspaces at the same time.

### 3. OCD-004 uses an experimental tool endpoint

OCD-004 uses `GET /experimental/tool/ids`, which is documented but explicitly experimental. Implementation should:

- treat `/experimental/tool/ids` as the preferred provider-free tool discovery endpoint
- also inspect `GET /doc` in the smoke harness so failures can report whether the endpoint disappeared or changed shape
- fail with a clear compatibility message when the endpoint is unavailable, rather than silently falling back to direct file inspection
- keep the OpenCode version used during validation in the smoke-test output

### 4. Live tool smoke can be flaky unless it is explicitly opt-in and bounded

OCD-004 live smoke relies on a model choosing the expected registered tool through `POST /session/:id/message`. That is useful end-to-end validation, but it can be affected by provider availability, model behavior, latency, and prompt routing.

Implementation should:

- make provider-free discovery smoke the default required smoke
- keep live tool smoke behind `OPENCODE_LIVE_TOOL_SMOKE=1`
- add explicit timeouts
- use narrow prompts that strongly require the target capability
- distinguish "provider unavailable", "model did not route", and "tool envelope failed" in failure messages
- avoid making live smoke mandatory in PR CI unless provider credentials and stability are guaranteed

### 5. Docker/OpenWork smoke target must be specified at implementation time

OCD-004 asks for Docker/OpenWork smoke coverage, but the target can differ by deployment layer:

- external nginx/OpenWork surface on `8443`
- local gateway/internal OpenCode surface on `3001`
- per-session OpenCode server ports managed by the orchestrator

Implementation must specify which layer each smoke case targets. Recommended split:

- hosted health/API smoke against the external container surface
- OpenCode discovery smoke against a direct `opencode serve` process in local tests
- optional Docker internal smoke only when the test harness can discover or request the active session server safely

### 6. Implementation order is now aligned

The ticket document now matches this readiness recommendation:

- Keep OCD-001 and OCD-002 first.
- Implement the provider-free part of OCD-004 before completing OCD-003 so hosted permission/config changes have a regression harness.
- Complete OCD-003 after that harness exists.
- Then implement OCD-006 and OCD-005.

### 7. OCD-001 still needs Docker/headless behavior tested before allowing hosted `ask`

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
  - local plugin trusted rubric/profile path under `~/.config/opencode/corina/...`
  - hosted trusted rubric/profile path under `~/.config/opencode/corina/...` rejected by default when `external_directory` is denied
  - hosted workspace rubric/profile path allowed
  - hosted per-session mounted config root allowed only when explicitly configured
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

1. Specify Docker/OpenWork smoke targets: external nginx/OpenWork surface, gateway/internal OpenCode surface, direct `opencode serve`, or a staged combination.

During implementation, enforce these gates:

1. Treat `/experimental/tool/ids` as preferred but version-sensitive; use `/doc` for compatibility diagnostics.
2. Keep live tool smoke opt-in, timed, and separate from provider-free discovery smoke.
3. Keep raw multimodal attachment ingestion out of OCD-006.
4. Do not enable hosted `edit: ask` unless approval behavior is proven non-hanging.
5. Do not allow hosted non-workspace trusted config roots unless they are explicitly mounted, permissioned, documented, and tested.

After those gates, the tickets are ready to implement in the proposed order:

1. OCD-001
2. OCD-002
3. OCD-004 provider-free discovery smoke
4. OCD-003
5. OCD-006
6. OCD-005
