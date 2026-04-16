# Corina OpenWork Deployment

This directory contains the hosted deployment wrapper for Corina. It does not contain Corina capability logic. The canonical writing/runtime code remains at the repo root.

## What this deploys

- `/workspace` is the Corina repo root
- OpenWork is fronted by nginx on port `8443`
- OpenCode sessions are managed by the local gateway on port `3001`
- The OpenAI-compatible proxy is exposed through `/v1/`

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

- Startup runs `npm install`, `npm run build`, and `npm run install-corina` only when the mounted workspace needs it.
- Session work directories mirror the repo root via symlinks so Corina resolves `.opencode/`, `src/`, `prompts/`, and `schemas/` from the canonical workspace.
- The deployment-specific OpenCode config is generated at runtime from `opencode.jsonc`; the repo root does not need a second hosted-only config file.
