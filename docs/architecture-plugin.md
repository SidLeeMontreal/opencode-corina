# Corina Plugin Architecture

This document describes the canonical Corina runtime that lives at the repo root.

## Source of truth

The repo root is the product:

- `src/` contains Corina capability logic and orchestration
- `prompts/` contains versioned prompt assets
- `schemas/` contains artifact contracts
- `tests/` and `evals/` validate behavior
- `.opencode/` exposes local plugin, tool, and agent entrypoints for OpenCode

The hosted deployment wrapper does not replace or fork that logic.

## Plugin and package mode

In plugin mode, OpenCode is run from the repo root and resolves project-local assets there.

Current root workflow:

```bash
npm install
npm run build
npm run install-corina
```

Useful follow-up commands:

```bash
npm run test:unit
npm run test:integration
npm run eval:tier1
```

## Execution shape

In local plugin mode:

1. OpenCode loads `.opencode/plugins/corina.ts`
2. Plugin and tool entrypoints delegate into root TypeScript under `src/`
3. Prompt loading resolves from `prompts/`, with optional `.corina-local/prompts/` overrides
4. `npm run install-corina` refreshes `.opencode/agents/` from canonical agent markdown in `agents/`

That keeps one implementation path for local development, package usage, and hosted deployment.

## Canonical files for plugin mode

If you want to understand Corina itself, start here:

- `package.json`
- `src/`
- `prompts/`
- `schemas/`
- `.opencode/`
- `tests/`
- `evals/`
