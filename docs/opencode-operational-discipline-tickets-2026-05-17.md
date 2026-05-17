# OpenCode Operational Discipline Tickets

Date: 2026-05-17
Status: implementation planning
Scope: OpenCode-native safety, discoverability, and runtime smoke coverage

## Objective

Close the OpenCode-native operational gaps found during the May 17 audit:

- make Corina's permissions match a controlled editor/orchestrator model where generated content is not persisted without explicit user intent and runtime approval
- constrain all file-like inputs to the active workspace
- expose only the hosted tools and agents required for Corina's public contract, with an explicit allowlist and permission policy
- add true OpenCode smoke tests against registered agents and tools
- add project-local skills for repeatable operational workflows
- define how visual attachments are accepted, rejected, summarized, or routed, so image/PDF behavior is explicit rather than an accidental consequence of string-only tool inputs

This ticket set is intentionally focused on operational discipline. It should not change Corina's editorial output quality, prompt wording, or public envelope shape unless explicitly called out below.

## Shared Definitions

Use these definitions across all tickets in this document.

- **Active workspace**: the directory OpenCode uses as the current working directory for the active session. In local mode this should be the repo root when OpenCode is started from the repo root. In hosted/session mode this should be the session work directory supplied by the OpenCode/OpenWork wrapper. Implementation must document the final source of truth instead of assuming `process.cwd()`.
- **Workspace root**: the realpath-normalized root used for caller-controlled reads and writes. It must be stable for the duration of a tool call and must be passed explicitly where OpenCode exposes a tool context directory.
- **Trusted config directory**: a narrow, documented, non-workspace directory used only for user-owned Corina configuration, such as `~/.config/opencode/corina/rubrics` or `~/.config/opencode/corina/profiles`.
- **Caller-controlled file-like input**: any user/tool argument that can name a local file or directory, including relative paths, absolute paths, JSON fields containing paths, rubric paths, tone/profile paths, Markdown references that are resolved as local paths, and local attachment paths. URLs are not file-like inputs for this ticket set; they require separate `webfetch`/network policy.
- **External path**: any realpath outside the active workspace and outside a documented trusted config directory.
- **Allowed path**: a realpath inside the active workspace or inside a documented trusted config directory for the specific input type.
- **Rejected path**: a missing, unreadable, directory, oversized, binary/unsupported, traversal, symlink-escaped, or otherwise external path. Rejected paths must produce a warning/degraded result rather than being read.
- **Hidden subagent**: an agent marked `mode: subagent` and `hidden: true`, unavailable as a front-facing/default agent, and invocable only through the primary agent's explicit `task` allowlist.
- **Non-mutating subagent**: a subagent with no file-write or command-execution capability: `edit: deny`, `bash: deny`, and no broad web or external-directory permission.
- **`should_persist=true`**: advisory metadata in Corina's public envelope. It means the returned artifact is suitable for persistence. It does not authorize a write by itself. Persistence still requires explicit caller/user intent, workspace-safe target resolution, and the configured OpenCode edit approval path.

## Global Decisions

- Use `edit: ask` for the primary Corina agent in interactive/local OpenCode plugin mode. This keeps explicit save/edit requests possible while preventing silent file mutation.
- In hosted/headless Docker mode, use `edit: deny` unless the OpenWork approval path is verified to surface and complete edit approvals without hanging API requests.
- Use `edit: deny` for subagents.
- Treat `should_persist=true` as advisory only.
- Deny `bash` by default for Corina and subagents.
- Do not use a broad `external_directory` allow in hosted mode.
- Keep permission policy and path safety coupled: approval to write is not enough unless the target path is workspace-safe, and a workspace-safe path is not enough unless the relevant runtime permission allows the operation.
- Preserve both deployment shapes: local OpenCode plugin execution from the repo/workspace root and Docker/OpenWork execution from a runtime or per-session workspace.

---

## Ticket OCD-001 - Harden Corina permissions for editor-agent operation

**Severity**
P1

**Goal**
Make Corina safe as an editor/orchestrator agent by default, with file writes requiring explicit user intent and approval.

**Files**
- `.opencode/agents/corina.md`
- `agents/corina.md`
- `deploy/openwork-server/opencode.jsonc`
- `README.md`
- `tests/unit/prompt-contract.test.ts`
- optional new config-contract unit test

**Problem**
The primary Corina agent currently has `edit: allow`, while hosted config has no project-documented global `permission` block. That leaves the hosted/local permission posture under-specified in this repo. This conflicts with Corina's intended authoring boundary: for normal writing requests, she should call `draft`, `tone`, `concise`, `critique`, or `detect`, not directly edit files.

This ticket is coupled to OCD-002. A safe edit posture requires both permission approval and workspace-safe target resolution.

**Decision**
Use `edit: ask` for the primary Corina agent in interactive/local OpenCode plugin mode. Use `edit: deny` for hosted/headless Docker mode unless the OpenWork approval path is verified. Use `edit: deny` for subagents. Treat `should_persist=true` as advisory only; it does not authorize writes by itself.

**Non-goals**
- Do not change Corina's prompt wording or editorial behavior beyond permission-boundary instructions.
- Do not change public tool response envelopes.
- Do not add new persistence behavior beyond the approved OpenCode permission path.
- Do not grant mutation rights to subagents.

**Permission Matrix**

| Actor | edit | bash | webfetch | websearch | external_directory | task | skill |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Corina primary, local plugin | ask | deny | ask | ask | deny by default | explicit subagent allowlist | explicit allowlist after OCD-005 |
| Corina primary, hosted/headless | deny unless approval path is verified | deny | ask | ask | deny by default | explicit subagent allowlist | explicit allowlist after OCD-005 |
| Subagents | deny | deny | deny | deny | deny | deny unless specifically required | deny unless specifically required |
| Hosted default config | deny unless approval path is verified | deny | ask | ask | deny | explicit subagent allowlist | explicit allowlist after OCD-005 |
| Public tools | no direct edit contract | deny unless required by runtime | deny unless documented | deny unless documented | deny by default | internal only through runner | deny unless documented |

**Changes**
- Change Corina primary-agent edit permission from `allow` to `ask` for local/interactive OpenCode plugin use.
- Add a top-level hosted `permission` block in `deploy/openwork-server/opencode.jsonc`.
- Recommended hosted defaults:
  - `edit: deny` unless OpenWork approval behavior is tested and documented
  - `bash: deny`
  - `webfetch: ask`
  - `websearch: ask`
  - `external_directory: deny` unless a narrow allowlist is needed
  - `task` allowlist matching Corina's known subagents
  - `skill` policy once project skills exist
- If hosted mode uses `edit: ask`, add a hosted smoke case proving API requests do not hang or fail when an edit approval is required.
- Keep subagents read/evaluate-only: `edit: deny`, `bash: deny`, `webfetch: deny`.
- Document that `should_persist=true` means "safe to persist if requested," not "write this automatically."
- Document how a caller should request actual file persistence:
  - user/caller explicitly asks to save
  - target path is resolved through the workspace-safe path policy from OCD-002
  - OpenCode edit permission is approved
- Extend prompt/config tests to fail if Corina regresses to unqualified `edit: allow`.

**Acceptance Criteria**
- Corina cannot silently write files in hosted or local OpenCode mode.
- Hosted/headless requests do not hang waiting for an approval prompt that cannot be answered.
- Explicit file-write requests follow a documented path that requires user intent, workspace-safe target resolution, and the configured OpenCode edit approval.
- Subagents remain hidden and non-mutating.
- Hosted config declares an explicit `permission` policy.
- Unit tests verify the permission posture.

**Verification**
```bash
npm run build
npm run test:unit
```

Manual verification:
```bash
npm run install-corina
opencode serve --hostname 127.0.0.1 --port 4098 --print-logs
```

Confirm in OpenCode that a normal drafting request routes through `draft` and does not directly edit a file.
Confirm in hosted Docker/OpenWork mode that a request requiring edit approval either returns a controlled unsupported/denied result or completes through a documented approval flow; it must not hang indefinitely.

Canonical manual cases:

- Prompt: `Write a concise launch announcement for this feature.`
  - Expected: calls `draft`, returns content, does not edit files.
- Prompt: `Write this announcement and save it to docs/launch.md.`
  - Expected: calls the relevant authoring tool, resolves `docs/launch.md` inside the workspace, and writes only through the configured edit approval path.

---

## Ticket OCD-002 - Route every file-like input through the workspace-safe resolver

**Severity**
P1

**Goal**
Ensure every caller-controlled path is constrained to the active workspace or documented trusted config directories before any read occurs.

**Files**
- `src/file-input.ts`
- `src/tone-pipeline.ts`
- `src/critique-rubric.ts`
- `src/critique-normalizer.ts`
- `src/detect.ts`
- `.opencode/tools/tone.ts`
- `.opencode/tools/critique.ts`
- `.opencode/tools/detect.ts`
- `tests/unit/file-input.test.ts`
- `tests/unit/critique-rubric.test.ts`
- `tests/unit/tone-defaults.test.ts` or a new tone input test

**Problem**
Normal text/file inputs now use `resolveTextOrFileInput()`, but some file-like options still call `resolve()`, `existsSync()`, and `readFileSync()` directly:

- `toneFile`
- brand `profile`
- explicit rubric paths

These bypass the "inside active workspace" policy described by the public tools.

This ticket is coupled to OCD-001. Restricting reads is not enough if hosted config later grants broad external-directory access, and edit approval is not enough if write targets are not workspace-safe.

**Non-goals**
- Do not add network fetching for URLs.
- Do not add image/PDF extraction. That is covered by OCD-006.
- Do not broaden trusted config directories beyond explicit Corina-owned paths.
- Do not change inline text behavior.

**Path Safety Matrix**

| Input type | Example | Expected handling |
| --- | --- | --- |
| Inline text | `Please rewrite this paragraph...` | Treat as text, no filesystem read. |
| Relative workspace file | `drafts/input.md` | Resolve against active workspace, read if inside root and text-like. |
| Absolute workspace file | `/workspace/drafts/input.md` | Read only if realpath is inside workspace root. |
| Traversal path | `../secret.txt` | Reject unless realpath remains inside workspace root. |
| Symlink escape | `drafts/link-to-secret` | Reject if realpath escapes allowed roots. |
| Trusted config file | `~/.config/opencode/corina/rubrics/custom.md` | Allow only for the specific config input type. |
| URL | `https://example.com/a.md` | Not handled as file-like input; subject to separate web policy. |
| Binary/visual file | `diagram.png` | Reject with visual/unsupported-input warning per OCD-006. |

**Changes**
- Extend `resolveTextOrFileInput()` or add a companion helper for non-content config files.
- Pass an explicit allowed root from the OpenCode tool context where available. Current tool wrappers must not rely only on source-level runner defaults; they should propagate the active execution directory into file-input resolution.
- Define and document the implementation source of truth for active workspace:
  - OpenCode tool context directory when present
  - hosted/session directory when passed by the wrapper
  - `process.cwd()` only as a fallback
- Cover both runtime shapes:
  - local plugin mode, where the active workspace is normally the repo/workspace root
  - Docker/OpenWork mode, where the active workspace may be a runtime workspace or per-session work directory
- Constrain:
  - `toneFile` to active workspace or a documented user config directory
  - brand `profile` to active workspace or `~/.config/opencode/corina/profiles`
  - explicit rubric paths to active workspace or `~/.config/opencode/corina/rubrics`
- Reject symlinks that escape allowed roots.
- Preserve bundled lookup behavior for `prompts/rubrics/corina.md`.
- Return degraded warnings instead of reading unsafe paths.
- Update tool descriptions so file-path support is precise and not broader than implementation.

**Acceptance Criteria**
- No caller-controlled path is read before realpath/root validation.
- Every file-like input category listed above has an explicit policy.
- Absolute paths outside allowed roots are rejected.
- Relative traversal outside allowed roots is rejected.
- Symlink escapes are rejected.
- Bundled rubrics and user-config rubrics still work.
- Existing inline-text behavior is unchanged.
- Tests cover every tool entry point listed in this ticket.
- Tests prove the resolver uses the active OpenCode execution directory rather than an accidental repository or process root.

**Verification**
```bash
npm run build
npm run test:unit
```

Add unit cases for:
- `toneFile` inside workspace
- `toneFile` outside workspace
- brand profile path outside workspace
- explicit rubric path outside workspace
- allowed bundled rubric
- symlink escape
- local plugin workspace root
- Docker/OpenWork-style session work directory

---

## Ticket OCD-003 - Add hosted OpenCode permission policy for MCP and external tools

**Severity**
P2

**Goal**
Make hosted OpenCode capabilities explicit and reviewable instead of inheriting permissive defaults.

**Files**
- `deploy/openwork-server/opencode.jsonc`
- `deploy/openwork-server/README.md`
- `.github/workflows/build-and-deploy.yml`, only if smoke validation is added there
- optional new config-contract unit test

**Problem**
Hosted config needs an explicit permission policy for web access, bash, edits, skills, external directories, and any future MCP tools. The inherited Chrome DevTools MCP registration was removed from Corina's default hosted config because browser automation is not part of Corina's hosted editorial surface.

**Changes**
- Define public hosted surface:
  - public tools: `draft`, `tone`, `detect`, `critique`, `concise`
  - primary public agent: `corina`
  - subagents: internal only, callable through Corina's task allowlist
  - plugin hooks: internal runtime behavior, not public tools
- Keep hosted Docker constraints distinct from local plugin constraints. Hosted config must be safe for non-interactive API use, while local plugin config may rely on interactive OpenCode approval prompts.
- Add explicit permission rules for:
  - `edit`
  - `bash`
  - `webfetch`
  - `websearch`
  - `external_directory`
  - `task`
  - `skill`
  - MCP tool patterns, only if a future hosted MCP capability is explicitly added
- Keep Chrome DevTools MCP out of Corina's default hosted config.
- If browser automation is required later, reintroduce it as an opt-in hosted capability with pinned package versions, explicit permission rules, and smoke coverage.
- Document hosted enabled tools and why each is present.
- Add a config test or lint script that fails on unpinned `@latest` MCP packages in hosted config if MCP entries are added later.
- Add a regression check that subagents do not become public hosted tools.
- Add a hosted/headless regression check that no request path waits indefinitely for an unavailable approval prompt.

**Acceptance Criteria**
- Hosted config has no implicit broad capability surface.
- Hosted config is safe for headless Docker/OpenWork execution.
- The hosted public surface is documented as an allowlist.
- Internal-only subagents are not exposed as callable public tools.
- No MCP tools are registered in hosted config unless explicitly justified, pinned, permissioned, and documented.
- No hosted MCP package is referenced as `@latest`.
- README describes the hosted tool policy.

**Verification**
```bash
npm run build
npm run test:unit
npm run deploy:build
```

Manual hosted smoke:
```bash
npm run deploy:compose
curl -fsS http://127.0.0.1:8443/health
```

---

## Ticket OCD-004 - Add OpenCode-native smoke tests for registered agents and tools

**Severity**
P2

**Goal**
Verify the actual OpenCode surface, not only the TypeScript runners behind it.

**Files**
- `tests/smoke/` or `tests/integration/opencode-native-smoke.test.ts`
- `package.json`
- `README.md`
- `.github/workflows/build-and-deploy.yml` or a new workflow, if CI can run OpenCode
- `tests/helpers/`, if shared server lifecycle helpers are added

**Problem**
Current integration tests call source-level functions such as `runDraftWithArtifact()` and use an SDK client for subagent sessions. They do not prove that OpenCode discovers:

- `.opencode/agents/corina.md`
- `.opencode/tools/draft.ts`
- `.opencode/tools/tone.ts`
- `.opencode/tools/detect.ts`
- `.opencode/tools/critique.ts`
- `.opencode/tools/concise.ts`
- `.opencode/plugins/corina.ts`
- `default_agent: corina` in hosted config

**Changes**
- Add a smoke command, for example `npm run smoke:opencode`.
- Split smoke coverage into two levels:
  - discovery/config smoke, which does not require a live LLM provider and verifies OpenCode can see the registered agents, tools, plugin, default agent, permissions, MCP status, and skills where OpenCode exposes them
  - live tool smoke, enabled only when provider credentials are available, which uses the OpenCode session/message API to prompt Corina through the registered agent/tool surface and checks envelope behavior
- Start `opencode serve` from the repo root on a test port.
- Use documented OpenCode server endpoints for provider-free discovery:
  - `GET /global/health` to verify the server is healthy
  - `GET /config` to verify project config loaded, including `default_agent: corina` and permission posture
  - `GET /agent` to verify Corina and subagents are registered with expected mode/hidden/permission metadata
  - `GET /experimental/tool/ids` to verify registered tool IDs include `draft`, `tone`, `detect`, `critique`, and `concise`
  - `GET /mcp` to verify hosted config does not register unexpected MCP servers
  - `GET /doc` as a fallback contract check when endpoint response shapes change
- Do not implement discovery smoke by reading `.opencode` files directly. File reads can be used only as supplemental diagnostics after the OpenCode server checks fail.
- Exercise the registered tool surface through OpenCode server APIs, not direct TypeScript imports.
- Minimum smoke cases:
  - provider-free discovery confirms `draft`, `tone`, `detect`, `critique`, and `concise` are registered tool IDs
  - live smoke, when enabled, creates a session with `POST /session`, sends a prompt through `POST /session/:id/message` with `agent: "corina"`, and verifies the returned content has Corina's shared envelope shape
  - live `draft` prompt returns the shared envelope
  - live `tone` prompt returns `should_persist=true` on usable rewrite
  - live `detect` prompt returns `should_persist=false`
  - live `critique` prompt returns advisory envelope
  - live `concise` prompt returns rewrite envelope
- Verify Corina is discoverable as a primary agent and subagents are hidden/non-editing.
- Verify a normal authoring prompt does not create or modify files.
- Verify an explicit save prompt follows the documented edit approval/workspace-safe path where automation can observe it.
- Verify permission behavior where possible:
  - no direct edit for normal drafting
  - no subagent file mutation
  - no unexpected public exposure of internal subagents
- Add Docker/OpenWork smoke coverage or a documented local equivalent:
  - hosted `/health` returns successfully
  - hosted session startup does not expose internal subagents as public tools
  - hosted explicit-save behavior does not hang when edit approval is unavailable
- Make tests skippable with a clear message when `opencode` is unavailable.

**Acceptance Criteria**
- A fresh checkout can run one documented command that proves OpenCode sees Corina's real agents/tools.
- Discovery/config smoke can run without model/provider credentials.
- Discovery/config smoke uses OpenCode server endpoints, especially `/agent`, `/experimental/tool/ids`, `/config`, `/mcp`, and `/global/health`, rather than direct source imports.
- Live tool smoke is opt-in and clearly skipped when credentials or `opencode` are unavailable.
- Smoke tests fail if a tool file is renamed, omitted, or not registered.
- Smoke tests fail if `default_agent` points to a missing or subagent definition.
- Smoke tests fail if normal drafting writes files.
- Smoke tests are separated from expensive live quality evals.

**Verification**
```bash
npm run smoke:opencode
npm run build
npm run test:unit
```

Optional CI verification:
```bash
OPENCODE_SMOKE=1 npm run smoke:opencode
```

Live provider verification:
```bash
OPENCODE_SMOKE=1 OPENCODE_LIVE_TOOL_SMOKE=1 npm run smoke:opencode
```

---

## Ticket OCD-005 - Add project-local OpenCode skills for operational workflows

**Severity**
P3

**Goal**
Make recurring Corina maintenance workflows discoverable to OpenCode agents through project-local skills.

**Files**
- new `.opencode/skills/opencode-smoke/SKILL.md`
- new `.opencode/skills/prompt-contract-audit/SKILL.md`
- new `.opencode/skills/hosted-deploy-check/SKILL.md`
- `deploy/openwork-server/opencode.jsonc`
- `README.md`
- optional skill contract test

**Problem**
The repo has agents, tools, and a plugin, but no `.opencode/skills/<name>/SKILL.md` entries. Operational workflows exist in README/docs, but they are not exposed through OpenCode skill discovery.

**Changes**
- Add small project-local skills with valid OpenCode skill names:
  - `opencode-smoke`
  - `prompt-contract-audit`
  - `hosted-deploy-check`
- Each `SKILL.md` must use this frontmatter contract:
  ```markdown
  ---
  name: <skill-directory-name>
  description: <short non-empty description>
  ---
  ```
- The `name` field must exactly match the parent directory name.
- The `name` value must match `^[a-z0-9]+(-[a-z0-9]+)*$`.
- Keep each skill focused:
  - what it does
  - when to use it
  - exact commands
  - safety notes
  - expected outputs
- The `opencode-smoke` skill must include:
  ```bash
  OPENCODE_SMOKE=1 npm run smoke:opencode
  ```
- The `prompt-contract-audit` skill must include:
  ```bash
  npm run test:unit -- tests/unit/prompt-contract.test.ts
  ```
- The `hosted-deploy-check` skill must include the hosted build/health-check commands from OCD-003.
- Add `permission.skill` rules in hosted config once skills exist.
- Hosted config should explicitly enumerate the project skills. Avoid broad wildcard approval unless the repository later has a documented policy for it.
- Keep skills as workflow instructions only. They must not grant new tool or filesystem capabilities beyond OpenCode permission policy.
- Required permissions should be listed as assumptions that must already be allowed by OpenCode policy.
- Add a unit or script check that validates:
  - skill directory name matches `name`
  - names match `^[a-z0-9]+(-[a-z0-9]+)*$`
  - each skill has a non-empty description

**Acceptance Criteria**
- OpenCode can discover the project-local skills from `.opencode/skills`.
- Skill names are valid and stable.
- Skills do not grant new capabilities by themselves.
- Hosted config explicitly allows or denies the project skills.
- Skill docs name their required permissions and expected commands.
- The skill contract test fails if frontmatter is missing or a skill name differs from its directory.

**Verification**
```bash
npm run test:unit
```

Manual verification:
```bash
opencode serve --hostname 127.0.0.1 --port 4098 --print-logs
```

Confirm the skills appear in OpenCode's available skill list.

---

## Ticket OCD-006 - Define and enforce visual attachment policy

**Severity**
P3

**Goal**
Avoid silent failures or misleading behavior when users provide images, screenshots, PDFs, slides, or other non-text attachments.

**Files**
- `.opencode/tools/draft.ts`
- `.opencode/tools/tone.ts`
- `.opencode/tools/detect.ts`
- `.opencode/tools/critique.ts`
- `.opencode/tools/concise.ts`
- `src/file-input.ts`
- `src/types.ts`, if attachment metadata is added
- `README.md`
- `tests/unit/file-input.test.ts`
- optional new attachment-policy unit test

**Problem**
Corina tools accept string inputs only. There is no explicit policy for visual attachments. A user can reasonably expect screenshots or images to be inspectable, but the tools cannot currently parse visual content.

**Changes**
- Define policy in README and tool descriptions:
  - supported now: inline text and UTF-8 text files resolved through the safe-root file resolver from OCD-002
  - unsupported now: images, screenshots, PDFs of any kind, videos, slide decks, archives, Office documents, and other binary documents
  - PDFs are unsupported even when they may contain selectable text, unless their text has already been extracted and provided as plain text
  - expected behavior: return a degraded result explaining that visual/binary inputs must be converted to text first
- Explicitly supported text extensions:
  - `.txt`
  - `.md`
  - `.markdown`
  - `.csv`
  - `.json`
  - `.jsonl`
- Other extensions may be accepted when content sniffing confirms UTF-8 text and the safe-root resolver allows the path. This preserves local OpenCode plugin use in code repositories where users may reasonably pass source/config files such as `.ts`, `.tsx`, `.js`, `.py`, `.html`, `.css`, `.yaml`, or extensionless text files.
- Reject known binary/visual/container extensions before reading full content, even if the path is otherwise workspace-safe.
- Unsupported visual or binary input must return a degraded result using the standard tool envelope, not a successful empty result. The response must:
  - identify the unsupported input type
  - explain that the current tool only accepts text
  - ask for the content to be converted to text first
  - avoid reading binary content into the prompt
  - avoid generating a summary from unsupported content
- Define routing language for future work:
  - accept visual input only in a dedicated capability that explicitly supports vision/OCR
  - do not silently summarize, ignore, or embed visual files in current text tools
  - do not pass raw binary content into LLM prompts
- Add binary/media detection in file resolver:
  - reject common image/video/archive extensions
  - reject common Office/container extensions such as `.docx`, `.pptx`, and `.xlsx`
  - reject likely binary files by content sniffing
  - minimum sniffing rule: reject files containing NUL bytes or a high ratio of non-text bytes in the first read chunk
  - keep UTF-8 text reads working
- If future image/OCR support is desired, create a separate capability rather than silently overloading existing tools.

**Acceptance Criteria**
- Passing an image path does not read binary data into prompts.
- Passing a PDF or binary file returns a clear unsupported-input warning.
- Passing only a visual attachment produces an actionable unsupported-input result, not an empty success.
- Binary content with a fake text extension is rejected by content sniffing.
- Tool descriptions state what attachment types are supported.
- Existing text-file support still works.
- UTF-8 source/config files in local plugin workflows still work after safe-root validation and content sniffing.

**Verification**
```bash
npm run build
npm run test:unit
```

Add unit cases for:
- `.png`
- `.jpg`
- `.pdf`
- `.zip`
- `.docx`
- `.pptx`
- binary-looking file with no extension
- binary content with a fake `.txt` extension
- valid `.txt`
- valid `.md`
- valid `.json`
- valid UTF-8 source/config file with a non-listed extension, for example `.ts`, `.html`, or `.yaml`
- extensionless UTF-8 text file

---

## Suggested Implementation Order

1. OCD-001 - harden Corina permissions.
2. OCD-002 - route every file-like input through safe roots.
3. OCD-003 - add hosted permission policy for MCP and external tools.
4. OCD-004 - add OpenCode-native smoke tests.
5. OCD-006 - define visual attachment policy.
6. OCD-005 - add project-local skills.

OCD-001 and OCD-002 should be treated as safety fixes before any broader hosted exposure. OCD-004 is the strongest regression guard for future OpenCode compatibility.

Permission policy and path safety are intentionally coupled. Do not close OCD-001 without confirming writes are workspace-safe, and do not close OCD-002 while hosted config can grant broad external-directory access.

OCD-005 comes last so the skills document the hardened workflows and do not encode unsafe pre-hardening behavior.
