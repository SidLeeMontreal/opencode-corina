# Audit Remediation Tickets

Date: 2026-05-12
Status: implementation planning
Scope: security, reproducibility, and fresh-checkout correctness issues found during code audit

## Objective

Resolve the audit findings that currently affect hosted safety, repo reproducibility, and baseline verification:

- protect hosted session-management endpoints
- constrain tool-driven file reads
- bundle the default Corina rubric
- pin helper repository dependencies
- address npm audit advisories

---

## Ticket 1 - Require authentication for hosted session admin endpoints

**Severity**
P1

**Goal**
Prevent unauthenticated clients from creating, pinning, inspecting, or deleting hosted OpenCode sessions.

**Files**
- `deploy/openwork-server/proxy/gateway.js`
- `deploy/openwork-server/nginx.conf`
- `deploy/openwork-server/README.md`
- tests for the gateway, if added

**Problem**
`gateway.js` handles internal API routes before checking `PROXY_API_KEY`. As a result, these routes can be reached without authentication:

- `POST /_sessions`
- `GET /_stats`
- `DELETE /_sessions/:id`
- `POST /_sessions/:id/pin`

Nginx exposes those routes through `/sessions` and `/stats`.

**Changes**
- Keep `/health` unauthenticated.
- Require `PROXY_API_KEY` auth before all session and stats routes.
- Prefer one explicit allowlist for unauthenticated routes instead of relying on route order.
- Return the existing `401` auth error shape for rejected admin requests.
- Decide whether `/stats` should be public, authenticated, or removed from the public nginx surface. Default to authenticated.
- Update hosted docs to state which operational endpoints require auth.

**Acceptance criteria**
- With `PROXY_API_KEY` set, unauthenticated calls to `/sessions`, `/stats`, and `/opencode/_sessions` return `401`.
- Authenticated calls with the correct bearer token still work.
- `/health` still returns a health response without auth.
- Existing OpenWork and `/v1/chat/completions` routing still works with valid auth.

**Verification**
```bash
PROXY_API_KEY=test npm run deploy:compose
curl -i http://127.0.0.1:8443/health
curl -i http://127.0.0.1:8443/stats
curl -i -H 'Authorization: Bearer test' http://127.0.0.1:8443/stats
curl -i -X POST http://127.0.0.1:8443/sessions
curl -i -X POST -H 'Authorization: Bearer test' http://127.0.0.1:8443/sessions
```

---

## Ticket 2 - Constrain tool file-path reads to an allowed workspace root

**Severity**
P1

**Goal**
Keep convenient local file input support while preventing hosted callers from reading arbitrary container files.

**Files**
- `src/detect.ts`
- `src/tone-pipeline.ts`
- `src/critique-normalizer.ts`
- `src/types.ts`, if a shared input type is useful
- new shared helper, likely `src/file-input.ts`
- `.opencode/tools/detect.ts`
- `.opencode/tools/tone.ts`
- `.opencode/tools/critique.ts`
- relevant unit tests

**Problem**
Several public tools treat a string input as either inline text or a readable file path. They currently check `existsSync` and call `readFileSync` on both the raw string and `resolve(raw)`, without confirming that the resolved path is inside a safe workspace root.

Affected paths:
- detect text input
- tone text input
- critique text inputs

In hosted mode, this can expose files from the container or session workspace to a remote caller.

**Changes**
- Add a shared `resolveTextOrFileInput()` helper.
- Resolve all candidate paths to real paths before reading.
- Define an allowed root:
  - use the OpenCode/tool context directory when available
  - otherwise use `process.cwd()`
  - allow an explicit environment override such as `CORINA_FILE_INPUT_ROOT`
- Reject absolute paths outside the allowed root.
- Reject `..` traversal after realpath resolution.
- Reject directories.
- Add a file-size cap before reading, for example 1 MB or a documented configurable limit.
- Return a degraded diagnostic warning for rejected paths instead of silently reading or crashing.
- Keep inline text behavior unchanged when the input is not an existing path.
- Update tool descriptions to say file paths must be inside the active workspace.

**Acceptance criteria**
- Inline text still works for detect, tone, and critique.
- Relative paths inside the workspace still work.
- Absolute paths inside the workspace still work only after passing root validation.
- Paths outside the workspace are rejected and not read.
- Symlinks that escape the workspace are rejected.
- Oversized files are rejected with a clear warning.

**Verification**
```bash
npm run build
npm run test:unit
```

Add targeted unit cases covering:
- inline text
- valid workspace file
- `../` traversal
- absolute `/etc/passwd`-style path
- symlink escaping the workspace
- oversized file

---

## Ticket 3 - Bundle the default `corina` critique rubric

**Severity**
P1

**Goal**
Make rubric mode and unit tests work from a fresh checkout without relying on user-level config files.

**Files**
- `src/critique-rubric.ts`
- new bundled rubric file, likely `rubrics/corina.md` or `prompts/rubrics/corina.md`
- `package.json`, if package file inclusion is constrained later
- `README.md`
- `tests/unit/critique-rubric.test.ts`
- `tests/unit/evaluation-registry.test.ts`

**Problem**
`loadRubric("corina")` only searches `~/.config/opencode/corina/rubrics`, but no default `corina.md` rubric is committed in the repo. Fresh-checkout unit tests fail with `Could not resolve fallback rubric 'corina'`.

**Changes**
- Add a committed default rubric file for `corina`.
- Include YAML frontmatter with:
  - `id: corina`
  - `name: Corina Editorial Standard`
  - `version`
  - five dimensions: `ai_patterns`, `tone`, `precision`, `evidence`, `rhythm`
- Include body text with a clear pass threshold, because existing tests expect rubric text to contain `Pass threshold`.
- Change `getRubricSearchPaths()` to search bundled rubrics before or after user config. Recommended order:
  1. explicit file path supplied by caller
  2. user config rubric directory
  3. bundled repo rubric directory
- Keep unknown rubric fallback behavior.
- Document where custom rubrics should live and how bundled fallback works.

**Acceptance criteria**
- `loadRubric("corina")` works on a fresh checkout.
- Unknown rubric names fall back to bundled `corina`.
- Custom user rubrics can still override or extend behavior.
- Unit tests no longer require files in `~/.config/opencode/corina/rubrics`.

**Verification**
```bash
npm run build
npm run test:unit
```

---

## Ticket 4 - Pin helper repository dependencies

**Severity**
P2

**Goal**
Make installs reproducible and reviewable.

**Files**
- `scripts/ensure-opencode-deps.mjs`
- `package.json`
- `package-lock.json`
- `README.md`
- `.github/workflows/eval-tier1.yml`
- `.github/workflows/build-and-deploy.yml`

**Problem**
The root `preinstall` script clones helper repositories from the `main` branch using `--depth 1`. That means a fresh install can change when those external repositories change, without any commit in this repo.

**Changes**
- Pin each helper repo to a tag or full commit SHA:
  - `opencode-model-resolver`
  - `opencode-text-tools`
  - `opencode-eval-harness`
- Store the pins in one clear place, either:
  - constants in `ensure-opencode-deps.mjs`
  - a small `deps.lock.json`
  - package metadata
- After cloning, checkout the exact pinned ref.
- Log the checked-out commit for each dependency.
- Fail the install if checkout does not land on the expected commit.
- Update CI workflows so private dependency preparation uses the same pin source.
- Document the update process for bumping helper dependencies.

**Acceptance criteria**
- Two fresh installs from the same Corina commit fetch the same helper dependency commits.
- CI and local install use the same dependency pins.
- The install log shows each helper dependency and resolved commit.
- A helper dependency update requires an explicit Corina repo change.

**Verification**
```bash
rm -rf deps node_modules
npm install
git -C deps/opencode-model-resolver rev-parse HEAD
git -C deps/opencode-text-tools rev-parse HEAD
git -C deps/opencode-eval-harness rev-parse HEAD
npm run build
npm run test:unit
```

---

## Ticket 5 - Resolve npm audit advisories

**Severity**
P2

**Goal**
Remove known high and moderate npm advisories from the root install.

**Files**
- `package.json`
- `package-lock.json`
- helper dependency package manifests under `deps/`, if fixes need to land upstream first

**Problem**
`npm audit --json` reports:

- high: `fast-uri <= 3.1.1`, currently pulled through `ajv`
- moderate: `postcss < 8.5.10`, currently pulled through Vite/Vitest dependency paths

**Changes**
- Update direct dependencies where possible.
- If transitive fixes require nested dependency updates, update the owning package:
  - `ajv` path for `fast-uri`
  - Vite/Vitest paths for `postcss`
- If helper repos own part of the vulnerable tree, fix and pin those helper repos first, then update Corina pins.
- Avoid broad major-version churn unless required by the advisory fix.
- Commit the updated lockfile.

**Acceptance criteria**
- `npm audit --omit=dev` reports no production high vulnerabilities.
- Full `npm audit` reports no high vulnerabilities.
- Moderate dev-only advisories are either fixed or explicitly documented with a reason and follow-up owner.
- Build and unit tests still pass.

**Verification**
```bash
npm audit
npm audit --omit=dev
npm run build
npm run test:unit
```

---

## Suggested implementation order

1. Ticket 1 - protect hosted admin endpoints.
2. Ticket 2 - constrain file reads.
3. Ticket 3 - bundle the default rubric and restore fresh-checkout tests.
4. Ticket 4 - pin helper repos.
5. Ticket 5 - resolve dependency advisories.

Ticket 3 is the quickest correctness fix. Tickets 1 and 2 should be prioritized before any broader hosted exposure.
