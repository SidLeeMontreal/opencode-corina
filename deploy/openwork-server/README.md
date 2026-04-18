# Hosted OpenCode Server Container

Corina is available both as an OpenCode plugin and as a hosted OpenCode Server container. This directory contains the hosted container deployment. It does not contain Corina capability logic — the canonical writing/runtime code remains at the repo root.

## What this provides

A containerized OpenCode Server that exposes an OpenAI-compatible API:

- `GET  /v1/models` -- list available models
- `POST /v1/chat/completions` -- chat completions (streaming and non-streaming)

Runtime details:

- `/workspace` is the Corina repo root
- OpenWork is fronted by nginx on port `8443`
- OpenCode sessions are managed by the local gateway on port `3001`
- The OpenAI-compatible proxy is exposed through `/v1/`

## Relationship to the plugin

The plugin entrypoint at `src/index.ts` runs inside a local OpenCode session and does **not** serve the `/v1` API. The hosted server container in this directory is the only surface that exposes `/v1/models` and `/v1/chat/completions`.

For local plugin development, see the [root README](../../README.md).

## Files

- `Dockerfile`: builds the hosted Corina image
- `docker-compose.yml`: local compose workflow with the repo root mounted into `/workspace`
- `entrypoint.sh`: installs or refreshes root dependencies when needed, generates runtime config, and starts gateway services
- `opencode.jsonc`: Corina-specific hosted config template
- `proxy/`: session gateway and OpenAI-compatible bridge

## Local usage

1. Copy `.env.example` to `.env`
2. Fill in the model and provider credentials that match your `OPENCODE_MODEL`
3. Run `npm run deploy:compose` from the repo root

For a one-container local dev loop that mounts the working tree:

```bash
npm run deploy:build
npm run deploy:dev
```

## Runtime notes

- Startup prepares a mutable runtime workspace at `/var/workspace/runtime`.
- Most repo paths are linked into that runtime workspace, while `.opencode/` and `.corina-local/` are copied into it so generated/runtime files do not mutate a bind-mounted checkout.
- Startup installs root dependencies only when `node_modules` or `deps/` are missing, builds when `dist/` is missing, and always refreshes `install-corina` into the runtime workspace.
- The deployment-specific OpenCode config is generated at runtime from `opencode.jsonc`; the repo root does not need a second hosted-only config file.
