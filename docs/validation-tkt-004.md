# TKT-004 Validation Summary

This ticket validates the repo in its two operating modes:
- plugin/package mode at repo root
- hosted deployment mode under `deploy/openwork-server/`

This is an evidence ticket, not a feature ticket.

## Files inspected
- `package.json`
- `.opencode/`
- `scripts/install-corina.mjs`
- `deploy/openwork-server/README.md`
- `deploy/openwork-server/Dockerfile`
- `deploy/openwork-server/entrypoint.sh`
- `deploy/openwork-server/docker-compose.yml`
- `deploy/openwork-server/opencode.jsonc`
- `.github/workflows/eval-tier1.yml`
- `.github/workflows/build-and-deploy.yml`
- `tests/integration/*.test.ts`
- `evals/suites/all.json`
- `scripts/run-eval.mjs`

## Exact commands run
```bash
find .opencode -maxdepth 3 -type f | sort
find tests -maxdepth 3 -type f | sort
find evals -maxdepth 3 -type f | sort
find .github/workflows -maxdepth 2 -type f | sort

sed -n '1,240p' .github/workflows/eval-tier1.yml
sed -n '1,340p' .github/workflows/build-and-deploy.yml
sed -n '1,260p' deploy/openwork-server/Dockerfile
sed -n '1,360p' deploy/openwork-server/entrypoint.sh
sed -n '1,240p' tests/integration/detect.e2e.test.ts
sed -n '1,240p' tests/integration/tone.e2e.test.ts
sed -n '1,220p' tests/integration/pipeline.e2e.test.ts
sed -n '1,220p' tests/integration/chaining.e2e.test.ts

git status --short
ls -la deps
test -d deps/opencode-eval-harness && echo eval_harness_present || echo eval_harness_missing

npm run build
npm run test:all
npm run test:unit
npm run test:regression
npm run eval:tier1
CORINA_INSTALL_ROOT=/tmp/corina-install-check npm run install-corina
rg -n "\.\./\.\./prompts/|\.\./prompts/" /tmp/corina-install-check/.opencode/agents .opencode/plugins

cp deploy/openwork-server/.env.example deploy/openwork-server/.env
npm run deploy:build
docker compose -f deploy/openwork-server/docker-compose.yml config
docker run -d --name tkt004-corina-openwork -p 8443:8443 -p 3001:3001 --env-file deploy/openwork-server/.env opencode-corina-openwork
curl -fsS http://127.0.0.1:8443/health
docker logs tkt004-corina-openwork

docker run -d --name tkt004-runtime-shape -p 8443:8443 -p 3001:3001 --env-file deploy/openwork-server/.env opencode-corina-openwork
docker exec tkt004-runtime-shape sh -lc 'ls -ld /var/workspace/runtime /var/workspace/runtime/src /var/workspace/runtime/.opencode /var/workspace/runtime/.corina-local /workspace/src /workspace/.opencode || true'
docker exec tkt004-runtime-shape sh -lc 'for p in /var/workspace/runtime/src /var/workspace/runtime/prompts /var/workspace/runtime/package.json; do printf "%s -> " "$p"; readlink "$p" || echo not-a-symlink; done'
docker exec tkt004-runtime-shape sh -lc 'for p in /var/workspace/runtime/.opencode /var/workspace/runtime/.corina-local; do printf "%s -> " "$p"; readlink "$p" || echo copied-dir; done'
```

## Directly executed validation

### Plugin/package mode
- `npm run build` passed.
- `npm run test:unit` passed: 17 files, 164 tests.
- `npm run test:regression` passed: 1 file, 1 test.
- `npm run eval:tier1` passed in offline mode across the full `evals/suites/all.json` suite.
- `CORINA_INSTALL_ROOT=/tmp/corina-install-check npm run install-corina` passed.
- Alternate install-root validation confirmed:
  - `.opencode/agents` is created under the target install root.
  - installed agent prompt references are rewritten to `../../prompts/...` as intended for nested `.opencode/agents/*` files.
- Local plugin entrypoint check confirmed `.opencode/plugins/corina.ts` re-exports `../../src/index.js`, which is consistent with repo-root plugin loading.

### Deployment mode
- `npm run deploy:build` passed and produced a local `opencode-corina-openwork` image.
- `docker compose -f deploy/openwork-server/docker-compose.yml config` passed when `deploy/openwork-server/.env` existed.
- A live local container started successfully with `deploy/openwork-server/.env.example` copied to `.env`.
- `curl http://127.0.0.1:8443/health` returned `{"ok":true,...}` from the running container.
- Container logs directly confirmed startup behavior:
  - runtime workspace prepared at `/var/workspace/runtime`
  - Corina package built at startup
  - Corina agents refreshed into `/var/workspace/runtime/.opencode/agents`
  - OpenCode provider packages installed into `/var/workspace/runtime/.opencode`
  - runtime OpenCode config generated from deployment template
  - gateway started on `:3001`
  - OpenWork session pre-created and pinned
  - `openwork-server` started on `:8787`
  - nginx started on `:8443`
- In-container inspection confirmed runtime workspace shape:
  - `/var/workspace/runtime/src`, `prompts`, and `package.json` are symlinks back to `/workspace/...`
  - `/var/workspace/runtime/.opencode` is a copied directory, not a symlink
  - `/var/workspace/runtime/.corina-local` is a copied directory, not a symlink

## Structural/static checks only
- `scripts/run-eval.mjs` confirms Tier 1 eval is offline (`mode=auto`) and Tier 2 depends on a live OpenCode endpoint.
- `tests/integration/*.test.ts` all default `OPENCODE_URL` to `http://127.0.0.1:4098`, so those tests are live-service integration tests, not offline tests.
- `deploy/openwork-server/opencode.jsonc` is a deployment template with default agent `corina`, a hosted model id, and local MCP definitions for Chrome tooling.
- `.github/workflows/eval-tier1.yml` is PR-safe and skips cleanly when private eval harness access is unavailable.
- `.github/workflows/build-and-deploy.yml` separates PR image build from push-to-main Azure deployment.
- `deploy/openwork-server/docker-compose.yml` mounts the repo root read-only at `/workspace` and exposes `8443` and `3001`.

## Results

### Plugin/package mode results
- Preserved for offline/dev-safe paths:
  - build passes
  - unit tests pass
  - regression test passes
  - Tier 1 offline eval passes
  - install flow works at repo root and alternate install root
  - plugin entrypoint/path assumptions are internally consistent
- Important caveat, directly evidenced:
  - `npm run test:all` is not self-contained in this repo as exercised here
  - it failed in integration tests because no OpenCode server was running at `127.0.0.1:4098`
  - failure mode was explicit and consistent: `TypeError: fetch failed` caused by `ECONNREFUSED 127.0.0.1:4098`
  - that means full integration coverage was not proven by this run

### Deployment mode results
- Operationally credible locally:
  - image builds
  - compose file resolves
  - container starts
  - health endpoint responds
  - gateway and OpenWork startup sequence completes
  - runtime workspace shape matches the actual entrypoint implementation
- Startup evidence is stronger than static inspection alone because health and logs were observed from a live container.

## Environment-dependent unknowns
- Full plugin integration tests still depend on a live OpenCode server at `OPENCODE_URL` (default `127.0.0.1:4098`).
- Tier 2/judge eval paths depend on a live OpenCode endpoint and model access.
- Hosted model execution was not exercised end-to-end against Anthropic, Azure, or Foundry because the local validation used `.env.example` without real provider secrets.
- GitHub workflow behavior involving private dependency access, Azure login, registry push, Azure Files, and Container App deployment was inspected structurally but not executed from this environment.
- Hosted MCP integrations such as GitHub and Figma remain environment-dependent because they require tokens not provided here.

## Remaining real risks
- `npm run test:all` is not self-contained; it currently mixes offline tests with live-service integration tests and will fail without a local OpenCode server.
- `deploy/openwork-server/README.md` still says session work directories mirror the repo root via symlinks, but the actual implementation copies `.opencode/` and `.corina-local/` into the runtime workspace while symlinking most other repo paths. That is a docs accuracy issue, not a runtime bug.
- Deployment health was verified only to service-start level. Actual hosted model calls, MCP operations, and Azure deployment behavior still need secret-backed environment validation.

## Exact files changed in this ticket
- `docs/validation-tkt-004.md`

## Completion call
TKT-004 is complete as an evidence ticket and is honest-to-reality **if it is framed as partial live validation plus explicit environment-dependent unknowns**.

What is proven now:
- plugin mode was preserved for build, offline eval, install flow, and offline tests
- hosted mode is locally buildable, startable, and health-checkable
- runtime path/config behavior is internally consistent and directly evidenced

What is not proven yet:
- secret-backed hosted model execution
- Azure deployment execution
- plugin integration tests without provisioning the required local OpenCode service
