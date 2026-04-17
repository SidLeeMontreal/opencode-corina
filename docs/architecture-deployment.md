# Corina OpenWork Deployment Architecture

This document describes the hosting layer under `deploy/openwork-server/`.

## Purpose

The deployment subtree packages the existing Corina repo as a hosted OpenWork service without moving Corina source code out of the repo root.

## Boundary

- Repo root owns capabilities, prompts, schemas, tools, tests, evals, and build outputs
- `deploy/openwork-server/` owns containerization, session bootstrapping, proxying, and deployment configuration

No Corina capability logic is duplicated into the deployment wrapper.

## Hosted runtime shape

At runtime:

1. The repo is available in the container at `/workspace`
2. `entrypoint.sh` prepares a mutable runtime workspace at `/var/workspace/runtime`
3. Most repo paths are linked into that runtime workspace, while `.opencode/` and `.corina-local/` are copied into it so generated/runtime files do not mutate the bind-mounted checkout
4. A deployment-specific OpenCode config is generated from `deploy/openwork-server/opencode.jsonc`
5. The proxy/orchestrator starts per-session OpenCode servers and OpenWork binds to a pinned Corina session

## Key files

- `deploy/openwork-server/Dockerfile` — container image definition
- `deploy/openwork-server/docker-compose.yml` — local compose entrypoint
- `deploy/openwork-server/entrypoint.sh` — startup preparation and service orchestration
- `deploy/openwork-server/opencode.jsonc` — Corina-specific hosted config template
- `deploy/openwork-server/proxy/` — gateway, proxy, and session orchestration

## Root scripts for hosted mode

Hosted operations are launched from the repo root through `package.json`:

- `npm run deploy:build`
- `npm run deploy:run`
- `npm run deploy:dev`
- `npm run deploy:compose`

Those scripts all target the deployment wrapper under `deploy/openwork-server/`.

## Canonical files for hosted mode

If you want to understand the hosted wrapper, start here:

- `deploy/openwork-server/README.md`
- `deploy/openwork-server/Dockerfile`
- `deploy/openwork-server/entrypoint.sh`
- `deploy/openwork-server/docker-compose.yml`
- `deploy/openwork-server/opencode.jsonc`
- `.github/workflows/build-and-deploy.yml`
